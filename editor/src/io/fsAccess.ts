/**
 * A pack folder through the File System Access API (Chromium; docs/proposals/editor.md
 * §1.2, §3.6): read it by entries, write changes back in place, delete files.
 *
 * The code speaks to the small structural types below instead of the DOM's own, which
 * lack `showDirectoryPicker`, the permission methods and async iteration of a folder in
 * the TypeScript libraries this project builds with. A real handle is passed through
 * {@link fromNativeHandle}; a stand-in with these methods works as well, which is how
 * the unit tests run it without a browser.
 *
 * Permissions: a folder the user has just picked is granted. A handle kept from an
 * earlier visit (or after the browser dropped the grant) answers `prompt`;
 * {@link ensurePermission} asks again, and the browser shows its dialog only when that
 * is called in a click. Reading and writing ask on their own and fail with
 * `permission-denied` when the answer is no or no click is in progress.
 */

import type { FileChange, FileEntry, PackSink, PackSource } from '../core/contracts';
import { applyChanges, planChanges, type FolderBackend } from './changes';
import { PackIoError, pathsSummary, wrapIoError } from './errors';
import { comparePaths, packPathProblem, parentPath } from '../core/paths';

export type FsMode = 'read' | 'readwrite';
export type FsPermission = 'granted' | 'denied' | 'prompt';

/** The part of `FileSystemWritableFileStream` the sink uses. */
export interface FsWritable {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}

/** The part of `FileSystemFileHandle` the editor uses. */
export interface FsFileHandle {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<FsWritable>;
}

/** The part of `FileSystemDirectoryHandle` the editor uses. */
export interface FsDirectoryHandle {
  readonly kind: 'directory';
  readonly name: string;
  values(): AsyncIterable<FsFileHandle | FsDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FsFileHandle>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FsDirectoryHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  /** Absent on handles that need no permission (the browser's private file system). */
  queryPermission?(descriptor: { mode: FsMode }): Promise<FsPermission>;
  requestPermission?(descriptor: { mode: FsMode }): Promise<FsPermission>;
}

/** A real `FileSystemDirectoryHandle` (from `showDirectoryPicker`, `navigator.storage.getDirectory`, IndexedDB) as the type this module speaks. */
export function fromNativeHandle(handle: FileSystemDirectoryHandle): FsDirectoryHandle {
  return handle as unknown as FsDirectoryHandle;
}

/** True where the browser can pick a folder for reading and writing (Chromium). */
export function isFsAccessSupported(): boolean {
  return typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

/**
 * The state of the permission for the folder. A `prompt` is turned into a question to the
 * user when `request` is true (the default) and the browser allows it, which it does
 * only inside a click; without a click the state stays `prompt`.
 */
export async function ensurePermission(handle: FsDirectoryHandle, mode: FsMode, request = true): Promise<FsPermission> {
  if (handle.queryPermission === undefined) return 'granted';
  const descriptor = { mode };
  let state = await handle.queryPermission(descriptor);
  if (state === 'prompt' && request && handle.requestPermission !== undefined) {
    try {
      state = await handle.requestPermission(descriptor);
    } catch {
      // No user gesture (a SecurityError): the answer stays "prompt" and the caller says so.
    }
  }
  return state;
}

function denied(handle: FsDirectoryHandle, mode: FsMode): PackIoError {
  const what = mode === 'read' ? 'read' : 'write to';
  return new PackIoError('permission-denied', `No permission to ${what} the folder ${JSON.stringify(handle.name)}`, []);
}

// ---------------------------------------------------------------- reading

async function listFolder(folder: FsDirectoryHandle, prefix: string, entries: FileEntry[], unsafe: string[]): Promise<void> {
  const files: FsFileHandle[] = [];
  const folders: FsDirectoryHandle[] = [];
  for await (const handle of folder.values()) {
    if (packPathProblem(prefix + handle.name) !== null) unsafe.push(prefix + handle.name);
    else if (handle.kind === 'file') files.push(handle);
    else folders.push(handle);
  }
  const sizes = await Promise.all(files.map(async (file) => (await file.getFile()).size));
  files.forEach((file, i) => entries.push({ path: prefix + file.name, size: sizes[i] ?? 0 }));
  for (const sub of folders) await listFolder(sub, `${prefix}${sub.name}/`, entries, unsafe);
}

/** A folder opened through File System Access; reads, and writes back through {@link FsAccessSink} when {@link FsAccessSource.writable}. */
export class FsAccessSource implements PackSource {
  readonly kind = 'fs-access';
  private canWrite: boolean;

  constructor(
    readonly handle: FsDirectoryHandle,
    writable: boolean,
  ) {
    this.canWrite = writable;
  }

  get name(): string {
    return this.handle.name;
  }

  /** True while the folder was granted for writing; {@link requestWrite} asks again. */
  get writable(): boolean {
    return this.canWrite;
  }

  async list(): Promise<FileEntry[]> {
    if ((await ensurePermission(this.handle, 'read')) !== 'granted') throw denied(this.handle, 'read');
    const entries: FileEntry[] = [];
    const unsafe: string[] = [];
    try {
      await listFolder(this.handle, '', entries, unsafe);
    } catch (error) {
      throw wrapIoError(error);
    }
    if (unsafe.length > 0) {
      throw new PackIoError('unsafe-path', `${this.name} has files that are not paths inside a pack: ${pathsSummary(unsafe)}`, unsafe);
    }
    return entries.sort((a, b) => comparePaths(a.path, b.path));
  }

  async read(path: string): Promise<Uint8Array> {
    if (packPathProblem(path) !== null) throw new PackIoError('unsafe-path', `Not a path inside the pack: ${JSON.stringify(path)}`, [path]);
    if ((await ensurePermission(this.handle, 'read')) !== 'granted') throw denied(this.handle, 'read');
    try {
      const parts = path.split('/');
      const fileName = parts.pop() ?? '';
      let folder = this.handle;
      for (const part of parts) folder = await folder.getDirectoryHandle(part);
      const file = await (await folder.getFileHandle(fileName)).getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch (error) {
      throw wrapIoError(error, path);
    }
  }

  /** Asks the user again to let the editor write to the folder (call it in a click). True when granted. */
  async requestWrite(): Promise<boolean> {
    this.canWrite = (await ensurePermission(this.handle, 'readwrite')) === 'granted';
    return this.canWrite;
  }

  /** The sink that writes changes into this folder; `observe` hears of every file written or deleted, as it is. */
  sink(observe?: WriteObserver): FsAccessSink {
    return new FsAccessSink(this.handle, observe);
  }
}

/**
 * Opens a folder handle as a pack source. Asks for `mode` (the default is writing);
 * when writing is refused but reading is granted, the source is read-only
 * (`writable` false). Rejects with `permission-denied` when even reading is refused.
 */
export async function openFsAccessSource(handle: FsDirectoryHandle, mode: FsMode = 'readwrite'): Promise<FsAccessSource> {
  if (mode === 'readwrite' && (await ensurePermission(handle, 'readwrite')) === 'granted') return new FsAccessSource(handle, true);
  if ((await ensurePermission(handle, 'read')) !== 'granted') throw denied(handle, mode);
  return new FsAccessSource(handle, false);
}

/**
 * Shows the browser's folder picker (call it in a click) and opens the chosen folder.
 * Resolves to null when the user cancels; rejects with `unsupported` where the browser
 * has no File System Access.
 */
export async function pickFsAccessPack(mode: FsMode = 'readwrite'): Promise<FsAccessSource | null> {
  const host = globalThis as { showDirectoryPicker?: (options: { id: string; mode: FsMode }) => Promise<FsDirectoryHandle> };
  if (host.showDirectoryPicker === undefined) {
    throw new PackIoError('unsupported', 'This browser cannot open a folder for writing (no File System Access API)');
  }
  let handle: FsDirectoryHandle;
  try {
    handle = await host.showDirectoryPicker({ id: 'rwat-pack', mode });
  } catch (error) {
    if ((error as { name?: unknown } | null)?.name === 'AbortError') return null;
    throw wrapIoError(error);
  }
  return openFsAccessSource(handle, mode);
}

// ---------------------------------------------------------------- writing

/** The folder as {@link FolderBackend}: paths from the pack's root, folders made on demand. */
class FolderHandleBackend implements FolderBackend {
  constructor(private readonly root: FsDirectoryHandle) {}

  /** The folder at the path, made if `create`; null when it is not there (or a file is in its place) and `create` is off. */
  private async folder(path: string, create: boolean): Promise<FsDirectoryHandle | null> {
    let folder = this.root;
    for (const part of path === '' ? [] : path.split('/')) {
      try {
        folder = await folder.getDirectoryHandle(part, { create });
      } catch (error) {
        if (!create && isMissing(error)) return null;
        throw error;
      }
    }
    return folder;
  }

  async writeFile(path: string, bytes: Uint8Array): Promise<void> {
    try {
      const folder = (await this.folder(parentPath(path), true)) as FsDirectoryHandle;
      const file = await folder.getFileHandle(path.slice(path.lastIndexOf('/') + 1), { create: true });
      // The browser writes into a temporary file and swaps it in on close: a failure leaves the old file.
      const stream = await file.createWritable();
      try {
        await stream.write(bytes);
        await stream.close();
      } catch (error) {
        await stream.abort?.().catch(() => undefined);
        throw error;
      }
    } catch (error) {
      throw wrapIoError(error, path, true);
    }
  }

  async removeFile(path: string): Promise<boolean> {
    try {
      const folder = await this.folder(parentPath(path), false);
      if (folder === null) return false;
      await folder.removeEntry(path.slice(path.lastIndexOf('/') + 1));
      return true;
    } catch (error) {
      if (isMissing(error)) return false;
      throw wrapIoError(error, path, true);
    }
  }

  async removeFolderIfEmpty(path: string): Promise<boolean> {
    try {
      const folder = await this.folder(path, false);
      const parent = await this.folder(parentPath(path), false);
      if (folder === null || parent === null || !(await isEmpty(folder))) return false;
      await parent.removeEntry(path.slice(path.lastIndexOf('/') + 1));
      return true;
    } catch (error) {
      throw wrapIoError(error, path, true);
    }
  }
}

async function isEmpty(folder: FsDirectoryHandle): Promise<boolean> {
  const entries = folder.values()[Symbol.asyncIterator]();
  const first = await entries.next();
  if (first.done !== true) await entries.return?.();
  return first.done === true;
}

function isMissing(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === 'NotFoundError' || name === 'TypeMismatchError';
}

/** Hears of each file a sink has written or deleted, right after it is done: what a write that fails halfway did (app/save). */
export type WriteObserver = (step: { path: string; action: 'write' | 'delete' }) => void;

/**
 * Writes changes into a folder in place, file by file (docs/proposals/editor.md §3.6):
 * deletions first, then the files with `pack.mcmeta` last, then the folders the
 * deletions left empty are removed. Asks for write permission when it is not granted
 * and rejects with `permission-denied` when it stays so. A path that is not a path inside the
 * pack, or twice in a batch, rejects the whole batch before anything is written. A write
 * that fails rejects at that file: the files before it are written (`observe` names
 * them), the rest are not; writing the same changes again is safe.
 */
export class FsAccessSink implements PackSink {
  constructor(
    private readonly root: FsDirectoryHandle,
    private readonly observe?: WriteObserver,
  ) {}

  async write(changes: FileChange[]): Promise<void> {
    if (changes.length === 0) return;
    planChanges(changes); // a bad batch is refused before the browser asks for anything
    if ((await ensurePermission(this.root, 'readwrite')) !== 'granted') throw denied(this.root, 'readwrite');
    const folder = new FolderHandleBackend(this.root);
    const observe = this.observe;
    const backend: FolderBackend =
      observe === undefined
        ? folder
        : {
            writeFile: async (path, bytes) => {
              await folder.writeFile(path, bytes);
              observe({ path, action: 'write' });
            },
            removeFile: async (path) => {
              const removed = await folder.removeFile(path);
              observe({ path, action: 'delete' });
              return removed;
            },
            removeFolderIfEmpty: (path) => folder.removeFolderIfEmpty(path),
          };
    await applyChanges(backend, changes);
  }
}
