/**
 * The session of the open pack kept in the browser (editor.md M5): what each kind of
 * source keeps as the base to open again, and the keeper that writes the session to
 * IndexedDB after every change. The keeper is one for the page; the tests give it a store
 * in memory ({@link useSessionStore}).
 *
 * What is kept of each source (core/session/record.ts):
 * - a folder through File System Access — its handle; nothing of its files is copied;
 * - a zip — the zip itself, up to `ZIP_KEEP_LIMIT`; a bigger zip only by its fingerprint,
 *   and the user opens it again;
 * - a folder read through a file input — its fingerprint (a reference to its files cannot be
 *   kept), the user opens it again;
 * - a pack the editor made (in memory) — its files, up to the same limit.
 */

import type { Journal } from '../../core/journal';
import type { Pack } from '../../core/pack';
import { SessionKeeper, ZIP_KEEP_LIMIT, homeOf, indexedDbStore, type KeyValueStore, type SessionBase } from '../../core/session';
import { FsAccessSource, PackIoError, readAll, zipInputOf, type PackSource } from '../../io';
import { keeperStatus } from './state';

let current: SessionKeeper | null = null;
let leaveJournal: (() => void) | null = null;
let opening: Promise<void> = Promise.resolve();

function connect(keeper: SessionKeeper): SessionKeeper {
  keeper.subscribe((status, error) => {
    keeperStatus.value = status;
    if (status === 'error') console.warn('the session could not be kept in the browser', error);
  });
  keeperStatus.value = keeper.status;
  return keeper;
}

/** The page's keeper: IndexedDB, or none where the browser has none. */
export function keeper(): SessionKeeper {
  current ??= connect(new SessionKeeper(indexedDbStore()));
  return current;
}

/** Puts the keeper on another store (a test's memory, null for none); returns the keeper. */
export function useSessionStore(store: KeyValueStore | null, options: { delay?: number; now?: () => number } = {}): SessionKeeper {
  leaveJournal?.();
  leaveJournal = null;
  current = connect(new SessionKeeper(store, options));
  return current;
}

/** What the session keeps to open the source again; null for a source it cannot keep (Node's file system, a too big pack in memory). */
export async function baseFor(source: PackSource): Promise<SessionBase | null> {
  const home = homeOf(source);
  const name = home.name;
  if (home instanceof FsAccessSource) return { kind: 'folder', name, handle: home.handle };
  const zip = zipInputOf(home);
  if (zip !== null) {
    const bytes = zip instanceof ArrayBuffer ? new Uint8Array(zip) : zip;
    const size = bytes instanceof Uint8Array ? bytes.length : bytes.size;
    return size <= ZIP_KEEP_LIMIT ? { kind: 'zip', name, zip: bytes } : { kind: 'reopen', name, what: 'zip' };
  }
  if (home.kind === 'dir-input') return { kind: 'reopen', name, what: 'folder' };
  if (home.kind === 'memory') {
    const entries = await home.list();
    if (entries.reduce((sum, entry) => sum + entry.size, 0) > ZIP_KEEP_LIMIT) return null;
    return { kind: 'files', name, files: [...(await readAll(home))] };
  }
  return null;
}

/** Keeps the journal's changes from now on (the previous pack's are no longer heard). */
export function follow(journal: Journal): void {
  leaveJournal?.();
  const keep = keeper();
  leaveJournal = journal.subscribe(() => keep.changed());
}

/** A pack was opened: its session begins, replacing the one kept. Never rejects: a session that cannot be kept is said in the log. */
export function sessionOpened(pack: Pack, journal: Journal): Promise<void> {
  opening = begin(pack, journal);
  return opening;
}

/** Resolves once the session of the pack opened last has begun and everything is written. */
export async function sessionSettled(): Promise<void> {
  await opening;
  await keeper().flush();
}

async function begin(pack: Pack, journal: Journal): Promise<void> {
  const keep = keeper();
  follow(journal);
  try {
    const base = await baseFor(pack.source);
    if (base === null) {
      await keep.discard();
      return;
    }
    await keep.begin(pack, journal, base, homeOf(pack.source));
  } catch (error) {
    console.warn('the session could not be kept in the browser', error);
  }
}

/** The file's bytes in the source, or null when it has none; any other failure rejects. */
export async function readOrNull(source: PackSource, path: string): Promise<Uint8Array | null> {
  try {
    return await source.read(path);
  } catch (error) {
    if (error instanceof PackIoError && error.code === 'not-found') return null;
    throw error;
  }
}
