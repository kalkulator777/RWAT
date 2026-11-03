/**
 * What every sink does with a list of {@link FileChange}s, in one place: check the
 * paths, put the changes in the order a folder is written in, and apply them to a
 * folder-like backend (File System Access, Node's fs, memory).
 */

import type { FileChange } from '../core/contracts';
import { PackIoError, pathsSummary } from './errors';
import { compareForWriting, comparePaths, packPathProblem, parentPath } from '../core/paths';

/** A change that deletes. */
export function isDelete(change: FileChange): change is { path: string; delete: true } {
  return 'delete' in change;
}

/** The changes checked and ordered: what to delete, then what to write. */
export interface WritePlan {
  /** Pack paths to delete, in path order. */
  deletes: string[];
  /** Files to create or replace, in path order with `pack.mcmeta` last (as the converter writes a folder). */
  writes: { path: string; bytes: Uint8Array }[];
}

/**
 * Checks a batch of changes and orders it. Refuses the whole batch, before anything is
 * written, when a path is not a path inside the pack (`unsafe-path`: the zip-slip
 * guard of the writing side) or one path appears twice (`duplicate-path`: the order
 * of two changes of one file would decide the result).
 */
export function planChanges(changes: readonly FileChange[]): WritePlan {
  const unsafe: string[] = [];
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const change of changes) {
    if (packPathProblem(change.path) !== null) {
      unsafe.push(change.path);
      continue;
    }
    if (seen.has(change.path)) duplicates.push(change.path);
    seen.add(change.path);
  }
  if (unsafe.length > 0) {
    throw new PackIoError('unsafe-path', `Not paths inside the pack: ${pathsSummary(unsafe)}`, unsafe);
  }
  if (duplicates.length > 0) {
    throw new PackIoError('duplicate-path', `Changed twice in one batch: ${pathsSummary(duplicates)}`, duplicates);
  }
  const deletes: string[] = [];
  const writes: { path: string; bytes: Uint8Array }[] = [];
  for (const change of changes) {
    if (isDelete(change)) deletes.push(change.path);
    else writes.push({ path: change.path, bytes: change.bytes });
  }
  deletes.sort(comparePaths);
  writes.sort((a, b) => compareForWriting(a.path, b.path));
  return { deletes, writes };
}

/** What a folder needs to be written to: paths are pack paths, parents are created on demand. */
export interface FolderBackend {
  /** Creates or replaces the file, with the folders above it. */
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  /** Deletes the file; false when there was none. */
  removeFile(path: string): Promise<boolean>;
  /** Deletes the folder if it exists and holds nothing; false otherwise. */
  removeFolderIfEmpty(path: string): Promise<boolean>;
}

/**
 * Applies the changes to a folder: first the deletions, then the writes (`pack.mcmeta`
 * last), then the folders the deletions emptied are removed, from the innermost up to
 * (not including) the pack's own folder. Deleting a file that is not there is not an
 * error: the folder is as asked.
 */
export async function applyChanges(backend: FolderBackend, changes: readonly FileChange[]): Promise<void> {
  const { deletes, writes } = planChanges(changes);
  for (const path of deletes) await backend.removeFile(path);
  for (const { path, bytes } of writes) await backend.writeFile(path, bytes);
  const emptied = new Set(deletes.map(parentPath));
  const folders = [...emptied].filter((folder) => folder !== '').sort((a, b) => b.length - a.length);
  const gone = new Set<string>();
  for (const start of folders) {
    for (let folder = start; folder !== '' && !gone.has(folder); folder = parentPath(folder)) {
      if (!(await backend.removeFolderIfEmpty(folder))) break;
      gone.add(folder);
    }
  }
}
