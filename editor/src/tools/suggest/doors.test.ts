// @vitest-environment node
/**
 * «Двери по именам» (./doors.ts) on a model made here with the IR convention's names —
 * `DOOR_1_EXTERNAL`, `DOOR_3.001`, a `WIDGET_2_TOGGLE_CG_DoorA` the model animates —
 * the converter the real one (Pyodide in Node), compared with `python3` running
 * `ir2rwat.model_doors` on the same OBJ: the draft is those doors; taking it adds the
 * ones the type lacks by id, case aside, leaves the type's own as they are, and is one
 * entry of the journal.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { dump } from '../../core/json';
import { setLang } from '../../i18n';
import type { PythonBridge } from '../../ir/bridge';
import { COACH_OBJ, havePython, runPythonJson } from '../../ir/testing.node';
import doorsTool from '../doors';
import type { DoorsSession } from '../doors';
import { ToolHost } from '../registry';
import { useSuggestBridge } from './bridge';
import { acceptDoors, animatedGroups, DOORS_DRAFT_LAYER, foundDoors, type DoorsByNames } from './doors';
import { fakeBridge, realBridge, wagonBench } from './testing.node';

const TYPE = 'data/t/wagon_types/box.json';
const MODEL = 'assets/t/wagon_models/box.json';

let bridge: PythonBridge;
let objFile: string;

beforeAll(() => {
  bridge = realBridge();
  setLang('en');
  objFile = join(mkdtempSync(join(tmpdir(), 'rwat-doors-')), 'box.obj');
  writeFileSync(objFile, COACH_OBJ);
});

afterEach(() => {
  useSuggestBridge(null);
});

/**
 * A wagon `t:box` whose model is the IR convention's names, `type` the type's JSON on top of a
 * plain one; the doors tool on. `readable: false`: the model's OBJ path is one that can't be read.
 */
async function boxBench(type: Record<string, unknown>, model: Record<string, unknown> = { obj: 'stock/box.obj', animations: { doora: 'stock/doora.anim' } }, readable = true) {
  const b = await wagonBench(
    {
      'pack.mcmeta': '{"pack": {"pack_format": 34, "description": "t"}}',
      [TYPE]: dump({ length: 10, bogies: [3, -3], mass_t: 20, max_speed_kmh: 100, ...type }),
      [MODEL]: dump(model),
      'assets/t/stock/box.obj': COACH_OBJ,
      'assets/t/stock/doora.anim': 'O WIDGET_2_TOGGLE_CG_DoorA\n',
    },
    't:box',
  );
  if (!readable && b.openModel.value !== null) b.openModel.value = { ...b.openModel.value, obj: null };
  const host = new ToolHost([doorsTool]);
  const stop = host.connect(b.wiring);
  host.use('doors');
  const session = host.current.value?.session as DoorsSession | undefined;
  if (session === undefined) throw new Error('the doors tool is not on');
  return { b, host, by: session.tool.byNames, stop };
}

/** What `ir2rwat.model_doors` gives for the OBJ with the animated groups, from python3; null where it does not run. */
function pythonDoors(animated: string[]): { id: string }[] | null {
  if (!havePython) return null;
  const script = 'import ir2rwat, json\nprint(json.dumps(ir2rwat.model_doors(ir2rwat.parse_obj(open(sys.argv[2], "rb").read())[3], set(json.loads(sys.argv[1])))))';
  return runPythonJson(script, [JSON.stringify(animated.map((group) => group.toLowerCase())), objFile]) as { id: string }[];
}

async function draftOf(by: DoorsByNames) {
  await by.request();
  const outcome = by.outcome.value;
  if (outcome.phase !== 'draft') throw new Error(`no draft: ${JSON.stringify(outcome)}`);
  return outcome.doors;
}

describe('the groups an animation of the model moves', () => {
  it('are the keys of its animations, whatever their case', () => {
    expect(animatedGroups({ animations: { doora: 'x', DoorB: 'y' } })).toEqual(['doora', 'DoorB']);
    expect(animatedGroups({})).toEqual([]);
    expect(animatedGroups(null)).toEqual([]);
  });
});

describe('doors found by names', () => {
  it('are the converter’s doors for the model: DOOR_<n> doorways and the animated widget; drawn dashed; nothing asked before the button', async () => {
    const { b, by, stop } = await boxBench({});
    useSuggestBridge(bridge);
    expect(bridge.progress.stage).toBe('idle');
    const doors = await draftOf(by);
    const theirs = pythonDoors(['doora']);
    if (theirs !== null) expect(doors).toEqual(theirs);
    expect(doors.map((door) => door.id).sort()).toEqual(['DoorA', 'door_1', 'door_3']);
    // DOOR_1_EXTERNAL is a way in and out; the widget on an animated group and DOOR_3.001 are doors between zones
    expect(doors.find((door) => door.id === 'door_1')).not.toHaveProperty('inner');
    expect(doors.find((door) => door.id === 'DoorA')).toMatchObject({ inner: true });
    const drawn = b.view.overlays.get(DOORS_DRAFT_LAYER);
    expect(drawn).toHaveLength(3);
    expect(drawn?.every((shape) => shape.shape === 'box' && shape.style === 'draft')).toBe(true);
    stop();
  }, 60_000);

  it('without the animation the widget leaf is no door: the model’s animations are what tells', async () => {
    const { by, stop } = await boxBench({}, { obj: 'stock/box.obj' });
    useSuggestBridge(bridge);
    const doors = await draftOf(by);
    expect(doors.map((door) => door.id).sort()).toEqual(['door_1', 'door_3']);
    stop();
  }, 60_000);

  it('taken, add the doors the type lacks by id (case aside), leave its own as they are, in one entry; undone, the file is as it was', async () => {
    const own = { id: 'doora', min: [1, 1, 1], max: [2, 2, 2], inner: true, group: 'mine' };
    const { b, by, stop } = await boxBench({ doors: [own] });
    useSuggestBridge(bridge);
    const before = await b.pack.value?.text(TYPE);
    await draftOf(by);
    expect(by.found.value.map(({ door, present }) => [door.id, present]).sort()).toEqual([['DoorA', true], ['door_1', false], ['door_3', false]]);
    expect(by.stale.value).toBe(false);
    const entries = b.journal.state().done.length;
    expect(by.accept()).toBe(true);
    expect(b.journal.state().done).toHaveLength(entries + 1);
    expect(b.journal.state().done.at(-1)).toMatchObject({ label: 'tools.suggest.cmd.doors', labelParams: { count: 2 } });
    const doors = (b.pack.value?.json(TYPE) as { doors: { id: string }[] }).doors;
    expect(doors.map((door) => door.id)).toEqual(['doora', 'door_1', 'door_3']);
    expect(doors[0]).toEqual(own);
    expect(by.outcome.value.phase).toBe('idle');
    expect(b.view.overlays.has(DOORS_DRAFT_LAYER)).toBe(false);
    b.journal.undo();
    expect(await b.pack.value?.text(TYPE)).toBe(before);
    stop();
  }, 60_000);

  it('make the list of doors when the type has none; found again, there is nothing new to take', async () => {
    const { b, by, stop } = await boxBench({});
    useSuggestBridge(bridge);
    await draftOf(by);
    expect(by.accept()).toBe(true);
    expect((b.pack.value?.json(TYPE) as { doors: { id: string }[] }).doors.map((door) => door.id).sort()).toEqual(['DoorA', 'door_1', 'door_3']);
    await draftOf(by);
    expect(by.found.value.every((entry) => entry.present)).toBe(true);
    const entries = b.journal.state().done.length;
    expect(by.accept()).toBe(false);
    expect(b.journal.state().done).toHaveLength(entries);
    stop();
  }, 60_000);

  it('rejected, change nothing; stale when the type’s doors change after the search', async () => {
    const { b, by, stop } = await boxBench({});
    useSuggestBridge(bridge);
    await draftOf(by);
    by.reject();
    expect(by.outcome.value.phase).toBe('idle');
    expect(b.view.overlays.has(DOORS_DRAFT_LAYER)).toBe(false);
    expect(b.journal.state().done).toHaveLength(0);

    await draftOf(by);
    b.journal.dispatch({ label: 'x', ops: [{ op: 'set', file: TYPE, at: '/doors', value: [{ id: 'x', min: [0, 0, 0], max: [1, 1, 1] }] }] });
    expect(by.stale.value).toBe(true);
    expect(by.accept()).toBe(false);
    stop();
  }, 60_000);

  it('come with what the floor check would newly say of them, before they are taken', async () => {
    // a floor that ends short of DOOR_1_EXTERNAL's wall
    const { by, stop } = await boxBench({ interior: [{ min: [-3, 0.9, -0.5], max: [3, 3.4, 0.5] }] });
    useSuggestBridge(bridge);
    await draftOf(by);
    expect(by.problems.value.map((problem) => problem.code)).toContain('floor.door-not-at-floor-end');
    stop();
  }, 60_000);
});

describe('a call that does not finish or cannot be made', () => {
  it('Cancel stops it: no draft, nothing said; the model’s animated groups are what it asks with', async () => {
    const { by, stop } = await boxBench({});
    const spy = fakeBridge();
    useSuggestBridge(spy);
    const asked = by.request();
    await vi.waitFor(() => expect(spy.calls).toHaveLength(1));
    expect(spy.calls[0]?.args).toEqual([['doora']]);
    by.cancel();
    await asked;
    expect(by.outcome.value.phase).toBe('idle');
    expect(by.running.value).toBeNull();
    stop();
  });

  it('a model with no OBJ to read is said at once, nothing asked', async () => {
    const { by, stop } = await boxBench({}, undefined, false);
    const spy = fakeBridge();
    useSuggestBridge(spy);
    await by.request();
    const outcome = by.outcome.value;
    expect(outcome.phase === 'failed' && outcome.said.text).toBe('The wagon has no OBJ model that reads: nothing to give the generator.');
    expect(spy.calls).toEqual([]);
    stop();
  });
});

describe('the command', () => {
  it('has no ops when every door is there', () => {
    const type = { doors: [{ id: 'A', min: [0, 0, 0], max: [1, 1, 1] }] };
    const found = foundDoors(type, [{ id: 'a', min: [0, 0, 0], max: [1, 1, 1] }]);
    expect(acceptDoors(TYPE, type, found).ops).toEqual([]);
  });
});
