/**
 * The bridge to the pack tools in Python (docs/proposals/editor.md §3.11, §3.12): the IR
 * converter (`tools/ir2rwat.py`) and the floor generator (`tools/floorgen.py`) run as they
 * are in the repository, in Pyodide, in a worker of their own (R9: no port).
 *
 * - **Lazy.** Nothing is loaded until the first call: Pyodide (about 13 MB) is fetched
 *   when the author goes to the IR import or asks for a suggested floor, once per page
 *   ({@link pythonBridge}); {@link PythonBridge.onProgress} follows the loading.
 * - **One worker** (../workers/pyodide.worker.ts, the Python side in ./python.ts). Calls
 *   wait for each other there: Python runs one at a time.
 * - **Cancel** = stop the worker (Pyodide can only be interrupted with a
 *   SharedArrayBuffer, which needs cross-origin isolation GitHub Pages can't give): every
 *   call under way fails with a {@link BridgeError} of kind `cancelled`, and the next
 *   call starts a new worker, Pyodide from the browser's cache.
 * - **Errors** come as {@link BridgeError}: a Python exception with its type, message,
 *   the converter's wording and the traceback (for debugging), not a string.
 * - **Big inputs**: an IR zip given as a `Blob` (a `File` the author picked) is mounted
 *   in the worker (WORKERFS) and read by Python in place, never copied whole into
 *   memory. Results come back as transferred buffers.
 *
 * The site serves Pyodide itself, from `pyodide/<version>/` next to the page (vite.config.ts):
 * no request goes to a CDN, and the service worker caches the files when first used.
 */

import { releaseProxy, wrap, proxy, type Remote } from 'comlink';
import type { Problem } from '../core/contracts';

/** The folder of Pyodide next to the page and its files' sizes (vite.config.ts `define`). */
declare const __RWAT_PYODIDE__: { dir: string; files: Record<string, number> };

// ------------------------------------------------------------------ the interface

/** A box of the OBJ frame, as the pack writes zones and doors. */
export interface ObjBox {
  min: [number, number, number];
  max: [number, number, number];
}

/** A door as the pack writes it (`id`, `min`, `max`, and flags: `inner`, `connecting`, `group`, …). */
export interface PackDoor extends ObjBox {
  id: string;
  [flag: string]: unknown;
}

/** What floorgen generated for a model (`suggest_floor`), in the OBJ frame. */
export interface FloorSuggestion {
  /** The zones, as a type's `interior` is written. */
  interior: ObjBox[];
  /** The floor heights used (OBJ y). */
  levels: number[];
  /** Things worth telling the author. */
  notes: string[];
  /** The area where a rider's centre fits, m². */
  regionArea: number;
  /** Of it, the area dropped as unreachable from a door, m². */
  droppedArea: number;
}

/** A stock type the converter wrote. */
export interface ConvertedStock {
  id: string;
  /** The source's label. */
  source: string;
  category: string;
  name: string;
  liveries: number;
}

/** A rail style the converter wrote. */
export interface ConvertedRail {
  id: string;
  source: string;
  name: string;
}

/** What `ir2rwat.py` said of a run. */
export interface ConverterReport {
  /** Why it refused (exit status 2), as it says it; null when it did not. */
  refusal: string | null;
  /** `Converter.warnings`: nothing else changes. */
  warnings: string[];
  /** `Converter.errors`: one type or rail style each, not converted or not as asked. */
  errors: string[];
  stock: ConvertedStock[];
  rails: ConvertedRail[];
  /** Everything it printed, line by line (for the log). */
  log: string[];
}

/** A file of the converted pack. */
export interface PackFile {
  path: string;
  bytes: Uint8Array;
}

/** The converted pack: `<pack_dir>.zip` as `--zip` writes it, or its files. */
export type ConvertedPack = { kind: 'zip'; name: string; bytes: Uint8Array } | { kind: 'files'; name: string; files: PackFile[] };

/** The result of a conversion. */
export interface ConvertResult {
  /** The command line's exit status: 0 written, 1 written with errors, 2 refused (nothing written). */
  exitCode: number;
  report: ConverterReport;
  /** Null when refused. */
  pack: ConvertedPack | null;
}

/** A JSON file of the recipe: its value (written as JSON) or the file's bytes as they are. */
export type RecipeFile = unknown;

/** What to convert. The recipe is taken as JSON values (the recipe model is ./recipe/'s). */
export interface ConvertRequest {
  /** The recipe (`packs/<name>.json`). */
  recipe: RecipeFile;
  /** Its file name, as messages name it; default `recipe.json`. */
  recipeName?: string;
  /** The per-type files by type id, written to the recipe's `overrides_dir`. */
  overrides?: Record<string, RecipeFile>;
  /** The IR zips by the path the recipe's `sources[].zip` gives (relative to the recipe). */
  sources: Record<string, Blob | Uint8Array>;
  /** `zip`: `<pack_dir>.zip`, the bytes of `ir2rwat.py --zip`; `files`: the pack's files, as the folder run writes them. */
  output: 'zip' | 'files';
}

/** How far the loading of Pyodide is. */
export interface LoadProgress {
  /** idle → download → start (the interpreter and the tools) → ready. */
  stage: 'idle' | 'download' | 'start' | 'ready';
  /** Bytes fetched so far, of `total` (0 when not known). */
  loaded: number;
  total: number;
}

/** Pyodide running. */
export interface RuntimeInfo {
  pyodide: string;
  python: string;
  /** How long loading took, ms. */
  loadMs: number;
}

/** What the worker needs to load Pyodide: where it is and how big its files are (for the progress). */
export interface StartOptions {
  /** The folder of Pyodide's files, ending in `/`; in Node, unset (the package's own). */
  indexURL?: string;
  sizes?: Record<string, number>;
}

/** Why a call failed. */
export interface Failure {
  /** `python`: an exception in the tools; `bridge`: a request the bridge can't follow; `cancelled`; `worker`: the worker failed. */
  kind: 'python' | 'bridge' | 'cancelled' | 'worker';
  /** The exception's class: `ConversionError`, `FloorConfigError`, `ValueError`, … */
  type: string;
  message: string;
  /** As the converter words it for an author (`ir2rwat.describe`). */
  text: string;
  /** The Python traceback, for debugging; empty when there is none. */
  traceback: string;
}

/** A failed call, as the worker answers it (an exception does not cross comlink whole). */
export type Outcome<T> = { ok: true; value: T } | { ok: false; error: Failure };

/** What ./python.ts gives the worker to expose: each call answers an {@link Outcome}. */
export interface PythonApi {
  start(options: StartOptions, onProgress?: (progress: LoadProgress) => void): Promise<Outcome<RuntimeInfo>>;
  convert(request: ConvertRequest, onLog?: (line: string) => void): Promise<Outcome<ConvertResult>>;
  modelDoors(obj: Uint8Array, animated: string[]): Promise<Outcome<PackDoor[]>>;
  suggestFloor(obj: Uint8Array, options: unknown, doors: readonly unknown[]): Promise<Outcome<FloorSuggestion>>;
  rewriteReferences(raw: Uint8Array, keyword: string, moved: Record<string, string>): Promise<Outcome<Uint8Array | null>>;
  /** The size of Pyodide's memory (the wasm heap), bytes; 0 before it is loaded. */
  memory(): Promise<number>;
}

/** A failed call of the bridge. */
export class BridgeError extends Error implements Failure {
  readonly kind: Failure['kind'];
  readonly type: string;
  readonly text: string;
  readonly traceback: string;

  constructor(failure: Failure) {
    super(failure.message);
    this.name = 'BridgeError';
    this.kind = failure.kind;
    this.type = failure.type;
    this.text = failure.text;
    this.traceback = failure.traceback;
  }

  /** A failure of the bridge itself (no Python involved). */
  static of(kind: Failure['kind'], type: string, message: string): BridgeError {
    return new BridgeError({ kind, type, message, text: message, traceback: '' });
  }
}

/** The converter's report as findings for the checks (source `converter`, the text as it says it). */
export function converterProblems(report: ConverterReport): Problem[] {
  const problem = (severity: Problem['severity'], code: string, text: string): Problem => ({ severity, source: 'converter', code, params: {}, text, at: [] });
  return [
    ...(report.refusal === null ? [] : [problem('error', 'converter.refusal', report.refusal)]),
    ...report.errors.map((text) => problem('error', 'converter.error', text)),
    ...report.warnings.map((text) => problem('warning', 'converter.warning', text)),
  ];
}

// ------------------------------------------------------------------ the client

/** A worker running ./python.ts, and how to stop it. */
export interface PythonWorker {
  api: Remote<PythonApi> | PythonApi;
  stop(): void;
}

/**
 * Starts ../workers/pyodide.worker.ts (a module worker, bundled by Vite). `onFailure` hears
 * of a worker that died (an error outside any call: out of memory, a script that would not load).
 */
export function startPythonWorker(onFailure: (message: string) => void): PythonWorker {
  const worker = new Worker(new URL('../workers/pyodide.worker.ts', import.meta.url), { type: 'module', name: 'rwat-pyodide' });
  worker.addEventListener('error', (event) => onFailure(event.message || 'the Python worker failed'));
  const api = wrap<PythonApi>(worker);
  return {
    api,
    stop: () => {
      api[releaseProxy]();
      worker.terminate();
    },
  };
}

/** Where the page finds Pyodide: `pyodide/<version>/` next to it. */
export function pageStartOptions(): StartOptions {
  return { indexURL: new URL(__RWAT_PYODIDE__.dir, document.baseURI).href, sizes: __RWAT_PYODIDE__.files };
}

/** Options of one call. */
export interface CallOptions {
  /** Aborting stops the worker: this call and every other under way fail as `cancelled`. */
  signal?: AbortSignal;
}

const IDLE: LoadProgress = { stage: 'idle', loaded: 0, total: 0 };

/**
 * The tools in Python, from the main thread. The worker starts with the first call and
 * stays for the page; {@link cancel} stops it.
 */
export class PythonBridge {
  private worker: PythonWorker | null = null;
  private started: Promise<RuntimeInfo> | null = null;
  private readonly pending = new Set<(error: BridgeError) => void>();
  private readonly listeners = new Set<(progress: LoadProgress) => void>();
  private current: LoadProgress = IDLE;

  /**
   * @param spawn   starts a worker ({@link startPythonWorker}; tests give ./python.ts itself)
   * @param options where the worker finds Pyodide ({@link pageStartOptions})
   */
  constructor(
    private readonly spawn: (onFailure: (message: string) => void) => PythonWorker = startPythonWorker,
    private readonly options: () => StartOptions = pageStartOptions,
  ) {}

  /** How far the loading is. */
  get progress(): LoadProgress {
    return this.current;
  }

  /** Hears every change of {@link progress}; returns the way to stop hearing. */
  onProgress(listener: (progress: LoadProgress) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Loads Pyodide and the tools, once; a second call waits for the first. */
  start(call: CallOptions = {}): Promise<RuntimeInfo> {
    return this.guard(call.signal, () => this.ready());
  }

  /** `ir2rwat.py <recipe> --out … [--zip]` on the request; `onLog` hears each printed line as it is printed. */
  convert(request: ConvertRequest, call: CallOptions & { onLog?: (line: string) => void } = {}): Promise<ConvertResult> {
    const onLog = call.onLog;
    return this.call(call.signal, (api) => (onLog === undefined ? api.convert(request) : api.convert(request, proxy(onLog))));
  }

  /** `ir2rwat.model_doors` on an OBJ: its doors as the pack writes them; `animated` — the control groups an animation moves. */
  modelDoors(obj: Uint8Array, animated: readonly string[], call: CallOptions = {}): Promise<PackDoor[]> {
    return this.call(call.signal, (api) => api.modelDoors(obj, [...animated]));
  }

  /**
   * `floorgen.generate` on an OBJ with the per-type `floor` options (`level`: the floor
   * height, OBJ y, as the author clicked or typed it) and the type's doors, without IR's
   * passenger area. A `FloorConfigError` (options it can't take) or a `ValueError` (no
   * floor at the level) fails the call.
   */
  suggestFloor(obj: Uint8Array, options: unknown, doors: readonly unknown[], call: CallOptions = {}): Promise<FloorSuggestion> {
    return this.call(call.signal, (api) => api.suggestFloor(obj, options, doors));
  }

  /** `ir2rwat.rewrite_references`: the file with every `<keyword> <path>` line `moved` maps rewritten; null if nothing moves. */
  rewriteReferences(raw: Uint8Array, keyword: string, moved: Record<string, string>, call: CallOptions = {}): Promise<Uint8Array | null> {
    return this.call(call.signal, (api) => api.rewriteReferences(raw, keyword, moved));
  }

  /** The size of Pyodide's memory, bytes (0 when not loaded). */
  async memory(): Promise<number> {
    return this.worker === null ? 0 : await this.worker.api.memory();
  }

  /** Stops the worker: every call under way fails as `cancelled`; the next call starts anew. */
  cancel(): void {
    this.stop(BridgeError.of('cancelled', 'Cancelled', 'cancelled'));
  }

  private stop(error: BridgeError): void {
    const worker = this.worker;
    this.worker = null;
    this.started = null;
    worker?.stop();
    const pending = [...this.pending];
    this.pending.clear();
    for (const reject of pending) reject(error);
    this.emit(IDLE);
  }

  private emit(progress: LoadProgress): void {
    this.current = progress;
    for (const listener of this.listeners) listener(progress);
  }

  private ready(): Promise<RuntimeInfo> {
    if (this.started !== null) return this.started;
    const worker = this.spawn((message) => {
      if (this.worker === worker) this.stop(BridgeError.of('worker', 'WorkerError', message));
    });
    this.worker = worker;
    this.emit({ stage: 'download', loaded: 0, total: 0 });
    const started = worker.api.start(this.options(), proxy((progress: LoadProgress) => {
      if (this.worker === worker) this.emit(progress);
    }));
    this.started = this.settle(worker, started).then((info) => {
      if (this.worker === worker) this.emit({ ...this.current, stage: 'ready' });
      return info;
    });
    // a start that failed stops its worker, and the next call tries again
    this.started.catch((error: unknown) => {
      if (this.worker === worker) this.stop(error instanceof BridgeError ? error : BridgeError.of('worker', 'WorkerError', String(error)));
    });
    return this.started;
  }

  private call<T>(signal: AbortSignal | undefined, work: (api: Remote<PythonApi> | PythonApi) => Promise<Outcome<T>>): Promise<T> {
    return this.guard(signal, async () => {
      await this.ready();
      const worker = this.worker;
      if (worker === null) throw BridgeError.of('cancelled', 'Cancelled', 'cancelled');
      return this.settle(worker, work(worker.api));
    });
  }

  /** An outcome's value, or its failure thrown; a worker that threw instead of answering is stopped (its state is unknown). */
  private async settle<T>(worker: PythonWorker, answer: Promise<Outcome<T>>): Promise<T> {
    let outcome: Outcome<T>;
    try {
      outcome = await answer;
    } catch (error) {
      const failure = BridgeError.of('worker', 'WorkerError', error instanceof Error ? error.message : String(error));
      if (this.worker === worker) this.stop(failure);
      throw failure;
    }
    if (!outcome.ok) throw new BridgeError(outcome.error);
    return outcome.value;
  }

  /** `work`, failing at once when `stop` runs or `signal` aborts (which stops the worker). */
  private guard<T>(signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> {
    if (signal?.aborted) return Promise.reject(BridgeError.of('cancelled', 'Cancelled', 'cancelled'));
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => this.cancel();
      this.pending.add(reject);
      signal?.addEventListener('abort', onAbort, { once: true });
      work()
        .then(resolve, reject)
        .finally(() => {
          this.pending.delete(reject);
          signal?.removeEventListener('abort', onAbort);
        });
    });
  }
}

/** The page's bridge: one for the page, its worker started by the first call. */
let pageBridge: PythonBridge | null = null;

/** The page's {@link PythonBridge}. */
export function pythonBridge(): PythonBridge {
  return (pageBridge ??= new PythonBridge());
}

/**
 * What the browser tests reach (e2e/pyodide/): the page's bridge as `window.__rwatPython`.
 * Only for a page that set `window.__RWAT_E2E__ = true` before the editor started
 * (../main.ts loads this module only then), so the editor a user opens exposes nothing.
 */
export function exposeForTests(): void {
  const global = globalThis as { __RWAT_E2E__?: unknown; __rwatPython?: PythonBridge };
  if (global.__RWAT_E2E__ === true) global.__rwatPython = pythonBridge();
}
