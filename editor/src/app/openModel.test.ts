/**
 * The open model (./openModel.ts) on the example pack: the wagon the selection points at
 * is read by the model pipeline (the worker's own code, here in this thread), shown in a
 * view that records what it is told, given its type's frame and handed to the preview; its
 * findings join the checks; an edit of its files reads it again, an edit of anything else
 * does not; another pack closes it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { failedModel } from '../checks/model/problems';
import type { Command, Link } from '../core/contracts';
import { MemorySource, readTree } from '../core/pack/testing.node';
import { createModelApi } from '../model/api';
import { ModelLoader } from '../model/client';
import type { ModelWorkerApi } from '../model/types';
import { PreviewController } from '../preview/controller';
import { fakeBitmap, recordingView, type RecordingView } from '../preview/testing.node';
import { EXAMPLE_PACK } from '../testing/repo.node';
import { connectModel, stockIdOf, wagonToOpen } from './openModel';
import { openSource } from './session';
import { findings, journal, modelLoading, modelProblems, openModel, openWagon, pack, revision, selection } from './store';

const COACH = 'rwat_example:coach';
const SHUNTER = 'rwat_example:shunter';
const COACH_MODEL = 'assets/rwat_example/wagon_models/coach.json';
const COACH_TYPE = 'data/rwat_example/wagon_types/coach.json';
const SHUNTER_MODEL = 'assets/rwat_example/wagon_models/shunter.json';
const SHUNTER_TYPE = 'data/rwat_example/wagon_types/shunter.json';

const files = readTree(EXAMPLE_PACK);

interface Rig {
  view: RecordingView;
  preview: PreviewController;
  loader: ModelLoader;
  loads: string[];
  stop: () => void;
}

const stops: (() => void)[] = [];

function wire(api: ModelWorkerApi = createModelApi((_bytes, path) => Promise.resolve(fakeBitmap(path)))): Rig {
  const loads: string[] = [];
  const counting: ModelWorkerApi = {
    load: (request, reader) => {
      loads.push(request.id);
      return api.load(request, reader);
    },
    textures: (paths, reader) => api.textures(paths, reader),
  };
  const view = recordingView();
  const preview = new PreviewController({ every: () => () => undefined });
  preview.view.value = view;
  const loader = new ModelLoader(counting);
  const stop = connectModel({ loader, view, preview, delayMs: 0 });
  stops.push(stop, () => preview.dispose());
  return { view, preview, loader, loads, stop };
}

/** How many times the view was given a frame. */
function framesGiven(rig: Rig): number {
  return rig.view.calls.filter((call) => call.method === 'setFrame').length;
}

function reset(): void {
  for (const stop of stops.splice(0)) stop();
  pack.value = null;
  journal.value = null;
  selection.value = [];
  revision.value = 0;
  openWagon.value = null;
  openModel.value = null;
  modelProblems.value = [];
  modelLoading.value = false;
}

beforeEach(reset);
afterEach(reset);

async function openExample(only?: (path: string) => boolean): Promise<void> {
  const chosen = only === undefined ? files : new Map([...files].filter(([path]) => only(path)));
  expect(await openSource(new MemorySource(chosen, 'RwatExamplePack'))).toBe(true);
}

function select(...links: Link[]): void {
  selection.value = links;
}

function edit(command: Command): void {
  journal.value!.dispatch(command);
}

/** Waits until the view has shown `count` models and the last reading is done. */
async function shown(rig: Rig, count: number): Promise<void> {
  await vi.waitFor(() => {
    expect(rig.view.shown).toHaveLength(count);
    expect(modelLoading.value).toBe(false);
  });
}

describe('the wagon to open', () => {
  const stock = [
    { id: 'a:one', type: 'data/a/wagon_types/one.json', model: 'assets/a/wagon_models/one.json' },
    { id: 'a:two', type: 'data/a/wagon_types/two.json', model: null },
  ];

  it('is the one the selection points at, by file, field or object', () => {
    expect(stockIdOf([{ kind: 'file', file: 'pack.mcmeta' }, { kind: 'field', file: 'data/a/wagon_types/two.json', at: '/mass_t' }], stock)).toBe('a:two');
    expect(stockIdOf([{ kind: 'object', model: 'a:one', name: 'ROOF' }], stock)).toBe('a:one');
    expect(stockIdOf([{ kind: 'object', model: 'b:one', name: 'ROOF' }, { kind: 'zone', type: 'a:one', index: 0 }], stock)).toBeNull();
  });

  it('stays the one open while the selection points elsewhere, and is the only wagon with a model when none is', () => {
    expect(wagonToOpen([{ kind: 'file', file: 'pack.mcmeta' }], stock, 'a:two')).toBe('a:two');
    expect(wagonToOpen([], stock, 'a:gone')).toBe('a:one');
    expect(wagonToOpen([], [...stock, { id: 'a:three', type: null, model: 'assets/a/wagon_models/three.json' }], null)).toBeNull();
  });
});

describe('the open model', () => {
  it('is read when a wagon is selected, shown with its frame, previewed with its type, and stays through other clicks', async () => {
    const rig = wire();
    await openExample();
    expect(openWagon.value).toBeNull();
    expect(rig.view.shown).toEqual([]);

    select({ kind: 'file', file: COACH_MODEL });
    expect(openWagon.value).toBe(COACH);
    await shown(rig, 1);
    const coach = rig.view.shown[0]!;
    expect(coach.id).toBe(COACH);
    expect(openModel.value).toBe(coach);
    expect(rig.view.frame?.length).toBe(20);
    expect(rig.preview.subject.value?.model).toBe(coach);
    expect(rig.preview.subject.value?.type?.id).toBe(COACH);
    // the preview has told the view where the coach's doors and couplers stand
    expect(rig.view.visible.size).toBeGreaterThan(0);

    // an object of it, a field of its type, nothing of a wagon: the coach stays, read once
    select({ kind: 'object', model: COACH, name: 'ROOF' });
    select({ kind: 'field', file: COACH_TYPE, at: '/mass_t' });
    select({ kind: 'file', file: 'pack.mcmeta' });
    select();
    await Promise.resolve();
    expect(openWagon.value).toBe(COACH);
    expect(rig.view.shown).toHaveLength(1);
    expect(rig.loads).toEqual([COACH]);

    select({ kind: 'file', file: SHUNTER_TYPE });
    await shown(rig, 2);
    expect(rig.view.shown[1]!.id).toBe(SHUNTER);
    expect(rig.preview.subject.value?.type?.id).toBe(SHUNTER);
    // back to the coach: from the loader's memory, not read again
    select({ kind: 'file', file: COACH_MODEL });
    await shown(rig, 3);
    expect(rig.view.shown[2]).toBe(coach);
    expect(rig.loads).toEqual([COACH, SHUNTER]);
  });

  it('is read again after an edit of its declaration, and not after an edit of anything else; an edit of its type changes the frame and the preview', async () => {
    const rig = wire();
    await openExample();
    select({ kind: 'file', file: SHUNTER_MODEL });
    await shown(rig, 1);
    const before = rig.view.shown[0]!;
    expect(before.objects.find((o) => o.name.startsWith('CAB_'))?.role).not.toBe('skip');

    edit({ label: 'edit.field', ops: [{ op: 'set', file: COACH_TYPE, at: '/mass_t', value: 40 }] });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(rig.view.shown).toHaveLength(1);

    const frames = framesGiven(rig);
    edit({ label: 'edit.field', ops: [{ op: 'set', file: SHUNTER_TYPE, at: '/length', value: 12 }] });
    await vi.waitFor(() => expect(framesGiven(rig)).toBe(frames + 1));
    expect(rig.view.frame?.length).toBe(12);
    expect(rig.view.shown).toHaveLength(1);
    expect(rig.preview.subject.value?.model).toBe(before);
    expect(rig.preview.subject.value?.type?.length).toBe(12);
    // the preview keeps its state through an edit of the type: a door opened stays open
    rig.preview.setDoor(1, 1);
    edit({ label: 'edit.field', ops: [{ op: 'set', file: SHUNTER_TYPE, at: '/length', value: 13 }] });
    await vi.waitFor(() => expect(rig.preview.subject.value?.type?.length).toBe(13));
    expect(rig.preview.state.value?.doors).toEqual([0, 1]);

    edit({ label: 'edit.field', ops: [{ op: 'set', file: SHUNTER_MODEL, at: '/skip', value: ['CAB_'] }] });
    await shown(rig, 2);
    const after = rig.view.shown[1]!;
    expect(after).not.toBe(before);
    expect(after.objects.filter((o) => o.name.startsWith('CAB_')).every((o) => o.role === 'skip')).toBe(true);
    expect(openModel.value).toBe(after);
    expect(rig.loads).toEqual([SHUNTER, SHUNTER]);
  });

  it('puts the findings of a model that can’t be read among the checks, until it can', async () => {
    const rig = wire();
    await openExample();
    select({ kind: 'file', file: COACH_MODEL });
    await shown(rig, 1);
    expect(findings.value.filter((p) => p.source === 'model')).toEqual([]);

    edit({ label: 'edit.field', ops: [{ op: 'set', file: COACH_MODEL, at: '/obj', value: 'stock/coach/none.obj' }] });
    await shown(rig, 2);
    expect(rig.view.shown[1]!.parts).toEqual([]);
    await vi.waitFor(() => expect(findings.value.filter((p) => p.source === 'model').map((p) => p.code)).toEqual(['model.missing']));
    expect(modelProblems.value[0]?.at).toEqual([{ kind: 'field', file: COACH_MODEL, at: '/obj' }]);

    journal.value!.undo();
    await shown(rig, 3);
    expect(rig.view.shown[2]!.parts.length).toBeGreaterThan(0);
    expect(findings.value.filter((p) => p.source === 'model')).toEqual([]);
  });

  it('is one finding when the worker fails, and nothing is shown', async () => {
    const failing: ModelWorkerApi = { load: () => Promise.reject(new Error('worker gone')), textures: () => Promise.resolve({}) };
    const rig = wire(failing);
    await openExample();
    select({ kind: 'file', file: COACH_MODEL });
    await vi.waitFor(() => expect(modelProblems.value).toHaveLength(1));
    expect(modelProblems.value[0]).toMatchObject({ severity: 'error', source: 'model', code: 'model.failed', text: 'model rwat_example:coach could not be read: worker gone' });
    // the finding "Check all models" makes of a worker that fails, word for word
    expect(modelProblems.value[0]).toEqual(failedModel({ id: COACH, file: COACH_MODEL }, new Error('worker gone')));
    expect(findings.value).toContain(modelProblems.value[0]);
    expect(rig.view.shown).toEqual([]);
    expect(openModel.value).toBeNull();
  });

  it('closes when another pack opens, which opens its only wagon at once; and follows nothing once stopped', async () => {
    const rig = wire();
    await openExample();
    select({ kind: 'file', file: SHUNTER_MODEL });
    await shown(rig, 1);

    // the example pack without the coach and the gondola: one wagon with a model left
    await openExample((path) => !/\/(coach|gondola)(\.|\/)/.test(path));
    // the model of the pack before goes at once, before the new one is read
    expect(rig.view.shown.at(-1)).toBeNull();
    expect(rig.preview.subject.value).toBeNull();
    expect(openWagon.value).toBe(SHUNTER);
    await shown(rig, 3);
    expect(rig.view.shown[2]!.id).toBe(SHUNTER);
    // a pack of its own: the shunter is read anew, not taken from the other pack's memory
    expect(rig.loads).toEqual([SHUNTER, SHUNTER]);

    rig.stop();
    select({ kind: 'file', file: COACH_MODEL });
    pack.value = null;
    await Promise.resolve();
    expect(rig.view.shown).toHaveLength(3);
  });
});
