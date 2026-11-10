// @vitest-environment node
/**
 * «Предложить пол» (./floor.ts) on the example pack's coach with its floor taken away, the
 * generator the real one (Pyodide in Node, the tools/ files as they are), compared with
 * `python3` running `floorgen.generate` on the same OBJ and doors: the level clicked on the
 * model's floor gives floorgen's zones; the draft is drawn dashed and judged by the floor
 * check before it is taken; taking it is one entry of the journal and undoing it gives the
 * type back byte for byte; a floor that cannot be found is said in words.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { typeFloorProblems } from '../../checks/floor/problems';
import { setLang } from '../../i18n';
import { BridgeError, type PythonBridge } from '../../ir/bridge';
import { havePython, runPythonJson } from '../../ir/testing.node';
import { exampleModel } from '../../model/testing.node';
import { EXAMPLE_PACK } from '../../testing/repo.node';
import floorTool, { type FloorSession } from '../floor';
import { ToolHost } from '../registry';
import { bench, type Bench } from '../testing.node';
import { zonesOf } from '../floor/zones';
import { useSuggestBridge } from './bridge';
import { acceptFloor, basisOf, DRAFT_LAYER, generatorDoors, generatorOptions, LEVEL_LAYER, type FloorSuggest } from './floor';
import { fakeBridge, realBridge } from './testing.node';

const COACH = 'rwat_example:coach';
const COACH_TYPE = 'data/rwat_example/wagon_types/coach.json';
const COACH_OBJ = join(EXAMPLE_PACK, 'assets', 'rwat_example', 'stock', 'coach', 'coach.obj');
const coachModel = await exampleModel('coach');

let bridge: PythonBridge;

beforeAll(() => {
  bridge = realBridge();
  setLang('en');
});

afterEach(() => {
  useSuggestBridge(null);
});

/** The coach with its floor taken away (its zones removed in one entry), the zones tool on. */
async function withoutFloor(): Promise<{ b: Bench; host: ToolHost; suggest: FloorSuggest; stop: () => void; before: string }> {
  const b = await bench(COACH, coachModel);
  b.journal.dispatch({ label: 'x', ops: [{ op: 'remove', file: COACH_TYPE, at: '/interior' }] });
  const host = new ToolHost([floorTool]);
  const stop = host.connect(b.wiring);
  host.use('floor');
  const session = host.current.value?.session as FloorSession | undefined;
  if (session === undefined) throw new Error('the zones tool is not on');
  const pack = b.pack.value;
  if (pack === null) throw new Error('no pack');
  return { b, host, suggest: session.tool.suggest, stop, before: await pack.text(COACH_TYPE) };
}

/** A click on the coach's floor, at the middle of the aisle. */
function clickFloor(b: Bench, at = 1.3): boolean {
  const floor = coachModel.objects.find((o) => o.name === 'FLOOR');
  if (floor === undefined) throw new Error('no FLOOR object');
  return b.view.emitPick({ object: 'FLOOR', point: [0, at, 0], shift: false, ctrl: false, alt: false, double: false });
}

/** floorgen's own answer for the coach with `options` (python3), or null where it does not run. */
function pythonFloor(options: unknown): { interior: unknown[]; levels: number[]; regionArea: number; droppedArea: number } | null {
  if (!havePython) return null;
  return runPythonJson(
    [
      'import json, floorgen',
      'f = floorgen.generate(open(sys.argv[1], "rb").read(), floorgen.FloorConfig(json.loads(sys.argv[2])), json.load(open(sys.argv[3]))["doors"])',
      'print(json.dumps({"interior": f.interior, "levels": [floorgen.y_to_obj(l) for l in f.levels],',
      '                  "regionArea": f.region.area(), "droppedArea": f.dropped_area}))',
    ].join('\n'),
    [COACH_OBJ, JSON.stringify(options), join(EXAMPLE_PACK, ...COACH_TYPE.split('/'))],
  ) as { interior: unknown[]; levels: number[]; regionArea: number; droppedArea: number };
}

describe('the options the generator is given', () => {
  it('are only what differs from its defaults; one level is a number, several a list', () => {
    expect(generatorOptions({ levels: [], clearance: null, stepDown: null })).toEqual({});
    expect(generatorOptions({ levels: [1.3], clearance: 0.05, stepDown: null })).toEqual({ level: 1.3, clearance: 0.05 });
    expect(generatorOptions({ levels: [1.15, 1.3], clearance: null, stepDown: 0.2 })).toEqual({ level: [1.15, 1.3], step_down: 0.2 });
  });

  it('use the doors of the type that have a box', () => {
    expect(generatorDoors({ doors: [{ id: 'a', min: [0, 0, 0], max: [1, 2, 3] }, { id: 'b', min: [0, 0] }, 7, null] })).toEqual([{ id: 'a', min: [0, 0, 0], max: [1, 2, 3] }]);
    expect(generatorDoors({})).toEqual([]);
    expect(generatorDoors(null)).toEqual([]);
  });
});

describe('a floor suggested for the coach that has none', () => {
  it('nothing is loaded or asked until the button: the tool is on, a level is picked, and Pyodide has not started', async () => {
    const { b, suggest, stop } = await withoutFloor();
    useSuggestBridge(bridge);
    expect(zonesOf(b.pack.value?.json(COACH_TYPE))).toEqual([]);
    suggest.picking.value = true;
    expect(clickFloor(b)).toBe(true);
    expect(bridge.progress.stage).toBe('idle');
    stop();
  });

  it('gives floorgen’s zones for the level clicked on the model’s floor, drawn dashed; taken, it is one entry; undone, the type is as it was', async () => {
    const { b, suggest, stop, before } = await withoutFloor();
    useSuggestBridge(bridge);

    // the next click on the model sets a level: the click is the suggestion's
    suggest.picking.value = true;
    expect(clickFloor(b)).toBe(true);
    expect(suggest.picking.value).toBe(false);
    expect(suggest.levels.value).toEqual([1.3]);
    expect(b.selection.value).toEqual([]);
    expect(b.view.overlays.get(LEVEL_LAYER)).toEqual([expect.objectContaining({ shape: 'rect', style: 'reach' })]);
    expect(b.view.overlays.get(LEVEL_LAYER)?.[0]).toMatchObject({ min: [expect.any(Number), 1.3, expect.any(Number)] });
    // a click while no level waits is the view's
    expect(clickFloor(b)).toBe(false);

    const journalBefore = b.journal.state().done.length;
    await suggest.request();
    const outcome = suggest.outcome.value;
    if (outcome.phase !== 'draft') throw new Error(`no draft: ${JSON.stringify(outcome)}`);
    expect(suggest.running.value).toBeNull();
    expect(bridge.progress.stage).toBe('ready');

    const theirs = pythonFloor({ level: 1.3 });
    if (theirs !== null) {
      expect({ interior: outcome.draft.zones, levels: outcome.draft.levels, regionArea: outcome.draft.regionArea, droppedArea: outcome.draft.droppedArea }).toEqual({
        interior: theirs.interior,
        levels: theirs.levels,
        regionArea: theirs.regionArea,
        droppedArea: theirs.droppedArea,
      });
    }
    expect(outcome.draft.zones.length).toBeGreaterThan(5);
    expect(outcome.draft.levels).toEqual([1.3]);
    // drawn dashed over the type's own zones (it has none now), changing nothing
    const drawn = b.view.overlays.get(DRAFT_LAYER);
    expect(drawn).toHaveLength(outcome.draft.zones.length);
    expect(drawn?.every((shape) => shape.style === 'draft' && shape.shape === 'rect' && shape.link === undefined)).toBe(true);
    expect(b.journal.state().done).toHaveLength(journalBefore);
    expect(zonesOf(b.pack.value?.json(COACH_TYPE))).toEqual([]);
    // the floor check says what it finds of the type with the draft: nothing for a floor the generator walked
    expect(suggest.problems.value).toEqual([]);
    expect(suggest.stale.value).toBe(false);

    // taken: one entry replacing `interior`, the draft gone from the view
    expect(suggest.accept()).toBe(true);
    expect(b.journal.state().done).toHaveLength(journalBefore + 1);
    expect(b.journal.state().done.at(-1)).toMatchObject({ label: 'tools.suggest.cmd.floor', labelParams: { count: outcome.draft.zones.length } });
    expect(b.journal.state().done.at(-1)?.ops).toHaveLength(1);
    const type = b.pack.value?.json(COACH_TYPE) as { interior: unknown };
    expect(type.interior).toEqual(outcome.draft.zones);
    expect(typeFloorProblems(COACH, COACH_TYPE, type)).toEqual([]);
    expect(b.view.overlays.has(DRAFT_LAYER)).toBe(false);
    expect(suggest.outcome.value.phase).toBe('idle');

    // undone: the file is as it was, byte for byte
    b.journal.undo();
    expect(await b.pack.value?.text(COACH_TYPE)).toBe(before);
    stop();
  }, 60_000);

  it('rejected, it changes nothing and leaves the view', async () => {
    const { b, suggest, stop, before } = await withoutFloor();
    useSuggestBridge(bridge);
    suggest.addLevel(1.3);
    await suggest.request();
    expect(suggest.outcome.value.phase).toBe('draft');
    expect(b.view.overlays.has(DRAFT_LAYER)).toBe(true);
    const entries = b.journal.state().done.length;
    suggest.reject();
    expect(suggest.outcome.value.phase).toBe('idle');
    expect(b.view.overlays.has(DRAFT_LAYER)).toBe(false);
    expect(b.journal.state().done).toHaveLength(entries);
    expect(await b.pack.value?.text(COACH_TYPE)).toBe(before);
    expect(suggest.accept()).toBe(false);
    stop();
  }, 60_000);

  it('with several levels (a car with steps) asks the generator for them all, each once', async () => {
    const { suggest, stop } = await withoutFloor();
    const spy = fakeBridge({ suggestFloor: () => ({ interior: [{ min: [0, 1.3, 0], max: [1, 3.8, 1] }], levels: [1.15, 1.3], notes: [], regionArea: 1, droppedArea: 0 }) });
    useSuggestBridge(spy);
    suggest.addLevel(1.15);
    suggest.addLevel(1.3);
    expect(suggest.addLevel(1.3)).toBe(false);
    expect(suggest.addLevel(Number.NaN)).toBe(false);
    const asked = suggest.request();
    await vi.waitFor(() => expect(spy.calls).toHaveLength(1));
    spy.release();
    await asked;
    expect(spy.calls[0]?.args[0]).toEqual({ level: [1.15, 1.3] });
    expect(suggest.outcome.value).toMatchObject({ phase: 'draft', draft: { levels: [1.15, 1.3] } });
    suggest.removeLevel(0);
    expect(suggest.levels.value).toEqual([1.3]);
    stop();
  });

  it('with no level the generator picks its own: floorgen’s zones for the options as they are', async () => {
    const { suggest, stop } = await withoutFloor();
    useSuggestBridge(bridge);
    expect(suggest.levels.value).toEqual([]);
    await suggest.request();
    const own = suggest.outcome.value;
    if (own.phase !== 'draft') throw new Error('no draft');
    const picked = pythonFloor({});
    if (picked !== null) expect(own.draft.zones).toEqual(picked.interior);
    expect(own.draft.levels).toHaveLength(1);
    stop();
  }, 60_000);

  it('takes the generator’s options from the section: clearance and step_down change the zones as they change floorgen’s', async () => {
    const { suggest, stop } = await withoutFloor();
    useSuggestBridge(bridge);
    suggest.addLevel(1.3);
    suggest.clearance.value = 0.3;
    suggest.stepDown.value = 0.05;
    await suggest.request();
    const draft = suggest.outcome.value;
    if (draft.phase !== 'draft') throw new Error('no draft');
    const theirs = pythonFloor({ level: 1.3, clearance: 0.3, step_down: 0.05 });
    if (theirs !== null) expect(draft.draft.zones).toEqual(theirs.interior);
    expect(draft.draft.zones).not.toEqual(pythonFloor({ level: 1.3 })?.interior ?? []);
    stop();
  }, 60_000);

  it('is stale when the doors change after it was made: it cannot be taken as it is', async () => {
    const { b, suggest, stop } = await withoutFloor();
    useSuggestBridge(bridge);
    suggest.addLevel(1.3);
    await suggest.request();
    expect(suggest.stale.value).toBe(false);
    b.journal.dispatch({ label: 'x', ops: [{ op: 'remove', file: COACH_TYPE, at: '/doors/0' }] });
    expect(suggest.stale.value).toBe(true);
    const entries = b.journal.state().done.length;
    expect(suggest.accept()).toBe(false);
    expect(b.journal.state().done).toHaveLength(entries);
    stop();
  }, 60_000);

  it('judges the draft by the floor check: findings of the type with it are listed', async () => {
    const { b, suggest, stop } = await withoutFloor();
    useSuggestBridge(bridge);
    // a door the generator's floor cannot reach: far outside the car, where it meets no zone
    b.journal.dispatch({ label: 'x', ops: [{ op: 'insert', file: COACH_TYPE, at: '/doors/-', value: { id: 'far', min: [30, 1.3, 1.45], max: [31, 3.3, 1.51] } }] });
    suggest.addLevel(1.3);
    await suggest.request();
    expect(suggest.outcome.value.phase).toBe('draft');
    expect(suggest.problems.value.map((p) => p.code)).toEqual(['floor.door-not-at-floor-end']);
    stop();
  }, 60_000);
});

describe('a floor that cannot be found is said in words, without a traceback', () => {
  it('a level the model has no floor at: the sentence, the generator’s own line under it', async () => {
    const { suggest, stop } = await withoutFloor();
    useSuggestBridge(bridge);
    suggest.addLevel(7);
    await suggest.request();
    const outcome = suggest.outcome.value;
    if (outcome.phase !== 'failed') throw new Error('did not fail');
    expect(outcome.said.text).toBe('The model has no level surface facing up at 7. Click the model’s floor or clear the level: the generator then finds one itself.');
    expect(outcome.said.detail).toContain('no up-facing surface near level');
    expect(`${outcome.said.text}${outcome.said.detail}`).not.toContain('Traceback');
    expect(suggest.running.value).toBeNull();
    // the next try starts clean
    suggest.removeLevel(0);
    suggest.addLevel(1.3);
    await suggest.request();
    expect(suggest.outcome.value.phase).toBe('draft');
    stop();
  }, 60_000);

  it('options the generator refuses: a FloorConfigError named in words', async () => {
    const { suggest, stop } = await withoutFloor();
    useSuggestBridge(bridge);
    suggest.addLevel(1.3);
    suggest.clearance.value = -1;
    await suggest.request();
    const outcome = suggest.outcome.value;
    if (outcome.phase !== 'failed') throw new Error('did not fail');
    expect(outcome.said.text).toBe('The generator did not take the options.');
    expect(outcome.said.detail).toContain('clearance can\'t be negative');
    stop();
  }, 60_000);

  it('a model with no OBJ to read: said at once, nothing asked', async () => {
    const b = await bench(COACH, { ...coachModel, obj: null });
    const spy = fakeBridge();
    useSuggestBridge(spy);
    const host = new ToolHost([floorTool]);
    const stop = host.connect(b.wiring);
    host.use('floor');
    const suggest = (host.current.value?.session as FloorSession).tool.suggest;
    await suggest.request();
    const outcome = suggest.outcome.value;
    expect(outcome.phase === 'failed' && outcome.said.text).toBe('The wagon has no OBJ model that reads: nothing to give the generator.');
    expect(spy.calls).toEqual([]);
    stop();
  });
});

describe('a call under way', () => {
  it('shows the loading as the bridge reports it, and is stopped by Cancel: the draft is not made, nothing is said, nothing is left running', async () => {
    const { b, suggest, stop } = await withoutFloor();
    const spy = fakeBridge();
    useSuggestBridge(spy);
    const asked = suggest.request();
    await vi.waitFor(() => expect(spy.calls).toHaveLength(1));
    const running = suggest.running.value;
    expect(running).not.toBeNull();
    spy.report({ stage: 'download', loaded: 5, total: 13 });
    expect(running?.progress.value).toEqual({ stage: 'download', loaded: 5, total: 13 });
    // a second request while one is under way asks nothing more
    await suggest.request();
    expect(spy.calls).toHaveLength(1);
    suggest.cancel();
    await asked;
    expect(spy.calls[0]?.signal?.aborted).toBe(true);
    expect(suggest.running.value).toBeNull();
    expect(suggest.outcome.value.phase).toBe('idle');
    expect(b.view.overlays.has(DRAFT_LAYER)).toBe(false);
    stop();
  });

  it('is stopped when the tool is turned off', async () => {
    const { host, suggest, stop } = await withoutFloor();
    const spy = fakeBridge();
    useSuggestBridge(spy);
    const asked = suggest.request();
    await vi.waitFor(() => expect(spy.calls).toHaveLength(1));
    host.use(null);
    await asked;
    expect(spy.calls[0]?.signal?.aborted).toBe(true);
    expect(suggest.outcome.value.phase).toBe('idle');
    stop();
  });

  it('a worker that fails is said in words', async () => {
    const { suggest, stop } = await withoutFloor();
    const spy = fakeBridge();
    spy.suggestFloor = () => Promise.reject(BridgeError.of('worker', 'WorkerError', 'out of memory'));
    useSuggestBridge(spy);
    await suggest.request();
    const outcome = suggest.outcome.value;
    if (outcome.phase !== 'failed') throw new Error('did not fail');
    expect(outcome.said).toEqual({ text: 'Python did not start or stopped: try again.', detail: 'out of memory' });
    stop();
  });
});

describe('the basis of a draft', () => {
  it('is the OBJ and the doors the generator saw', async () => {
    const b = await bench(COACH, coachModel);
    const host = new ToolHost([]);
    const stop = host.connect(b.wiring);
    const subject = host.subject.value;
    if (subject === null) throw new Error('no subject');
    const first = basisOf(subject);
    expect(first).toContain('coach.obj');
    expect(basisOf({ ...subject, typeJson: { ...(subject.typeJson as object), doors: [] } })).not.toBe(first);
    expect(basisOf({ ...subject, typeJson: { ...(subject.typeJson as object), mass_t: 1 } })).toBe(first);
    expect(acceptFloor(COACH_TYPE, []).ops).toEqual([{ op: 'set', file: COACH_TYPE, at: '/interior', value: [] }]);
    stop();
  });

  it('reads the same OBJ the file has (the example pack’s coach)', () => {
    expect(readFileSync(COACH_OBJ).length).toBeGreaterThan(1000);
  });
});
