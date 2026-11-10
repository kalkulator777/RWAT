/**
 * The Python side of the bridge (./bridge.ts, docs/proposals/editor.md §3.12): Pyodide
 * with the pack tools, and the calls of ../../py/rwat_bridge.py. Runs where Pyodide runs —
 * in ../workers/pyodide.worker.ts, and in Node for the tests (the same code on the same
 * Python files).
 *
 * - **The tools as they are.** `tools/ir2rwat.py`, `tools/floorgen.py` and the glue come
 *   into the bundle as text (`?raw`) and are written to `/rwat/tools/` of Pyodide's file
 *   system: no copy of them in editor/.
 * - **Files.** A conversion writes the recipe and its per-type files to `/work/packs/`
 *   and puts each source zip where the recipe looks for it (`sources[].zip`, relative to
 *   the recipe; `../MVP-IR-….zip` is `/work/MVP-IR-….zip`): a symbolic link to the zip in
 *   `/work/src/<n>/`, which is a WORKERFS mount of the `Blob` where the worker can read
 *   one (a `File` is read in place, never copied whole into memory), else the bytes in
 *   memory (Node). The pack is written to `/work/out/`. `/work/` is emptied after every
 *   conversion, the mounts taken down. `derive` lays out its recipe the same way in
 *   `/session/`, which stays — the converter keeps reading the zips for `floorFor` —
 *   until the next `derive` or `closeDerived`. The other calls write their input to
 *   `/rwat/in/`.
 * - **Answers.** Every call answers an {@link Outcome}: a Python exception or a request
 *   the bridge can't follow is a {@link Failure}, never a thrown error. Bytes go back
 *   marked for transfer (`comlink.transfer`).
 */

import { transfer } from 'comlink';
import type { PyodideAPI } from 'pyodide';
import { comparePaths } from '../core/paths';
import bridgeSource from '../../py/rwat_bridge.py?raw';
import floorgenSource from '../../../tools/floorgen.py?raw';
import ir2rwatSource from '../../../tools/ir2rwat.py?raw';
import type {
  ConvertRequest,
  ConvertResult,
  ConverterReport,
  DeriveResult,
  Failure,
  GeneratedFloor,
  LoadProgress,
  Outcome,
  PackFile,
  PythonApi,
  RuntimeInfo,
  StartOptions,
} from './bridge';

/** Loads Pyodide (in the worker: from the site; in Node: the package's own). */
export type PyodideLoader = (options: StartOptions, onProgress: (progress: LoadProgress) => void) => Promise<PyodideAPI>;

const TOOLS = '/rwat/tools';
const INPUT = '/rwat/in';

/** Where a recipe is laid out: its folder, the recipe's own folder in it, the zips' mounts, the pack written. */
interface Place {
  root: string;
  packs: string;
  sources: string;
  out: string;
}

const place = (root: string): Place => ({ root, packs: `${root}/packs`, sources: `${root}/src`, out: `${root}/out` });
/** A conversion's place, emptied after it. */
const WORK = place('/work');
/** The place of the recipe `derive` opened, kept for `floorFor`. */
const SESSION = place('/session');

/** Python files written to {@link TOOLS}, by name. */
const PYTHON_FILES: Record<string, string> = {
  'ir2rwat.py': ir2rwatSource,
  'floorgen.py': floorgenSource,
  'rwat_bridge.py': bridgeSource,
};

/** A kind of file system to mount (`FS.filesystems.WORKERFS`). */
type MountType = object;

/**
 * Emscripten's file system (Pyodide's `FS`), as much of it as the bridge uses: typed here,
 * as the package types it through the global `FS` of @types/emscripten.
 */
interface FileSystem {
  filesystems: Record<string, MountType>;
  analyzePath(path: string, dontResolveLastLink?: boolean): { exists: boolean };
  lstat(path: string): { mode: number };
  isDir(mode: number): boolean;
  readdir(path: string): string[];
  readFile(path: string): Uint8Array;
  writeFile(path: string, data: string | Uint8Array, options?: { canOwn?: boolean }): void;
  mkdirTree(path: string): void;
  unlink(path: string): void;
  rmdir(path: string): void;
  symlink(target: string, path: string): void;
  mount(type: MountType, options: object, mountpoint: string): void;
  unmount(mountpoint: string): void;
}

/** Pyodide's file system. */
const fileSystem = (pyodide: PyodideAPI): FileSystem => (pyodide as unknown as { FS: FileSystem }).FS;

/** Pyodide with the tools loaded. */
interface Session {
  pyodide: PyodideAPI;
  call: PythonCall;
  info: RuntimeInfo;
}

/** What rwat_bridge.convert gives back. */
interface PythonReport extends Omit<ConverterReport, 'refusal'> {
  exit: number;
  refusal: string | null;
  pack: string[];
}

/** rwat_bridge.call: name, arguments as JSON, a log listener → the answer as JSON. */
type PythonCall = ((name: string, args: string, log?: (line: string) => void) => string) & { destroy(): void };

/** A request the bridge can't follow. */
class BadRequest extends Error {}

function bridgeFailure(error: unknown): Failure {
  const message = error instanceof Error ? error.message : String(error);
  const type = error instanceof BadRequest ? 'BadRequest' : error instanceof Error ? error.name : 'Error';
  return { kind: 'bridge', type, message, text: message, traceback: '' };
}

/** A POSIX path made absolute against `base`, `.` and `..` resolved (never above /). */
export function resolvePath(base: string, path: string): string {
  const parts: string[] = [];
  for (const part of `${path.startsWith('/') ? '' : base}/${path}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `/${parts.join('/')}`;
}

/** True if `path` is `folder` or in it. */
function within(folder: string, path: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

/** True if a file of the recipe may be put at `path`: in the place, not where the bridge keeps its own. */
function placeable(at: Place, path: string): boolean {
  return path !== at.root && within(at.root, path) && !within(at.sources, path) && !within(at.out, path);
}

function exists(fs: FileSystem, path: string): boolean {
  return fs.analyzePath(path, true).exists;
}

/** Removes a file or a folder with everything in it; a mount point is unmounted first. */
function remove(fs: FileSystem, path: string, mounts: Set<string>): void {
  if (!exists(fs, path)) return;
  const { mode } = fs.lstat(path);
  if (!fs.isDir(mode)) {
    fs.unlink(path);
    return;
  }
  if (mounts.delete(path)) fs.unmount(path);
  else for (const name of fs.readdir(path)) if (name !== '.' && name !== '..') remove(fs, `${path}/${name}`, mounts);
  fs.rmdir(path);
}

/** Every file under `folder`, by path relative to it, in the order of paths (core/paths). */
function readTree(fs: FileSystem, folder: string): PackFile[] {
  const files: PackFile[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const name of fs.readdir(dir)) {
      if (name === '.' || name === '..') continue;
      const path = `${dir}/${name}`;
      if (fs.isDir(fs.lstat(path).mode)) walk(path, `${prefix}${name}/`);
      else files.push({ path: `${prefix}${name}`, bytes: fs.readFile(path) });
    }
  };
  walk(folder, '');
  return files.sort((a, b) => comparePaths(a.path, b.path));
}

/** A recipe file's bytes: bytes as they are, any other value as JSON. */
function fileBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

/** The recipe's `overrides_dir`, if it names one (the recipe as a value, or its bytes as JSON). */
function overridesDir(recipe: unknown): string | null {
  let value = recipe;
  if (recipe instanceof Uint8Array) {
    try {
      value = JSON.parse(new TextDecoder().decode(recipe)) as unknown;
    } catch {
      return null;
    }
  }
  const dir = typeof value === 'object' && value !== null ? (value as Record<string, unknown>).overrides_dir : undefined;
  return typeof dir === 'string' ? dir : null;
}

/** A type id as a file name: one path part. */
const SAFE_ID = /^(?!\.\.?$)[^/\\\0]+$/;

/** What is laid out of a recipe: its recipe file, per-type files and source zips. */
type RecipeFiles = Pick<ConvertRequest, 'recipe' | 'recipeName' | 'overrides' | 'sources'>;

/**
 * Lays a recipe out in `at` (emptied first): the recipe, its per-type files in its
 * `overrides_dir` (the folder made even with none given, so the converter finds one), and
 * each source zip where the recipe looks for it. Returns the recipe's path; a
 * {@link BadRequest} for a name that leads out of the place.
 */
async function lay(fs: FileSystem, at: Place, request: RecipeFiles, mounts: Set<string>): Promise<string> {
  remove(fs, at.root, mounts);
  fs.mkdirTree(at.packs);
  fs.mkdirTree(at.out);
  const recipeName = request.recipeName ?? 'recipe.json';
  if (!SAFE_ID.test(recipeName)) throw new BadRequest(`recipe name ${JSON.stringify(recipeName)} is not a file name`);
  const recipePath = `${at.packs}/${recipeName}`;
  fs.writeFile(recipePath, fileBytes(request.recipe));
  const overrides = Object.entries(request.overrides ?? {});
  const dir = overridesDir(request.recipe);
  if (dir === null && overrides.length > 0) throw new BadRequest('per-type files given, but the recipe has no "overrides_dir"');
  if (dir !== null) {
    const folder = resolvePath(at.packs, dir);
    if (!placeable(at, folder)) throw new BadRequest(`"overrides_dir" ${JSON.stringify(dir)} leads out of the recipe's place`);
    fs.mkdirTree(folder);
    for (const [id, value] of overrides) {
      if (!SAFE_ID.test(id)) throw new BadRequest(`type id ${JSON.stringify(id)} is not a file name`);
      fs.writeFile(`${folder}/${id}.json`, fileBytes(value));
    }
  }
  // WORKERFS reads a Blob with FileReaderSync, which only a browser's worker has
  const workerFs = 'FileReaderSync' in globalThis ? fs.filesystems.WORKERFS : undefined;
  let index = 0;
  for (const [name, data] of Object.entries(request.sources)) {
    const where = resolvePath(at.packs, name);
    if (!placeable(at, where) || where === recipePath) throw new BadRequest(`source ${JSON.stringify(name)} leads out of the recipe's place`);
    const folder = `${at.sources}/${index++}`;
    const file = where.slice(where.lastIndexOf('/') + 1);
    fs.mkdirTree(folder);
    if (data instanceof Blob && workerFs !== undefined) {
      fs.mount(workerFs, { blobs: [{ name: file, data }] }, folder);
      mounts.add(folder);
    } else {
      const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
      fs.writeFile(`${folder}/${file}`, bytes, { canOwn: true });
    }
    fs.mkdirTree(where.slice(0, where.lastIndexOf('/')) || '/');
    fs.symlink(`${folder}/${file}`, where);
  }
  return recipePath;
}

/** Empties a place; what can't be taken down now is taken down by the next {@link lay} there. */
function clear(fs: FileSystem, at: Place, mounts: Set<string>): void {
  try {
    remove(fs, at.root, mounts);
  } catch {
    // a place left half-made: the next lay empties it first
  }
}

/** The Python side over a Pyodide `load`er: what the worker exposes. */
export function createPythonApi(load: PyodideLoader): PythonApi {
  let running: Promise<Session> | null = null;
  let lastOptions: StartOptions = {};
  /** The WORKERFS mounts of the recipe `derive` opened. */
  const sessionMounts = new Set<string>();

  function boot(options: StartOptions, onProgress: (progress: LoadProgress) => void): Promise<Session> {
    running ??= (async () => {
      const began = performance.now();
      let last: LoadProgress = { stage: 'download', loaded: 0, total: 0 };
      const pyodide = await load(options, (progress) => onProgress((last = progress)));
      // the files are in: the interpreter and the tools start
      onProgress({ ...last, stage: 'start' });
      const fs = fileSystem(pyodide);
      fs.mkdirTree(TOOLS);
      for (const [name, text] of Object.entries(PYTHON_FILES)) fs.writeFile(`${TOOLS}/${name}`, text);
      const call = pyodide.runPython(
        `import sys\nsys.dont_write_bytecode = True\nsys.path.insert(0, ${JSON.stringify(TOOLS)})\nimport rwat_bridge\nrwat_bridge.call`,
      ) as PythonCall;
      const python = pyodide.runPython('import sys; sys.version.split()[0]') as string;
      return { pyodide, call, info: { pyodide: pyodide.version, python, loadMs: performance.now() - began } };
    })();
    const session = running;
    // a load that failed is tried again by the next call
    session.catch(() => {
      if (running === session) running = null;
    });
    return session;
  }

  /** The Python call `name` with `args`, its answer parsed. */
  async function python<T>(name: string, args: Record<string, unknown>, log?: (line: string) => void): Promise<Outcome<T>> {
    const { call } = await boot(lastOptions, () => {});
    return JSON.parse(call(name, JSON.stringify(args), log)) as Outcome<T>;
  }

  /** Forgets the recipe `derive` opened: its zips closed in Python, its place emptied. */
  async function closeSession(fs: FileSystem): Promise<void> {
    await python('close', {});
    clear(fs, SESSION, sessionMounts);
  }

  /** `work` with its inputs written to {@link INPUT}, which is emptied after. */
  async function withInput<T>(inputs: Record<string, Uint8Array>, work: () => Promise<Outcome<T>>): Promise<Outcome<T>> {
    let fs: FileSystem | null = null;
    try {
      fs = fileSystem((await boot(lastOptions, () => {})).pyodide);
      fs.mkdirTree(INPUT);
      for (const [name, bytes] of Object.entries(inputs)) fs.writeFile(`${INPUT}/${name}`, bytes);
      return await work();
    } catch (error) {
      return { ok: false, error: bridgeFailure(error) };
    } finally {
      if (fs !== null) remove(fs, INPUT, new Set());
    }
  }

  return {
    async start(options, onProgress) {
      lastOptions = options;
      try {
        const { info } = await boot(options, onProgress ?? (() => {}));
        return { ok: true, value: info };
      } catch (error) {
        return { ok: false, error: { ...bridgeFailure(error), kind: 'worker' } };
      }
    },

    async convert(request: ConvertRequest, onLog) {
      let fs: FileSystem | null = null;
      const mounts = new Set<string>();
      try {
        const { pyodide } = await boot(lastOptions, () => {});
        fs = fileSystem(pyodide);
        const recipePath = await lay(fs, WORK, request, mounts);
        const asZip = request.output === 'zip';
        const answer = await python<PythonReport>('convert', { recipe: recipePath, out: WORK.out, as_zip: asZip }, onLog);
        if (!answer.ok) return answer;
        const { exit, pack, ...report } = answer.value;
        const result: ConvertResult = { exitCode: exit, report, pack: null };
        const name = pack[0];
        if (exit !== 2 && name !== undefined) {
          const path = `${WORK.out}/${name}`;
          result.pack = asZip ? { kind: 'zip', name, bytes: fs.readFile(path) } : { kind: 'files', name, files: readTree(fs, path) };
        }
        const buffers = result.pack === null ? [] : result.pack.kind === 'zip' ? [result.pack.bytes.buffer] : result.pack.files.map((f) => f.bytes.buffer);
        return transfer({ ok: true, value: result }, buffers as ArrayBuffer[]);
      } catch (error) {
        return { ok: false, error: bridgeFailure(error) };
      } finally {
        if (fs !== null) clear(fs, WORK, mounts);
      }
    },

    async derive(request, onLog) {
      let fs: FileSystem | null = null;
      try {
        fs = fileSystem((await boot(lastOptions, () => {})).pyodide);
        const closed = await python<null>('close', {});
        if (!closed.ok) return closed;
        const recipe = await lay(fs, SESSION, { ...request, overrides: {} }, sessionMounts);
        const answer = await python<DeriveResult>('derive', { recipe }, onLog);
        if (!answer.ok) await closeSession(fs);
        return answer;
      } catch (error) {
        if (fs !== null) await closeSession(fs);
        return { ok: false, error: bridgeFailure(error) };
      }
    },

    async floorFor(typeId, override) {
      try {
        return await python<GeneratedFloor>('floor_for', { type_id: typeId, override });
      } catch (error) {
        return { ok: false, error: bridgeFailure(error) };
      }
    },

    async closeDerived() {
      try {
        await closeSession(fileSystem((await boot(lastOptions, () => {})).pyodide));
        return { ok: true, value: null };
      } catch (error) {
        return { ok: false, error: bridgeFailure(error) };
      }
    },

    modelDoors(obj, animated) {
      return withInput({ 'model.obj': obj }, () => python('model_doors', { obj: `${INPUT}/model.obj`, animated }));
    },

    suggestFloor(obj, options, doors) {
      return withInput({ 'model.obj': obj }, async () => {
        const answer = await python<{ interior: never; levels: number[]; notes: string[]; region_area: number; dropped_area: number }>('suggest_floor', {
          obj: `${INPUT}/model.obj`,
          options,
          doors,
        });
        if (!answer.ok) return answer;
        const { interior, levels, notes, region_area: regionArea, dropped_area: droppedArea } = answer.value;
        return { ok: true, value: { interior, levels, notes, regionArea, droppedArea } };
      });
    },

    rewriteReferences(raw, keyword, moved) {
      return withInput({ raw }, async () => {
        const out = `${INPUT}/out`;
        const answer = await python<boolean>('rewrite_references', { raw: `${INPUT}/raw`, keyword, moved, out });
        if (!answer.ok) return answer;
        if (!answer.value) return { ok: true, value: null };
        const bytes = fileSystem((await boot(lastOptions, () => {})).pyodide).readFile(out);
        return transfer({ ok: true, value: bytes }, [bytes.buffer as ArrayBuffer]);
      });
    },

    async memory() {
      if (running === null) return 0;
      const { pyodide } = await running;
      return (pyodide as unknown as { _module: { HEAP8: Int8Array } })._module.HEAP8.byteLength;
    },
  };
}
