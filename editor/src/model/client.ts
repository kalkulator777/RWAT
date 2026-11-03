/**
 * The model worker's client on the main thread (docs/proposals/editor.md §3.4, §3.11):
 * `loader.load(files, request)` → a {@link ParsedModel}, parsed in the worker, its
 * buffers transferred. The main thread holds the pack: the worker asks it for each file
 * it reads through a comlink proxy, and the client notes the stamp of every file asked
 * for, so the cache (./cache.ts) knows what to read again after an edit.
 *
 * The cache owns nothing it must free: a model dropped from it is left to the garbage
 * collector, its bitmaps too (they are not closed, as the view may still draw one).
 */

import { proxy, releaseProxy, wrap, type Remote } from 'comlink';
import { ModelCache, type Stamp } from './cache';
import type { ModelFiles } from './files';
import type { ModelReader, ModelRequest, ModelWorkerApi, ParsedModel } from './types';

/** The stamp of the declaration's value in a cache entry: the value is the request's, not a file's. */
const DECLARATION = '\u0000declaration';

/** A model worker running: its interface and how to stop it. */
export interface ModelWorker {
  api: Remote<ModelWorkerApi>;
  /** Stops the worker; a load under way fails. */
  stop(): void;
}

/**
 * The worker's interface, the worker started by the first call: a page that opens no model
 * starts no worker.
 */
export function lazyModelWorker(): ModelWorkerApi {
  let worker: ModelWorker | null = null;
  const api = (): Remote<ModelWorkerApi> => (worker ??= startModelWorker()).api;
  return {
    load: (request, files) => api().load(request, files),
    textures: (paths, files) => api().textures(paths, files),
  };
}

/** Starts ../workers/model.worker.ts (a module worker, bundled by Vite). */
export function startModelWorker(): ModelWorker {
  const worker = new Worker(new URL('../workers/model.worker.ts', import.meta.url), { type: 'module', name: 'rwat-model' });
  const api = wrap<ModelWorkerApi>(worker);
  return {
    api,
    stop: () => {
      api[releaseProxy]();
      worker.terminate();
    },
  };
}

/** A reader for the worker that notes the stamp of every file it is asked for. */
function noting(files: ModelFiles, stamps: Map<string, Stamp>): ModelReader {
  return {
    async read(path) {
      stamps.set(path, files.stamp(path));
      return (await files.has(path)) ? await files.read(path) : null;
    },
    async has(path) {
      stamps.set(path, files.stamp(path));
      return await files.has(path);
    },
  };
}

/** Loads models through a worker, keeping the last few (§3.11: three). */
export class ModelLoader {
  private readonly cache: ModelCache<ParsedModel>;
  private readonly pending = new Map<string, { declaration: string; model: Promise<ParsedModel> }>();

  /**
   * @param worker   the worker's interface: {@link startModelWorker}'s `api`, or ./api.ts
   *                 `createModelApi()` itself (tests, or no worker)
   * @param capacity how many models stay in memory
   */
  constructor(
    private readonly worker: ModelWorkerApi | Remote<ModelWorkerApi>,
    capacity = 3,
  ) {
    this.cache = new ModelCache(capacity);
  }

  /** The keys of the models in memory (their declarations' paths), least recently used first. */
  cached(): string[] {
    return this.cache.keys();
  }

  /**
   * The model a request names, from memory when none of its files changed since it was
   * read, else read in the worker. A model that can't be read comes back empty with one
   * finding; a second request for the same model while it is read waits for that reading.
   */
  async load(files: ModelFiles, request: ModelRequest): Promise<ParsedModel> {
    const declaration = JSON.stringify(request.declaration) ?? 'undefined';
    const stampOf = (path: string): Stamp => (path === DECLARATION ? declaration : files.stamp(path));
    const cached = this.cache.get(request.file, stampOf);
    if (cached !== undefined) return cached;
    const running = this.pending.get(request.file);
    if (running !== undefined && running.declaration === declaration) return running.model;
    const stamps = new Map<string, Stamp>([[DECLARATION, declaration]]);
    const model = this.worker.load(request, proxy(noting(files, stamps)));
    this.pending.set(request.file, { declaration, model });
    try {
      const loaded = await model;
      this.cache.put(request.file, stamps, loaded);
      return loaded;
    } finally {
      if (this.pending.get(request.file)?.model === model) this.pending.delete(request.file);
    }
  }

  /** Decodes textures by pack path in the worker (a livery's): null for a missing or broken one. Not cached. */
  textures(files: ModelFiles, paths: readonly string[]): Promise<Record<string, ImageBitmap | null>> {
    return this.worker.textures([...paths], proxy(noting(files, new Map())));
  }

  /** Forgets every model (another pack opened, the pack closed). */
  clear(): void {
    this.cache.clear();
  }
}
