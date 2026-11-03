import { describe, expect, it } from 'vitest';
import type { Problem } from '../../core/contracts';
import { dump } from '../../core/json';
import { Pack, putJson } from '../../core/pack';
import { EXAMPLE_PACK, MemorySource, readTree } from '../../core/pack/testing.node';
import { createModelApi } from '../../model/api';
import { fakeBitmap } from '../../model/testing.node';
import type { ModelCheckApi } from '../../model/types';
import { isStale, ModelSweep, modelsOf, sweepProblems } from './all';

const api = createModelApi((_bytes, path) => Promise.resolve(fakeBitmap(path)));

async function examplePack(change?: (files: Map<string, Uint8Array>) => void): Promise<Pack> {
  const files = readTree(EXAMPLE_PACK);
  change?.(files);
  return Pack.open(new MemorySource(files));
}

describe('check all models', () => {
  it("finds nothing in the example pack's three models, one after another, all counted", async () => {
    const pack = await examplePack();
    expect(modelsOf(pack).map((m) => m.id)).toEqual(['rwat_example:coach', 'rwat_example:gondola', 'rwat_example:shunter']);
    const sweep = new ModelSweep(() => api);
    const seen: string[] = [];
    const stop = sweep.state.subscribe((state) => {
      if (state.current !== null) seen.push(`${state.done}/${state.total} ${state.current}`);
    });
    await sweep.start(pack);
    stop();
    expect(seen).toEqual(['0/3 rwat_example:coach', '1/3 rwat_example:gondola', '2/3 rwat_example:shunter']);
    expect(sweep.state.value).toMatchObject({ status: 'done', done: 3, total: 3, current: null });
    expect(sweepProblems(sweep.state.value)).toEqual([]);
  });

  it("says what the pack check says of a model's files, and the open model's own reading stands for it", async () => {
    const pack = await examplePack((files) => {
      files.delete('assets/rwat_example/stock/coach/coach_seat.png');
      files.delete('assets/rwat_example/stock/shunter/shunter.mtl');
    });
    const sweep = new ModelSweep(() => api);
    await sweep.start(pack);
    const problems = sweepProblems(sweep.state.value);
    expect(problems.map((p) => [p.code, p.at[0]])).toEqual([
      ['model.missing-texture', { kind: 'file', file: 'assets/rwat_example/stock/coach/coach.mtl' }],
      ['model.missing-library', { kind: 'file', file: 'assets/rwat_example/stock/shunter/shunter.obj' }],
      ['model.draws-nothing', { kind: 'file', file: 'assets/rwat_example/stock/shunter/shunter.obj' }],
      // no library, no texture: the livery has nothing to replace
      ['model.livery-replaces-nothing', { kind: 'field', file: 'assets/rwat_example/wagon_models/shunter.json', at: '/liveries/green' }],
    ]);
    expect(sweepProblems(sweep.state.value, 'assets/rwat_example/wagon_models/coach.json').map((p) => p.code)).toEqual([
      'model.missing-library',
      'model.draws-nothing',
      'model.livery-replaces-nothing',
    ]);
  });

  it('stops after the model being checked, keeps what is checked, and is stale once the pack changes', async () => {
    const pack = await examplePack();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow: ModelCheckApi = {
      check: async (request, files) => {
        if (request.id === 'rwat_example:gondola') await held;
        return api.check(request, files);
      },
    };
    const sweep = new ModelSweep(() => slow);
    const run = sweep.start(pack);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sweep.state.value).toMatchObject({ status: 'running', done: 1, current: 'rwat_example:gondola' });
    sweep.cancel();
    release();
    await run;
    expect(sweep.state.value).toMatchObject({ status: 'cancelled', done: 1, total: 3, current: null });
    expect([...sweep.state.value.results.keys()]).toEqual(['assets/rwat_example/wagon_models/coach.json']);
    expect(isStale(sweep.state.value, pack)).toBe(false);
    pack.apply(putJson('assets/rwat_example/wagon_models/coach.json', { obj: 'stock/coach/coach.obj' }));
    expect(isStale(sweep.state.value, pack)).toBe(true);
    expect(isStale(sweep.state.value, null)).toBe(true);
    sweep.clear();
    expect(sweep.state.value.status).toBe('idle');
    expect(isStale(sweep.state.value, pack)).toBe(false);
  });

  it("makes a worker's failure that model's finding and goes on; leaves out a declaration that is no JSON", async () => {
    const pack = await examplePack((files) => {
      files.set('assets/rwat_example/wagon_models/gondola.json', new TextEncoder().encode('{ broken'));
      files.set('assets/rwat_example/wagon_models/extra.json', new TextEncoder().encode(dump({ obj: 'Bad.obj' })));
    });
    expect(modelsOf(pack).map((m) => m.id)).toEqual(['rwat_example:coach', 'rwat_example:extra', 'rwat_example:shunter']);
    const failing: ModelCheckApi = {
      check: (request, files) => (request.id === 'rwat_example:coach' ? Promise.reject(new Error('worker gone')) : api.check(request, files)),
    };
    const sweep = new ModelSweep(() => failing);
    await sweep.start(pack);
    const problems: Problem[] = sweepProblems(sweep.state.value);
    expect(problems.map((p) => [p.code, p.text])).toEqual([
      ['model.failed', 'model rwat_example:coach could not be read: worker gone'],
      ['model.bad-path', "model path 'rwat_example:Bad.obj' is not a valid resource location"],
    ]);
  });
});
