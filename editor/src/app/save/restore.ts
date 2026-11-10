/**
 * Restoring the session kept from the last visit (editor.md §2.2 step 5, M5): when the
 * editor starts, a kept session with unsaved work is offered — restore it or start afresh.
 *
 * Restoring opens the base again — the folder by its handle (the browser asks for the
 * permission again, so it is done in the click of "Restore"), the kept zip or files, or
 * the zip or folder the user opens again — and, where the base is not kept whole,
 * compares its files with the fingerprint the session had. Files that changed are named
 * and the user decides: the edits are replayed over them only when asked (nothing is
 * written before a save anyway), or the session is dropped. Then the journal is replayed
 * (core/session/replay.ts) and the pack opens with its undo, redo and save point, and the
 * session carries on where it was.
 */

import { compareFingerprints, fingerprintOf, FilesSource, isUnchanged, OverlaySource, replaySession, type SessionBase, type SessionRecord } from '../../core/session';
import { parseJournal } from '../../core/journal';
import { describeIoError, FsAccessSource, openFsAccessSource, openZipSource, PackIoError, pickFolderPack, pickZipPack, type FsDirectoryHandle, type PackSource } from '../../io';
import { showPack } from '../session';
import { follow, keeper, readOrNull } from './keep';
import { restoreState } from './state';

/** Looks at what the session store holds and offers it: a session with unsaved work, or one that cannot be restored. */
export async function checkKeptSession(): Promise<void> {
  let kept;
  try {
    kept = await keeper().load();
  } catch (error) {
    console.warn('the kept session could not be read', error);
    return;
  }
  if (kept.kind === 'incompatible') restoreState.value = { step: 'incompatible', reason: kept.reason };
  else if (kept.kind === 'session' && kept.record.dirty > 0) restoreState.value = { step: 'offer', record: kept.record };
}

function failed(record: SessionRecord | null, error: unknown): void {
  const params = error instanceof PackIoError ? describeIoError(error) : { key: 'save.restore.failed', params: { detail: error instanceof Error ? error.message : String(error) } };
  restoreState.value = { step: 'failed', record, key: params.key, params: params.params };
}

/** The base opened again; null when the user cancelled the dialog of a zip or folder to open again. */
async function openBase(base: SessionBase): Promise<PackSource | null> {
  switch (base.kind) {
    case 'folder':
      return openFsAccessSource(base.handle as FsDirectoryHandle, 'readwrite');
    case 'zip':
      return openZipSource(base.zip, base.name);
    case 'files':
      return new FilesSource(base.name, base.files);
    case 'reopen':
      return base.what === 'zip' ? pickZipPack() : pickFolderPack();
  }
}

/**
 * "Restore" (call it in a click: a folder asks for its permission, a zip or folder to open
 * again shows the file dialog). Files that changed since the session saw them stop at the
 * question; otherwise the session is restored.
 */
export async function restoreKept(): Promise<void> {
  const state = restoreState.value;
  if (state?.step !== 'offer') return;
  const { record } = state;
  restoreState.value = { step: 'busy', record };
  let source: PackSource | null;
  try {
    const base = await keeper().loadBase(record);
    if (base === null) return failed(record, new Error('the session has lost what the pack opens from'));
    source = await openBase(base);
  } catch (error) {
    return failed(record, error);
  }
  if (source === null) {
    restoreState.value = state; // the dialog was cancelled: ask again
    return;
  }
  if (record.fingerprint !== null) {
    let changes;
    try {
      changes = compareFingerprints(record.fingerprint, await fingerprintOf(source));
    } catch (error) {
      return failed(record, error);
    }
    if (!isUnchanged(changes)) {
      restoreState.value = { step: 'changed', record, source, changes };
      return;
    }
  }
  await replayKept(record, source);
}

/** "Restore anyway" after the files changed: the edits replay over the files as they are now. */
export async function restoreAnyway(): Promise<void> {
  const state = restoreState.value;
  if (state?.step !== 'changed') return;
  restoreState.value = { step: 'busy', record: state.record };
  await replayKept(state.record, state.source, true);
}

/** Replays the session on the source and opens the pack it gives; the session carries on (`accept`: taking the files as they are now as the ones it saw). */
async function replayKept(record: SessionRecord, source: PackSource, accept = false): Promise<void> {
  try {
    const folder = source instanceof FsAccessSource;
    const before = new Map(record.overlay);
    const { pack, journal } = await replaySession(folder ? new OverlaySource(source, before) : source, parseJournal(record.journal), {
      savePoint: record.savePoint,
      folder: folder
        ? {
            paths: [...before.keys()].filter((path) => path.startsWith(record.root)).map((path) => path.slice(record.root.length)),
            read: (path) => readOrNull(source, record.root + path),
          }
        : undefined,
    });
    showPack(pack, journal);
    follow(journal);
    await keeper().adopt(pack, journal, record);
    if (accept) await keeper().saved(source);
    restoreState.value = null;
  } catch (error) {
    failed(record, error);
  }
}

/** "Start afresh": the kept session is dropped. */
export async function discardKept(): Promise<void> {
  restoreState.value = null;
  await keeper().discard();
}

/** Closes the question and keeps the session as it is (until a pack is opened, which replaces it). */
export function postponeRestore(): void {
  restoreState.value = null;
}
