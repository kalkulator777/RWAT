/**
 * The bridge's client (./bridge.ts `PythonBridge`) against stand-in workers: it starts one
 * worker on the first call and loads Pyodide once, passes the progress on, turns failures
 * into `BridgeError`s, and cancels by stopping the worker — every call under way fails,
 * the next one starts a new worker, nothing is left waiting. One test goes through
 * comlink over a MessageChannel, as the page talks to the worker. Pyodide itself is
 * ./python.test.ts's.
 */

import { expose, wrap } from 'comlink';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BridgeError, converterProblems, PythonBridge, type ConvertResult, type FloorSuggestion, type LoadProgress, type Outcome, type PythonApi, type PythonWorker } from './bridge';

const FLOOR: FloorSuggestion = { interior: [{ min: [0, 1, 0], max: [1, 3.5, 1] }], levels: [1], notes: [], regionArea: 1, droppedArea: 0 };
const ok = <T>(value: T): Promise<Outcome<T>> => Promise.resolve({ ok: true, value });

/** A stand-in for the worker's interface: answers at once unless a method is replaced. */
function fakeApi(overrides: Partial<PythonApi> = {}): PythonApi {
  return {
    start: () => ok({ pyodide: '0', python: '3', loadMs: 1 }),
    convert: () => ok({ exitCode: 0, report: { refusal: null, warnings: [], errors: [], stock: [], rails: [], log: [] }, pack: null }),
    modelDoors: () => ok([]),
    suggestFloor: () => ok(FLOOR),
    rewriteReferences: () => ok(null),
    memory: () => Promise.resolve(0),
    ...overrides,
  };
}

/** A spawner that counts the workers it starts and stops, each from `make`. */
function spawner(make: (n: number) => PythonApi = () => fakeApi()) {
  const workers: { stopped: number; fail: (message: string) => void }[] = [];
  const spawn = (onFailure: (message: string) => void): PythonWorker => {
    const record = { stopped: 0, fail: onFailure };
    workers.push(record);
    return { api: make(workers.length - 1), stop: () => record.stopped++ };
  };
  return { spawn, workers };
}

const never = <T>(): Promise<T> => new Promise<T>(() => {});

const channels: MessageChannel[] = [];
afterEach(() => {
  for (const channel of channels.splice(0)) {
    channel.port1.close();
    channel.port2.close();
  }
});

describe('PythonBridge', () => {
  it('starts nothing until the first call, then one worker and one start for calls at once', async () => {
    const start = vi.fn(() => ok({ pyodide: '0', python: '3', loadMs: 1 }));
    const { spawn, workers } = spawner(() => fakeApi({ start }));
    const bridge = new PythonBridge(spawn, () => ({ indexURL: 'x/' }));
    expect(workers).toHaveLength(0);
    const [a, b] = await Promise.all([bridge.suggestFloor(new Uint8Array(), {}, []), bridge.modelDoors(new Uint8Array(), [])]);
    expect(a).toEqual(FLOOR);
    expect(b).toEqual([]);
    await bridge.start();
    expect(workers).toHaveLength(1);
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith({ indexURL: 'x/' }, expect.any(Function));
  });

  it('passes the loading progress on, and says ready when started', async () => {
    let report: ((progress: LoadProgress) => void) | undefined;
    let finish: (() => void) | undefined;
    const { spawn } = spawner(() =>
      fakeApi({
        start: (_options, onProgress) => {
          report = onProgress;
          return new Promise((resolve) => (finish = () => resolve({ ok: true, value: { pyodide: '0', python: '3', loadMs: 1 } })));
        },
      }),
    );
    const bridge = new PythonBridge(spawn, () => ({}));
    const heard: LoadProgress[] = [];
    bridge.onProgress((progress) => heard.push(progress));
    expect(bridge.progress.stage).toBe('idle');
    const started = bridge.start();
    report?.({ stage: 'download', loaded: 5, total: 10 });
    report?.({ stage: 'start', loaded: 10, total: 10 });
    finish?.();
    await started;
    expect(heard.map((p) => p.stage)).toEqual(['download', 'download', 'start', 'ready']);
    expect(bridge.progress).toEqual({ stage: 'ready', loaded: 10, total: 10 });
  });

  it('turns a Python failure into a BridgeError with its type and traceback, and keeps the worker', async () => {
    const { spawn, workers } = spawner(() =>
      fakeApi({
        suggestFloor: () =>
          Promise.resolve({ ok: false, error: { kind: 'python', type: 'FloorConfigError', message: 'bad', text: 'bad', traceback: 'Traceback …' } }),
      }),
    );
    const bridge = new PythonBridge(spawn, () => ({}));
    const error = await bridge.suggestFloor(new Uint8Array(), { bogus: 1 }, []).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BridgeError);
    expect(error).toMatchObject({ kind: 'python', type: 'FloorConfigError', message: 'bad', traceback: 'Traceback …' });
    await bridge.modelDoors(new Uint8Array(), []);
    expect(workers).toHaveLength(1);
    expect(workers[0]?.stopped).toBe(0);
  });

  it('cancels by stopping the worker: every call under way fails, the next starts a new worker', async () => {
    const { spawn, workers } = spawner((n) => fakeApi(n === 0 ? { suggestFloor: never, convert: never } : {}));
    const bridge = new PythonBridge(spawn, () => ({}));
    const abort = new AbortController();
    const floor = bridge.suggestFloor(new Uint8Array(), {}, [], { signal: abort.signal });
    const other = bridge.convert({ recipe: {}, sources: {}, output: 'zip' });
    await bridge.start();
    abort.abort();
    await expect(floor).rejects.toMatchObject({ kind: 'cancelled' });
    await expect(other).rejects.toMatchObject({ kind: 'cancelled' });
    expect(workers[0]?.stopped).toBe(1);
    expect(bridge.progress.stage).toBe('idle');
    expect(await bridge.suggestFloor(new Uint8Array(), {}, [])).toEqual(FLOOR);
    expect(workers).toHaveLength(2);
    expect(workers[1]?.stopped).toBe(0);
  });

  it('fails at once on a signal already aborted, starting nothing', async () => {
    const { spawn, workers } = spawner();
    const bridge = new PythonBridge(spawn, () => ({}));
    await expect(bridge.suggestFloor(new Uint8Array(), {}, [], { signal: AbortSignal.abort() })).rejects.toMatchObject({ kind: 'cancelled' });
    expect(workers).toHaveLength(0);
  });

  it('stops a worker that threw instead of answering, and a worker that died; the next call starts anew', async () => {
    const { spawn, workers } = spawner((n) =>
      fakeApi(n === 0 ? { modelDoors: () => Promise.reject(new Error('RangeError: out of memory')) } : n === 1 ? { suggestFloor: never } : {}),
    );
    const bridge = new PythonBridge(spawn, () => ({}));
    await expect(bridge.modelDoors(new Uint8Array(), [])).rejects.toMatchObject({ kind: 'worker', message: 'RangeError: out of memory' });
    expect(workers[0]?.stopped).toBe(1);
    const waiting = bridge.suggestFloor(new Uint8Array(), {}, []);
    await bridge.start();
    workers[1]?.fail('the worker died');
    await expect(waiting).rejects.toMatchObject({ kind: 'worker', message: 'the worker died' });
    expect(workers[1]?.stopped).toBe(1);
    expect(await bridge.modelDoors(new Uint8Array(), [])).toEqual([]);
    expect(workers).toHaveLength(3);
  });

  it('tries the start again after one that failed', async () => {
    const { spawn, workers } = spawner((n) =>
      fakeApi(n === 0 ? { start: () => Promise.resolve({ ok: false, error: { kind: 'worker', type: 'TypeError', message: 'no wasm', text: 'no wasm', traceback: '' } }) } : {}),
    );
    const bridge = new PythonBridge(spawn, () => ({}));
    await expect(bridge.start()).rejects.toMatchObject({ kind: 'worker', message: 'no wasm' });
    expect(workers[0]?.stopped).toBe(1);
    await expect(bridge.start()).resolves.toMatchObject({ pyodide: '0' });
    expect(workers).toHaveLength(2);
  });

  it('works through comlink: the log heard line by line, the pack transferred', async () => {
    const zip = new Uint8Array([1, 2, 3]);
    const inner = fakeApi({
      convert: (_request, onLog) => {
        void onLog?.('Source a');
        void onLog?.('  wagon x');
        const value: ConvertResult = { exitCode: 0, report: { refusal: null, warnings: [], errors: [], stock: [], rails: [], log: ['Source a', '  wagon x'] }, pack: { kind: 'zip', name: 'P.zip', bytes: zip } };
        return ok(value);
      },
    });
    const spawn = (): PythonWorker => {
      const channel = new MessageChannel();
      channels.push(channel);
      expose(inner, channel.port2);
      return { api: wrap<PythonApi>(channel.port1), stop: () => channel.port1.close() };
    };
    const bridge = new PythonBridge(spawn, () => ({}));
    const lines: string[] = [];
    const result = await bridge.convert({ recipe: {}, sources: {}, output: 'zip' }, { onLog: (line) => lines.push(line) });
    await vi.waitFor(() => expect(lines).toEqual(['Source a', '  wagon x']));
    expect(result.pack).toEqual({ kind: 'zip', name: 'P.zip', bytes: new Uint8Array([1, 2, 3]) });
  });
});

describe('converterProblems', () => {
  it('makes the refusal and the errors errors, the warnings warnings, as the converter words them', () => {
    const problems = converterProblems({ refusal: 'no "namespace"', errors: ['x: skipped'], warnings: ['unknown key'], stock: [], rails: [], log: [] });
    expect(problems.map((p) => [p.severity, p.code, p.text, p.source])).toEqual([
      ['error', 'converter.refusal', 'no "namespace"', 'converter'],
      ['error', 'converter.error', 'x: skipped', 'converter'],
      ['warning', 'converter.warning', 'unknown key', 'converter'],
    ]);
  });
});
