/**
 * The session (editor.md §3.5, M5): the open pack's unsaved work kept in IndexedDB after
 * every change — what the pack opens from and the journal of edits — and made live again
 * after the tab was closed or the page reloaded. Pure of the page: the store is given
 * (IndexedDB in the browser, memory in the tests), and app/save decides when to keep and
 * what to ask the user.
 */

export { compareFingerprints, fingerprintOf, isUnchanged, sha256, type FileMark, type Fingerprint, type FingerprintChanges } from './fingerprint';
export { KEEP_DELAY_MS, SessionKeeper, type KeeperStatus, type Kept } from './keeper';
export {
  BASE_KEY,
  RECORD_KEY,
  SESSION_SCHEMA,
  ZIP_KEEP_LIMIT,
  readBase,
  readRecord,
  type Incompatible,
  type SessionBase,
  type SessionBaseKind,
  type SessionRecord,
} from './record';
export { replaySession, type ReplayOptions } from './replay';
export { FilesSource, OverlaySource, homeOf } from './sources';
export { MemoryStore, SESSION_DB, SESSION_OBJECTS, indexedDbStore, type KeyValueStore } from './store';
