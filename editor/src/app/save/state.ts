/**
 * The state of saving and of the session, as signals (editor.md §2.5, M5): whether the
 * save dialog is open, what the last save into a folder left undone, what the session
 * kept from the last visit offers, and how the session's own keeping goes. Signals only:
 * what changes them is ./save.ts, ./keep.ts and ./restore.ts.
 */

import { signal } from '@preact/signals';
import type { FingerprintChanges, KeeperStatus, SessionRecord } from '../../core/session';
import type { PackSource } from '../../io';

/** True while the save dialog is open. */
export const saveDialogOpen = signal(false);

/** Opens the save dialog (the Save button, Ctrl+S). */
export function openSaveDialog(): void {
  saveDialogOpen.value = true;
}

/** What a save into a folder that failed part way did: the files written and deleted, the one it stopped at, those not reached. */
export interface FolderReport {
  written: string[];
  deleted: string[];
  /** The file the save stopped at; null when it failed before the first (permission) or after the last (tidying folders). */
  failed: string | null;
  pending: string[];
  detail: string;
}

/** The last save's failure in the middle of writing a folder; null after a save that went through. */
export const saveReport = signal<FolderReport | null>(null);

/** Where the session restore stands, from the offer at start to the pack opened again; null when there is nothing to offer. */
export type RestoreState =
  /** A session with unsaved work was kept: restore it or start afresh. */
  | { step: 'offer'; record: SessionRecord }
  /** The kept session is from another version of the editor (or broken). */
  | { step: 'incompatible'; reason: string }
  /** The files of the folder or of the reopened zip differ from what the session last saw. */
  | { step: 'changed'; record: SessionRecord; source: PackSource; changes: FingerprintChanges }
  | { step: 'busy'; record: SessionRecord }
  /** Restoring failed: why, as an i18n key and its values. */
  | { step: 'failed'; record: SessionRecord | null; key: string; params: Record<string, string | number> };

export const restoreState = signal<RestoreState | null>(null);

/** How the session's keeping in the browser goes (core/session `KeeperStatus`). */
export const keeperStatus = signal<KeeperStatus>('off');
