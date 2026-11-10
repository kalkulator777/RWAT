/**
 * The pack sources a restored session opens (editor.md M5):
 *
 * - {@link OverlaySource} — a folder the session saved into, seen as it was when the
 *   session opened it: the files a save wrote or deleted come from what the session kept
 *   of them, the rest from the folder. The journal replays from the pack as opened, so it
 *   needs this view; reading, listing and writing still go to the folder itself
 *   ({@link homeOf}), and it has the folder's kind, name and permission.
 * - {@link FilesSource} — files the session kept whole: a pack the editor made.
 */

import type { FileEntry, PackSource, PackSourceKind } from '../contracts';
import { comparePaths } from '../paths';

export class OverlaySource implements PackSource {
  constructor(
    /** The folder (or any source) the pack lives in. */
    readonly home: PackSource,
    /** Source path → the bytes it had when the session opened it; null: it was not there. */
    private readonly before: ReadonlyMap<string, Uint8Array | null>,
  ) {}

  get kind(): PackSourceKind {
    return this.home.kind;
  }

  get writable(): boolean {
    return this.home.writable;
  }

  get name(): string {
    return this.home.name;
  }

  async list(): Promise<FileEntry[]> {
    const entries = (await this.home.list()).filter((entry) => !this.before.has(entry.path));
    for (const [path, bytes] of this.before) if (bytes !== null) entries.push({ path, size: bytes.length });
    return entries.sort((a, b) => comparePaths(a.path, b.path));
  }

  read(path: string): Promise<Uint8Array> {
    if (!this.before.has(path)) return this.home.read(path);
    const bytes = this.before.get(path) ?? null;
    return bytes === null ? Promise.reject(new Error(`no file ${path} when the session began`)) : Promise.resolve(bytes.slice());
  }
}

/** The source a pack really lives in: the folder under an {@link OverlaySource}, else the source itself. */
export function homeOf(source: PackSource): PackSource {
  return source instanceof OverlaySource ? source.home : source;
}

/** Files held in memory as a read-only source (saving such a pack downloads a zip). */
export class FilesSource implements PackSource {
  readonly writable = false;
  private readonly files: ReadonlyMap<string, Uint8Array>;

  constructor(
    readonly name: string,
    files: Iterable<readonly [string, Uint8Array]>,
    readonly kind: PackSourceKind = 'memory',
  ) {
    this.files = new Map(files);
  }

  list(): Promise<FileEntry[]> {
    const entries = [...this.files].map(([path, bytes]) => ({ path, size: bytes.length }));
    return Promise.resolve(entries.sort((a, b) => comparePaths(a.path, b.path)));
  }

  read(path: string): Promise<Uint8Array> {
    const bytes = this.files.get(path);
    return bytes === undefined ? Promise.reject(new Error(`no file ${path}`)) : Promise.resolve(bytes.slice());
  }
}
