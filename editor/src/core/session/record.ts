/**
 * The session as it is kept (editor.md §3.5, M5): two values of the session's store.
 *
 * - `base` ({@link SessionBase}) — what the pack opens from again, written once when the
 *   pack is opened: a folder's File System Access handle (the folder itself stays on
 *   disk, nothing of it is copied), the zip itself (up to {@link ZIP_KEEP_LIMIT}), the
 *   files of a pack the editor made, or only the name of a zip or folder the user has to
 *   open again (a bigger zip; a folder read through a file input, whose files cannot be
 *   kept a reference to).
 * - `record` ({@link SessionRecord}) — written after every change: the journal (core/journal
 *   serialize, new files' bytes in it), its save point, the fingerprint of the files the
 *   base has, and for a folder the bytes its files had before the session's saves wrote
 *   them (the journal replays from the pack as opened).
 *
 * The record carries {@link SESSION_SCHEMA}. A record of another schema, or one that does
 * not read, is incompatible: the editor offers to start afresh and does not fail.
 */

import { parseJournal } from '../journal/serialize';
import type { Fingerprint } from './fingerprint';

/** The version of what the session store holds; a record of another one is not restored. */
export const SESSION_SCHEMA = 1;

/** The keys of the session store. */
export const RECORD_KEY = 'record';
export const BASE_KEY = 'base';

/**
 * The biggest zip the session keeps a copy of (64 MiB). A pack of the user's own models is
 * a few megabytes: keeping it lets the session come back with one click. A pack of hundreds
 * of megabytes would be copied into the browser's storage on every open, so of a bigger zip
 * only its fingerprint is kept and the user opens the same zip again.
 */
export const ZIP_KEEP_LIMIT = 64 * 1024 * 1024;

export type SessionBase =
  /** A folder opened through File System Access: its handle. */
  | { kind: 'folder'; name: string; handle: unknown }
  /** The zip the pack was opened from. */
  | { kind: 'zip'; name: string; zip: Blob | Uint8Array }
  /** Every file of the pack: a pack the editor made, held in memory. */
  | { kind: 'files'; name: string; files: [string, Uint8Array][] }
  /** Nothing kept: the user opens the same zip or folder again, checked by the fingerprint. */
  | { kind: 'reopen'; name: string; what: 'zip' | 'folder' };

export type SessionBaseKind = SessionBase['kind'];

export interface SessionRecord {
  schema: typeof SESSION_SCHEMA;
  /** The source's name: the folder's or the zip's. */
  name: string;
  /** Which {@link SessionBase} the store holds (read only when restoring: a folder's handle is not touched before). */
  base: SessionBaseKind;
  /** For a base to open again: what the user opens. */
  reopen: 'zip' | 'folder' | null;
  /** The pack's folder in the source (`Pack.root`). */
  root: string;
  /** When the session began and was last written (ms since 1970). */
  created: number;
  updated: number;
  /** The files of the base when the pack was opened or last saved into it; null where the base is kept whole. */
  fingerprint: Fingerprint | null;
  /** Folder: source path → the bytes it had when the pack was opened (null: none), for each file a save wrote or deleted. */
  overlay: [string, Uint8Array | null][];
  /** The journal (core/journal `serializeJournal`). */
  journal: string;
  /** The journal's save point (`Journal.savePoint`). */
  savePoint: number | null;
  /** How many files differ from what was saved: a session with none is not offered for restoring. */
  dirty: number;
}

/** A record that cannot be restored, and why (English, for the log). */
export interface Incompatible {
  incompatible: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const BASE_KINDS: readonly SessionBaseKind[] = ['folder', 'zip', 'files', 'reopen'];

/** The record as kept, or why it is not one this editor restores. */
export function readRecord(value: unknown): SessionRecord | Incompatible {
  if (!isRecord(value)) return { incompatible: 'not a session record' };
  if (value.schema !== SESSION_SCHEMA) return { incompatible: `session schema ${JSON.stringify(value.schema)}, this editor keeps ${SESSION_SCHEMA}` };
  const fields: [string, (v: unknown) => boolean][] = [
    ['name', (v) => typeof v === 'string'],
    ['base', (v) => BASE_KINDS.includes(v as SessionBaseKind)],
    ['reopen', (v) => v === null || v === 'zip' || v === 'folder'],
    ['root', (v) => typeof v === 'string'],
    ['created', (v) => typeof v === 'number'],
    ['updated', (v) => typeof v === 'number'],
    ['fingerprint', (v) => v === null || (isRecord(v) && isRecord(v.files))],
    ['overlay', (v) => Array.isArray(v) && v.every((e) => Array.isArray(e) && typeof e[0] === 'string' && (e[1] === null || e[1] instanceof Uint8Array))],
    ['journal', (v) => typeof v === 'string'],
    ['savePoint', (v) => v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 0)],
    ['dirty', (v) => typeof v === 'number'],
  ];
  for (const [key, ok] of fields) if (!ok(value[key])) return { incompatible: `"${key}" is not as this editor keeps it` };
  try {
    parseJournal(value.journal as string);
  } catch (error) {
    return { incompatible: error instanceof Error ? error.message : String(error) };
  }
  return value as unknown as SessionRecord;
}

/** The base as kept, or null when it is not one (a record without its base cannot be restored). */
export function readBase(value: unknown, kind: SessionBaseKind): SessionBase | null {
  if (!isRecord(value) || value.kind !== kind || typeof value.name !== 'string') return null;
  switch (kind) {
    case 'folder':
      return value.handle !== null && typeof value.handle === 'object' ? (value as unknown as SessionBase) : null;
    case 'zip':
      return value.zip instanceof Uint8Array || (typeof Blob !== 'undefined' && value.zip instanceof Blob) ? (value as unknown as SessionBase) : null;
    case 'files':
      return Array.isArray(value.files) && value.files.every((e) => Array.isArray(e) && typeof e[0] === 'string' && e[1] instanceof Uint8Array)
        ? (value as unknown as SessionBase)
        : null;
    case 'reopen':
      return value.what === 'zip' || value.what === 'folder' ? (value as unknown as SessionBase) : null;
  }
}
