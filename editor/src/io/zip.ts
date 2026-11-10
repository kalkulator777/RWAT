/**
 * A pack as a zip (docs/proposals/editor.md §3.6, §3.11).
 *
 * - **Reading** goes by entries: `openZipSource` reads the central directory once, and
 *   `read(path)` inflates that one entry, so a pack of a hundred megabytes is not
 *   unpacked to open it. Every name is checked first (`paths.ts`): an archive with a
 *   `..` or an absolute path is refused whole, not read around.
 * - **Writing** (`buildZip`) is deterministic and is laid out as `tools/ir2rwat.py`
 *   `write_zip` lays it out: entries sorted by path, every one deflated with the same
 *   time (1980-01-01 00:00:00), the same Unix permissions (0644) and creating system
 *   (Unix), no extra fields, no folder entries. The same files give the same bytes on
 *   every run and in every time zone.
 */

import type { FileEntry as ZipJsFile } from '@zip.js/zip.js';
import type { FileChange, FileEntry, PackSink, PackSource } from '../core/contracts';
import { planChanges } from './changes';
import { causeText, PackIoError, pathsSummary, wrapIoError } from './errors';
import { comparePaths, normalizeEntryName, packPathProblem } from '../core/paths';
import { loadZipJs, NO_WORKERS } from './zipjs';

/** What `openZipSource` reads: a file the user picked, or bytes already in memory. */
export type ZipInput = Blob | Uint8Array | ArrayBuffer;

/** Folders macOS puts into a zip next to the real files (resource forks); the converter skips them too. */
const JUNK_FOLDER = '__macosx/';

class ZipPackSource implements PackSource {
  readonly kind = 'zip';
  readonly writable = false;

  constructor(
    readonly name: string,
    private readonly entries: ReadonlyMap<string, ZipJsFile>,
    /** What the zip was opened from: the session keeps it to open the zip again (core/session). */
    readonly input: ZipInput,
  ) {}

  list(): Promise<FileEntry[]> {
    const list = [...this.entries].map(([path, entry]) => ({ path, size: entry.uncompressedSize }));
    return Promise.resolve(list.sort((a, b) => comparePaths(a.path, b.path)));
  }

  async read(path: string): Promise<Uint8Array> {
    const entry = this.entries.get(path);
    if (entry === undefined) throw new PackIoError('not-found', `No file ${JSON.stringify(path)} in ${this.name}`, [path]);
    const zip = await loadZipJs();
    try {
      return await entry.getData(new zip.Uint8ArrayWriter(), NO_WORKERS);
    } catch (error) {
      throw new PackIoError('bad-zip', `Cannot read ${JSON.stringify(path)} from ${this.name}: ${causeText(error)}`, [path], { cause: error });
    }
  }
}

/**
 * Opens a zip as a pack source. Rejects with a {@link PackIoError}: `bad-zip` when it
 * is not a readable zip, `unsafe-path` when any entry is absolute, has a drive letter or
 * a `..` part (the whole archive is refused), `duplicate-path` when two entries mean
 * one path, `unsupported` when an entry is encrypted.
 *
 * Backslashes in names are slashes and `./` is dropped, as the converter reads IR zips;
 * folder entries and `__MACOSX/` are not files and are left out. The case of a name is
 * kept. A wrapper folder (`MyPack/pack.mcmeta`) is not removed: what the files mean is
 * for the pack model.
 */
export async function openZipSource(input: ZipInput, name: string): Promise<PackSource> {
  const zip = await loadZipJs();
  const reader =
    input instanceof Blob
      ? new zip.BlobReader(input)
      : new zip.Uint8ArrayReader(input instanceof Uint8Array ? input : new Uint8Array(input));
  let all;
  try {
    // Names are checked below with the converter's rule; the library's own check would
    // stop at the first and not name the rest.
    all = await new zip.ZipReader(reader, { ...NO_WORKERS, filenameValidation: 'tolerant' }).getEntries();
  } catch (error) {
    throw new PackIoError('bad-zip', `${name} is not a readable zip: ${causeText(error)}`, [], { cause: error });
  }

  const entries = new Map<string, ZipJsFile>();
  const unsafe: string[] = [];
  const duplicate: string[] = [];
  const encrypted: string[] = [];
  for (const entry of all) {
    const normal = normalizeEntryName(entry.filename);
    if ('problem' in normal) {
      // "./" and the like are folders that name nothing; anything else that is no path is unsafe.
      if (!(normal.problem === 'empty' && entry.directory)) unsafe.push(entry.filename);
      continue;
    }
    if (entry.directory || normal.path.toLowerCase().startsWith(JUNK_FOLDER)) continue;
    if (entries.has(normal.path)) duplicate.push(normal.path);
    else entries.set(normal.path, entry);
    if (entry.encrypted) encrypted.push(normal.path);
  }
  if (unsafe.length > 0) {
    throw new PackIoError('unsafe-path', `${name} has entries that are not paths inside a pack: ${pathsSummary(unsafe)}`, unsafe);
  }
  if (duplicate.length > 0) {
    throw new PackIoError('duplicate-path', `${name} has several entries for one path: ${pathsSummary(duplicate)}`, duplicate);
  }
  if (encrypted.length > 0) {
    throw new PackIoError('unsupported', `${name} has encrypted entries: ${pathsSummary(encrypted)}`, encrypted);
  }
  return new ZipPackSource(name, entries, input);
}

/** The file or bytes a zip source was opened from (`openZipSource`); null for any other source. */
export function zipInputOf(source: PackSource): ZipInput | null {
  return source instanceof ZipPackSource ? source.input : null;
}

// ---------------------------------------------------------------- writing

/** One file of an archive to write: its bytes, or a function that reads them when the entry is written. */
export interface ZipFile {
  path: string;
  bytes: Uint8Array | (() => Promise<Uint8Array>);
}

/** 1980-01-01 00:00:00 as the MS-DOS date and time of a zip header (`ir2rwat.ZIP_TIME`): date 0x0021 in the high half, time 0. */
const ZIP_TIME = 0x0021_0000;
/** Unix permissions 0644 in the upper half of the external attributes (`info.external_attr = 0o644 << 16`). */
const ZIP_ATTRIBUTES = 0o644 << 16;
/** "Version made by": the Unix system (3) and specification 2.0, as `zipfile` writes it with `create_system = 3`. */
const ZIP_MADE_BY = (3 << 8) | 20;

/**
 * The files as one zip, the same bytes on every run: sorted by path, every entry
 * deflated (level 6) with the same time, permissions and system, no extra fields and
 * no data descriptors. Paths must be paths inside a pack and differ; otherwise rejects
 * with `unsafe-path` or `duplicate-path` before writing anything.
 */
export async function buildZip(files: Iterable<ZipFile>): Promise<Uint8Array> {
  const sorted = [...files].sort((a, b) => comparePaths(a.path, b.path));
  const unsafe = sorted.filter((file) => packPathProblem(file.path) !== null).map((file) => file.path);
  if (unsafe.length > 0) throw new PackIoError('unsafe-path', `Not paths inside the pack: ${pathsSummary(unsafe)}`, unsafe);
  const duplicate = sorted.filter((file, i) => i > 0 && sorted[i - 1]?.path === file.path).map((file) => file.path);
  if (duplicate.length > 0) throw new PackIoError('duplicate-path', `Twice in one archive: ${pathsSummary(duplicate)}`, duplicate);

  const zip = await loadZipJs();
  const writer = new zip.ZipWriter(new zip.Uint8ArrayWriter(), NO_WORKERS);
  try {
    for (const file of sorted) {
      const bytes = typeof file.bytes === 'function' ? await file.bytes() : file.bytes;
      await writer.add(file.path, new zip.Uint8ArrayReader(bytes), {
        ...NO_WORKERS,
        level: 6,
        rawLastModDate: ZIP_TIME,
        lastModDate: new Date(1980, 0, 1), // only for the library's own bookkeeping; the header carries ZIP_TIME
        extendedTimestamp: false,
        dataDescriptor: false,
        externalFileAttributes: ZIP_ATTRIBUTES,
        versionMadeBy: ZIP_MADE_BY,
      });
    }
    return await writer.close();
  } catch (error) {
    throw wrapIoError(error);
  }
}

/**
 * A {@link PackSink} that saves the pack as a zip: each `write` takes the files of the
 * base source (none for a new pack), applies the changes to them, builds the archive
 * and hands its bytes to `deliver` (a download, a file the user picked, a test).
 *
 * The changes are relative to the base source, not to the previous save: to save twice,
 * pass everything that differs from the base both times. The base is read, one file at
 * a time, only while the archive is built.
 */
export class ZipSink implements PackSink {
  constructor(
    private readonly base: PackSource | null,
    private readonly deliver: (zip: Uint8Array) => void | Promise<void>,
  ) {}

  async write(changes: FileChange[]): Promise<void> {
    const { deletes, writes } = planChanges(changes);
    const replaced = new Set([...deletes, ...writes.map((write) => write.path)]);
    const files: ZipFile[] = writes.map(({ path, bytes }) => ({ path, bytes }));
    if (this.base !== null) {
      const base = this.base;
      for (const { path } of await base.list()) {
        if (!replaced.has(path)) files.push({ path, bytes: () => base.read(path) });
      }
    }
    await this.deliver(await buildZip(files));
  }
}
