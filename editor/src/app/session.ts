/**
 * What the user does to the editor's state (docs/proposals/editor.md §3.4): open a
 * pack, save it, undo and redo, load the schema. The panels call these and read the
 * signals of ./store.ts; the rules (what a pack is, what saving writes) are core/'s
 * and io/'s.
 */

import { batch } from '@preact/signals';
import type { Command } from '../core/contracts';
import { Journal } from '../core/journal';
import { Pack, PackError } from '../core/pack';
import { createSchema, fetchSchemaFiles } from '../core/schema';
import { describeIoError, downloadBytes, PackIoError, type PackSource } from '../io';
import { sessionOpened } from './save/keep';
import { FolderSaveError, saveTarget, saveToFolder, saveToZip, type DeliverZip } from './save/save';
import { openSaveDialog, saveReport } from './save/state';
import { activeJournal, failure, irWork, journal, mode, pack, revision, schema, schemaError, selection } from './store';

export type { DeliverZip };

/** The default delivery: a browser download. */
export const downloadZip: DeliverZip = (zip, fileName) => {
  downloadBytes(zip.slice(), fileName, 'application/zip');
};

function fail(error: unknown): void {
  if (error instanceof FolderSaveError) {
    const { report } = error;
    failure.value =
      error.cause instanceof PackIoError && error.cause.code === 'permission-denied'
        ? describeIoError(error.cause)
        : {
            key: 'save.error.partial',
            params: { written: report.written.length + report.deleted.length, left: report.pending.length + (report.failed === null ? 0 : 1), detail: report.detail },
          };
  } else if (error instanceof PackIoError) failure.value = describeIoError(error);
  else if (error instanceof PackError && (error.code === 'not-a-pack' || error.code === 'several-packs')) {
    failure.value = { key: `app.error.${error.code}`, params: { detail: error.message } };
  }
  else failure.value = { key: 'app.error.unknown', params: { detail: error instanceof Error ? error.message : String(error) } };
}

/** Makes the pack and its journal the open ones (opened, or restored from the session); the previous pack is replaced. */
export function showPack(opened: Pack, edits: Journal): void {
  edits.subscribe(() => {
    revision.value++;
  });
  batch(() => {
    pack.value = opened;
    journal.value = edits;
    selection.value = [];
    failure.value = null;
    saveReport.value = null;
    revision.value++;
  });
}

/**
 * Opens the pack in a source; the previous pack is replaced, and its session in the
 * browser with it (app/save/keep.ts). A failure goes to `failure` and leaves the open pack
 * as it was.
 */
export async function openSource(source: PackSource): Promise<boolean> {
  try {
    const opened = await Pack.open(source);
    const edits = new Journal(opened);
    showPack(opened, edits);
    void sessionOpened(opened, edits);
    return true;
  } catch (error) {
    fail(error);
    return false;
  }
}

/** Asks `pick` for a source (a file dialog, from a click) and opens it. A cancelled dialog changes nothing. */
export async function openPicked(pick: () => Promise<PackSource | null>): Promise<void> {
  failure.value = null;
  let source: PackSource | null;
  try {
    source = await pick();
  } catch (error) {
    fail(error);
    return;
  }
  if (source !== null) await openSource(source);
}

/**
 * Saves the pack (app/save/save.ts): into its own folder when it was opened for writing
 * there (only the changed files), otherwise — or when `target` is `zip` — as a zip of the
 * whole pack handed to `deliver`. Returns whether it saved; a failure is in `failure`, and
 * for a folder written part way also in `saveReport`.
 */
export async function savePack(deliver: DeliverZip = downloadZip, target?: 'folder' | 'zip'): Promise<boolean> {
  const open = pack.value;
  if (open === null) return false;
  failure.value = null;
  saveReport.value = null;
  let saved = false;
  try {
    if ((target ?? saveTarget(open)) === 'folder') await saveToFolder(open, journal.value);
    else await saveToZip(open, journal.value, deliver);
    saved = true;
  } catch (error) {
    if (error instanceof FolderSaveError) saveReport.value = error.report;
    fail(error);
  }
  revision.value++;
  return saved;
}

/**
 * Applies a command of a form or a panel to the open pack (an edit of JSON: no file is
 * read first). A refused command (a generated pack, a place that is not there) changes
 * nothing and is said in the failure banner. Returns whether it was applied.
 */
export function dispatch(command: Command): boolean {
  const edits = journal.value;
  if (edits === null) return false;
  failure.value = null;
  try {
    edits.dispatch(command);
    return true;
  } catch (error) {
    fail(error);
    return false;
  }
}

/** {@link dispatch} for a command that puts, deletes or renames files: what its undo needs is read first. */
export async function run(command: Command): Promise<boolean> {
  const edits = journal.value;
  if (edits === null) return false;
  failure.value = null;
  try {
    await edits.run(command);
    return true;
  } catch (error) {
    fail(error);
    return false;
  }
}

/** Undoes the last command of the mode's journal: the open pack's (2a), the IR session's (2b). */
export function undo(): void {
  activeJournal.value?.undo();
}

export function redo(): void {
  activeJournal.value?.redo();
}

/** Fetches the schema files from the site (`base` is the folder `schema/` as a URL) and builds the checks. */
export async function loadSchema(base: string | URL = new URL('schema/', document.baseURI)): Promise<void> {
  try {
    const built = createSchema(await fetchSchemaFiles(base));
    batch(() => {
      schema.value = built;
      schemaError.value = null;
    });
  } catch (error) {
    schemaError.value = error instanceof Error ? error.message : String(error);
  }
}

/** True for a place where the keys are the user's text editing, not the editor's commands. */
function isTyping(target: EventTarget | null): boolean {
  const element = target as { tagName?: string; isContentEditable?: boolean } | null;
  return element?.isContentEditable === true || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element?.tagName ?? '');
}

/**
 * Ctrl+Z undoes, Ctrl+Shift+Z and Ctrl+Y redo, Ctrl+S opens the save dialog (⌘ on a Mac) —
 * of the open pack in 2a, of the IR session in 2b; text fields keep their own undo.
 * Returns the function that removes the listener.
 */
export function installShortcuts(target: EventTarget = document): () => void {
  const onKey = (event: Event): void => {
    const key = event as KeyboardEvent;
    if (!(key.ctrlKey || key.metaKey) || key.altKey || isTyping(key.target)) return;
    const name = key.key.toLowerCase();
    if (name === 'z') {
      if (key.shiftKey) redo();
      else undo();
    } else if (name === 'y' && !key.shiftKey) {
      redo();
    } else if (name === 's' && !key.shiftKey) {
      if (mode.value === '2b') irWork.value?.openSave();
      else if (pack.value !== null) openSaveDialog();
    } else {
      return;
    }
    key.preventDefault();
  };
  target.addEventListener('keydown', onKey);
  return () => target.removeEventListener('keydown', onKey);
}
