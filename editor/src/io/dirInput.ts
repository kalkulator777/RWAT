/**
 * A folder picked through `<input type="file" webkitdirectory>`: works in every browser,
 * reads only (docs/proposals/editor.md §1.2: Firefox and Safari have no File System
 * Access). The browser hands over every file of the folder with its path relative to the
 * folder's parent (`MyPack/assets/x.png`); the folder's own name is cut off.
 */

import type { FileEntry, PackSource } from '../core/contracts';
import { causeText, PackIoError, pathsSummary } from './errors';
import { comparePaths, normalizeEntryName } from '../core/paths';

class DirInputSource implements PackSource {
  readonly kind = 'dir-input';
  readonly writable = false;

  constructor(
    readonly name: string,
    private readonly files: ReadonlyMap<string, File>,
  ) {}

  list(): Promise<FileEntry[]> {
    const list = [...this.files].map(([path, file]) => ({ path, size: file.size }));
    return Promise.resolve(list.sort((a, b) => comparePaths(a.path, b.path)));
  }

  async read(path: string): Promise<Uint8Array> {
    const file = this.files.get(path);
    if (file === undefined) throw new PackIoError('not-found', `No file ${JSON.stringify(path)} in ${this.name}`, [path]);
    try {
      return new Uint8Array(await file.arrayBuffer());
    } catch (error) {
      // A file changed or removed after the pick can no longer be read (NotReadableError).
      throw new PackIoError('io', `Cannot read ${JSON.stringify(path)}: ${causeText(error)}`, [path], { cause: error });
    }
  }
}

/** The path the browser reports for a picked file: `webkitRelativePath`, or just the name when the input was no folder input. */
function reportedPath(file: File): string {
  return file.webkitRelativePath === '' ? file.name : file.webkitRelativePath;
}

/**
 * The files of a picked folder as a pack source named after the folder. The folder's
 * name is the first part every path has in common; when the files share none (a
 * plain multi-file pick), the paths stay as they are and the name is `fallbackName`.
 * Throws a {@link PackIoError} for a path that is not a path inside the pack
 * (`unsafe-path`) or is there twice (`duplicate-path`).
 */
export function openDirInputSource(files: Iterable<File>, fallbackName = ''): PackSource {
  const picked = [...files].map((file) => ({ file, raw: reportedPath(file) }));
  const first = (raw: string): string => raw.replaceAll('\\', '/').split('/')[0] ?? '';
  const root = picked.length > 0 && picked.every(({ raw }) => raw.includes('/') || raw.includes('\\')) ? first(picked[0]?.raw ?? '') : '';
  const shared = root !== '' && picked.every(({ raw }) => first(raw) === root);

  const byPath = new Map<string, File>();
  const unsafe: string[] = [];
  const duplicate: string[] = [];
  for (const { file, raw } of picked) {
    const normal = normalizeEntryName(shared ? raw.replaceAll('\\', '/').slice(root.length + 1) : raw);
    if ('problem' in normal) unsafe.push(raw);
    else if (byPath.has(normal.path)) duplicate.push(raw);
    else byPath.set(normal.path, file);
  }
  const name = shared ? root : fallbackName;
  if (unsafe.length > 0) {
    throw new PackIoError('unsafe-path', `${name} has files that are not paths inside a pack: ${pathsSummary(unsafe)}`, unsafe);
  }
  if (duplicate.length > 0) {
    throw new PackIoError('duplicate-path', `${name} has several files for one path: ${pathsSummary(duplicate)}`, duplicate);
  }
  return new DirInputSource(name, byPath);
}
