/**
 * Node only (tests of the suggestions): the bridge on the real Python (Pyodide in Node, the
 * same code and the same tools/ files the worker runs: ir/testing.node `nodePython`), a
 * bridge that answers as the test says, and a wagon of a pack made here, of our own bytes,
 * wired as the shell wires one (tools/testing.node `Bench`).
 */

import { signal } from '@preact/signals';
import type { Command, Link, LoadedModel } from '../../core/contracts';
import { Journal } from '../../core/journal';
import { Pack } from '../../core/pack';
import { MemorySource, filesOf } from '../../core/pack/testing.node';
import { BridgeError, PythonBridge, type LoadProgress } from '../../ir/bridge';
import { nodePython } from '../../ir/testing.node';
import { exampleApi } from '../../model/testing.node';
import { ViewState } from '../../view3d/state';
import type { ToolWiring } from '../registry';
import type { Bench } from '../testing.node';
import type { SuggestBridge } from './bridge';

/** A bridge on the real Python in Node: Pyodide loads at the first call, as in the page. */
export function realBridge(): PythonBridge {
  const api = nodePython();
  return new PythonBridge(() => ({ api, stop: () => undefined }), () => ({}));
}

/** What a stand-in bridge was asked, and how to answer. */
export interface FakeBridge extends SuggestBridge {
  readonly calls: { method: string; signal: AbortSignal | undefined; args: unknown[] }[];
  /** Tells the progress listeners (as the bridge does while Pyodide loads). */
  report(progress: LoadProgress): void;
}

/**
 * A bridge whose calls wait until the test lets them go (`release`) or the call's signal
 * aborts them (`cancelled`, as the real bridge does).
 */
export function fakeBridge(answer: { suggestFloor?: () => unknown; modelDoors?: () => unknown; rewriteReferences?: () => unknown } = {}): FakeBridge & { release(): void } {
  const calls: FakeBridge['calls'] = [];
  const listeners = new Set<(progress: LoadProgress) => void>();
  let progress: LoadProgress = { stage: 'idle', loaded: 0, total: 0 };
  const waiting: (() => void)[] = [];
  const call = (method: string, value: (() => unknown) | undefined, options: { signal?: AbortSignal } | undefined, args: unknown[] = []): Promise<never> => {
    calls.push({ method, signal: options?.signal, args });
    return new Promise((resolve, reject) => {
      waiting.push(() => resolve((value?.() ?? null) as never));
      options?.signal?.addEventListener('abort', () => reject(BridgeError.of('cancelled', 'Cancelled', 'cancelled')), { once: true });
    });
  };
  return {
    calls,
    get progress() {
      return progress;
    },
    onProgress(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    report(next) {
      progress = next;
      for (const listener of listeners) listener(next);
    },
    release() {
      for (const go of waiting.splice(0)) go();
    },
    suggestFloor: (_obj, generator, doors, options) => call('suggestFloor', answer.suggestFloor, options, [generator, doors]),
    modelDoors: (_obj, animated, options) => call('modelDoors', answer.modelDoors, options, [animated]),
    rewriteReferences: (_raw, keyword, moved, options) => call('rewriteReferences', answer.rewriteReferences, options, [keyword, moved]),
  };
}

/** A pack of files made here (texts, or bytes), opened in memory with its journal. */
export async function packOf(files: Record<string, string | Uint8Array>): Promise<{ pack: Pack; journal: Journal }> {
  const pack = await Pack.open(new MemorySource(filesOf(files), 'test'));
  return { pack, journal: new Journal(pack) };
}

/**
 * A wagon of a pack made here wired as the shell wires one: its model read as the model
 * worker reads it (the textures stood in for), its journal and selection open to the test.
 */
export async function wagonBench(files: Record<string, string | Uint8Array>, wagon: string): Promise<Bench> {
  const { pack, journal } = await packOf(files);
  const [namespace, name] = wagon.split(':') as [string, string];
  const file = `assets/${namespace}/wagon_models/${name}.json`;
  const model: LoadedModel = await exampleApi.load(
    { id: wagon, file, declaration: pack.json(file) },
    { read: async (path) => (pack.has(path) ? pack.bytes(path) : null), has: (path) => Promise.resolve(pack.has(path)) },
  );
  const revision = signal(0);
  journal.subscribe(() => {
    revision.value++;
  });
  const commands: Command[] = [];
  const state = {
    pack: signal<Pack | null>(pack),
    journal,
    revision,
    openWagon: signal<string | null>(wagon),
    openModel: signal<LoadedModel | null>(model),
    selection: signal<readonly Link[]>([]),
    previewDoors: signal<number | null>(null),
    view: new ViewState(),
    commands,
  };
  const wiring: ToolWiring = {
    ...state,
    dispatch: (command) => {
      commands.push(command);
      try {
        journal.dispatch(command);
        return true;
      } catch {
        return false;
      }
    },
  };
  return { ...state, wiring };
}
