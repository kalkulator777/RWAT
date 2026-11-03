/** Helpers of the io tests: where the example pack is, and a fake File System Access folder. */

import { fileURLToPath } from 'node:url';
import type { FsDirectoryHandle, FsFileHandle, FsWritable } from './fsAccess';

/** The example pack of the repository, a folder on the disk. */
export const EXAMPLE_PACK = fileURLToPath(new URL('../../../run/rwat_packs/RwatExamplePack', import.meta.url));
/** The converter's folder, for the test that compares with what it writes. */
export const TOOLS_DIR = fileURLToPath(new URL('../../../tools', import.meta.url));

class NotFound extends Error {
  override name = 'NotFoundError';
}

class FakeFile implements FsFileHandle {
  readonly kind = 'file';
  bytes = new Uint8Array();
  constructor(readonly name: string) {}
  getFile(): Promise<File> {
    return Promise.resolve(new File([this.bytes.slice()], this.name));
  }
  createWritable(): Promise<FsWritable> {
    let pending = new Uint8Array();
    return Promise.resolve({
      write: (data) => {
        pending = data.slice();
        return Promise.resolve();
      },
      close: () => {
        this.bytes = pending;
        return Promise.resolve();
      },
    });
  }
}

/** An in-memory folder with the methods of a File System Access directory handle. */
export class FakeDirectory implements FsDirectoryHandle {
  readonly kind = 'directory';
  readonly children = new Map<string, FakeFile | FakeDirectory>();
  /** What `queryPermission` answers; `requestPermission` sets it to `onRequest`. */
  state: 'granted' | 'denied' | 'prompt' = 'granted';
  onRequest: 'granted' | 'denied' = 'granted';
  constructor(readonly name: string) {}

  async *values(): AsyncIterable<FsFileHandle | FsDirectoryHandle> {
    await Promise.resolve();
    for (const child of this.children.values()) yield child;
  }
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FsFileHandle> {
    let child = this.children.get(name);
    if (child === undefined && options?.create === true) {
      child = new FakeFile(name);
      this.children.set(name, child);
    }
    if (!(child instanceof FakeFile)) return Promise.reject(new NotFound(name));
    return Promise.resolve(child);
  }
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FsDirectoryHandle> {
    let child = this.children.get(name);
    if (child === undefined && options?.create === true) {
      child = new FakeDirectory(name);
      this.children.set(name, child);
    }
    if (!(child instanceof FakeDirectory)) return Promise.reject(new NotFound(name));
    return Promise.resolve(child);
  }
  removeEntry(name: string): Promise<void> {
    if (!this.children.delete(name)) return Promise.reject(new NotFound(name));
    return Promise.resolve();
  }
  queryPermission(): Promise<'granted' | 'denied' | 'prompt'> {
    return Promise.resolve(this.state);
  }
  requestPermission(): Promise<'granted' | 'denied' | 'prompt'> {
    this.state = this.onRequest;
    return Promise.resolve(this.state);
  }
}
