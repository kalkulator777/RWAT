/**
 * A pack held in memory: a {@link PackSource} and a {@link PackSink} at once. For
 * tests of the modules that read or save packs, and for packs the editor builds itself.
 */

import type { FileChange, FileEntry, PackSink, PackSource } from '../core/contracts';
import { applyChanges, type FolderBackend } from './changes';
import { PackIoError } from './errors';
import { comparePaths, isPackPath, packPathProblem } from './paths';

/** File contents for the constructor: bytes, or text that is written as UTF-8. */
export type MemoryFiles = Iterable<readonly [string, Uint8Array | string]> | Readonly<Record<string, Uint8Array | string>>;

const encoder = new TextEncoder();

function toBytes(content: Uint8Array | string): Uint8Array {
  return typeof content === 'string' ? encoder.encode(content) : content.slice();
}

export class MemoryPack implements PackSource, PackSink {
  readonly kind = 'memory';
  readonly writable = true;
  private readonly files = new Map<string, Uint8Array>();

  constructor(
    readonly name: string,
    files: MemoryFiles = [],
  ) {
    const pairs = Symbol.iterator in files ? (files as Iterable<readonly [string, Uint8Array | string]>) : Object.entries(files);
    const unsafe: string[] = [];
    for (const [path, content] of pairs) {
      if (packPathProblem(path) !== null) unsafe.push(path);
      else this.files.set(path, toBytes(content));
    }
    if (unsafe.length > 0) throw new PackIoError('unsafe-path', `Not paths inside the pack: ${unsafe.join(', ')}`, unsafe);
  }

  list(): Promise<FileEntry[]> {
    const entries = [...this.files].map(([path, bytes]) => ({ path, size: bytes.length }));
    return Promise.resolve(entries.sort((a, b) => comparePaths(a.path, b.path)));
  }

  read(path: string): Promise<Uint8Array> {
    const bytes = isPackPath(path) ? this.files.get(path) : undefined;
    if (bytes === undefined) return Promise.reject(new PackIoError('not-found', `No file ${JSON.stringify(path)}`, [path]));
    return Promise.resolve(bytes.slice());
  }

  write(changes: FileChange[]): Promise<void> {
    const backend: FolderBackend = {
      writeFile: (path, bytes) => {
        this.files.set(path, bytes.slice());
        return Promise.resolve();
      },
      removeFile: (path) => Promise.resolve(this.files.delete(path)),
      removeFolderIfEmpty: () => Promise.resolve(false), // memory has no folders to empty
    };
    return applyChanges(backend, changes);
  }
}
