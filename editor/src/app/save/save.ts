/**
 * Saving the open pack (editor.md §2.5, step 3; §3.6): into the folder it was opened from,
 * or as a zip handed to the user. Both mark the journal's save point and tell the session.
 *
 * - **Into the folder** (File System Access, opened for writing): only the files that
 *   changed are written — a changed JSON file as its own text with only the changed places
 *   edited — deleted files are deleted, `pack.mcmeta` is written last (io/changes.ts).
 *   Before the first byte is written the session keeps what the save replaces. A write
 *   that fails part way leaves the pack as unsaved and says which files were written and
 *   which not ({@link FolderReport}); saving again writes them all again, which is safe.
 * - **As a zip** (a zip, a folder opened for reading only, a new pack, a browser without
 *   File System Access): the whole pack, the unchanged files byte for byte as they were,
 *   in an archive that is the same bytes for the same files (io/zip.ts `buildZip`). A zip
 *   of a pack that lives in a File System Access folder is a copy and saves nothing.
 */

import type { FileChange } from '../../core/contracts';
import type { Journal } from '../../core/journal';
import type { Pack } from '../../core/pack';
import { homeOf } from '../../core/session';
import { buildZip, FsAccessSource, PackIoError, planChanges, ZipSink, zipFileName, type PackSink } from '../../io';
import { causeText } from '../../io/errors';
import { keeper, readOrNull } from './keep';
import type { FolderReport } from './state';

/** Hands a zip of the pack to the user under a name. */
export type DeliverZip = (zip: Uint8Array, fileName: string) => void | Promise<void>;

/** The folder the pack can be saved into, or null when it is saved as a zip. */
export function folderOf(pack: Pack): FsAccessSource | null {
  const home = homeOf(pack.source);
  return home instanceof FsAccessSource ? home : null;
}

/** How the pack is saved now: in place (a folder opened for writing) or as a zip. */
export function saveTarget(pack: Pack): 'folder' | 'zip' {
  return folderOf(pack)?.writable === true && !pack.readOnly ? 'folder' : 'zip';
}

/** The name the zip of the pack is downloaded under. */
export function zipNameOf(pack: Pack): string {
  return zipFileName(homeOf(pack.source).name);
}

/** A save into the folder that failed part way. */
export class FolderSaveError extends Error {
  constructor(
    readonly report: FolderReport,
    options: { cause: unknown },
  ) {
    super(`saving into the folder stopped: ${report.detail}`, options);
    this.name = 'FolderSaveError';
  }
}

/**
 * Saves the changed files into the pack's folder. Rejects with {@link FolderSaveError}
 * when a write fails (the pack stays unsaved), or as the folder's permission does.
 */
export async function saveToFolder(pack: Pack, journal: Journal | null): Promise<FileChange[]> {
  const folder = folderOf(pack);
  if (folder === null) throw new Error('the pack was not opened from a folder it can be saved into');
  const keep = keeper();
  const steps: { path: string; action: 'write' | 'delete' }[] = [];
  let planned: string[] = [];
  let writing = false;
  const inner = folder.sink((step) => steps.push(step));
  const sink: PackSink = {
    write: async (changes) => {
      const plan = planChanges(changes);
      planned = [...plan.deletes, ...plan.writes.map((write) => write.path)];
      await keep.beforeWrite(planned, (path) => readOrNull(folder, path));
      writing = true;
      await inner.write(changes);
    },
  };
  try {
    const written = await pack.save(sink, { inSource: true });
    journal?.markSaved();
    return written;
  } catch (error) {
    const done = new Set(steps.map((step) => step.path));
    const left = planned.filter((path) => !done.has(path));
    // no file is to blame when the folder refused before the first, or the session could not keep what it replaces
    const denied = error instanceof PackIoError && error.code === 'permission-denied';
    const failed = writing && !denied ? (left[0] ?? null) : null;
    throw new FolderSaveError(
      {
        written: steps.filter((step) => step.action === 'write').map((step) => step.path),
        deleted: steps.filter((step) => step.action === 'delete').map((step) => step.path),
        failed,
        pending: failed === null ? left : left.slice(1),
        detail: causeText(error) || String(error),
      },
      { cause: error },
    );
  } finally {
    await keep.saved(folder);
  }
}

/**
 * Saves the whole pack as a zip handed to `deliver`. For a pack that lives in a folder the
 * zip is a copy: the folder is what the pack is saved into, so the pack stays unsaved
 * until it is written there.
 */
export async function saveToZip(pack: Pack, journal: Journal | null, deliver: DeliverZip): Promise<FileChange[]> {
  const name = zipNameOf(pack);
  if (folderOf(pack) !== null) {
    const files = await pack.snapshot();
    await deliver(await buildZip(files.map((file) => ({ path: file.path, bytes: (file as { bytes: Uint8Array }).bytes }))), name);
    return files;
  }
  const written = await pack.save(new ZipSink(null, (zip) => deliver(zip, name)), { whole: true });
  journal?.markSaved();
  await keeper().saved(null);
  return written;
}
