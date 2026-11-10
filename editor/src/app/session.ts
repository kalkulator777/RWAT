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
import { describeIoError, downloadBytes, FsAccessSource, PackIoError, ZipSink, zipFileName, type PackSource } from '../io';
import { failure, journal, pack, revision, schema, schemaError, selection } from './store';

/** Hands a zip of the pack to the user under a name. */
export type DeliverZip = (zip: Uint8Array, fileName: string) => void | Promise<void>;

/** The default delivery: a browser download. */
export const downloadZip: DeliverZip = (zip, fileName) => {
  downloadBytes(zip.slice(), fileName, 'application/zip');
};

function fail(error: unknown): void {
  if (error instanceof PackIoError) failure.value = describeIoError(error);
  else if (error instanceof PackError && (error.code === 'not-a-pack' || error.code === 'several-packs')) {
    failure.value = { key: `app.error.${error.code}`, params: { detail: error.message } };
  }
  else failure.value = { key: 'app.error.unknown', params: { detail: error instanceof Error ? error.message : String(error) } };
}

/** Opens the pack in a source; the previous pack is replaced. A failure goes to `failure` and leaves the open pack as it was. */
export async function openSource(source: PackSource): Promise<boolean> {
  try {
    const opened = await Pack.open(source);
    const edits = new Journal(opened);
    edits.subscribe(() => {
      revision.value++;
    });
    batch(() => {
      pack.value = opened;
      journal.value = edits;
      selection.value = [];
      failure.value = null;
      revision.value++;
    });
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
 * Saves the pack: into its own folder when it was opened for writing there (only the
 * changed files), otherwise as a zip of the whole pack handed to `deliver`.
 */
export async function savePack(deliver: DeliverZip = downloadZip): Promise<void> {
  const open = pack.value;
  if (open === null) return;
  failure.value = null;
  try {
    const { source } = open;
    if (source instanceof FsAccessSource && source.writable) {
      await open.save(source.sink(), { inSource: true });
    } else {
      const name = zipFileName(source.name);
      await open.save(new ZipSink(null, (zip) => deliver(zip, name)), { whole: true });
    }
  } catch (error) {
    fail(error);
  }
  revision.value++;
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

export function undo(): void {
  journal.value?.undo();
}

export function redo(): void {
  journal.value?.redo();
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

/** Ctrl+Z undoes, Ctrl+Shift+Z and Ctrl+Y redo, Ctrl+S saves (⌘ on a Mac); text fields keep their own undo. Returns the function that removes the listener. */
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
      void savePack();
    } else {
      return;
    }
    key.preventDefault();
  };
  target.addEventListener('keydown', onKey);
  return () => target.removeEventListener('keydown', onKey);
}
