/**
 * Keeps the open pack's session in the store (editor.md §3.5, M5), so unsaved work lives
 * through a closed tab, a reload or a crash:
 *
 * - {@link SessionKeeper.begin} — a pack was opened: its base and a fresh record are
 *   written (the previous session is replaced);
 * - {@link SessionKeeper.changed} — the journal or the pack changed: the record is written a
 *   moment later ({@link SessionKeeper.flush} writes it now);
 * - {@link SessionKeeper.beforeWrite} and {@link SessionKeeper.saved} — around a save into a
 *   folder: first the bytes the save is about to replace (those the session did not keep
 *   yet) are kept, then the folder's new fingerprint;
 * - {@link SessionKeeper.load}, {@link SessionKeeper.loadBase} and {@link SessionKeeper.adopt}
 *   — what is kept (the base only when it is restored), and carrying on with a session
 *   restored from it (core/session/replay.ts);
 * - {@link SessionKeeper.discard} — the user starts afresh.
 *
 * Writes go one after another in the order asked; a write that fails is told to the
 * listener and the next one tries again. The keeper knows nothing of the page: what the
 * base of a source is, and when to ask, is app/save's.
 */

import type { PackSource } from '../contracts';
import type { Journal } from '../journal/journal';
import { serializeJournal } from '../journal/serialize';
import type { Pack } from '../pack/pack';
import { fingerprintOf, type Fingerprint } from './fingerprint';
import { BASE_KEY, RECORD_KEY, SESSION_SCHEMA, readBase, readRecord, type SessionBase, type SessionRecord } from './record';
import type { KeyValueStore } from './store';

/** What the keeper is doing: nowhere to keep (`off`), a write waiting or under way, all written, the last write failed. */
export type KeeperStatus = 'off' | 'idle' | 'pending' | 'saved' | 'error';

/** What the store holds. */
export type Kept =
  | { kind: 'none' }
  | { kind: 'incompatible'; reason: string }
  | { kind: 'session'; record: SessionRecord };

/** How long after a change the record is written (ms): a run of edits is one write. */
export const KEEP_DELAY_MS = 300;

export class SessionKeeper {
  private open: { pack: Pack; journal: Journal } | null = null;
  private record: SessionRecord | null = null;
  private queue: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private current: KeeperStatus;
  private readonly listeners = new Set<(status: KeeperStatus, error?: unknown) => void>();

  constructor(
    private readonly store: KeyValueStore | null,
    private readonly options: { delay?: number; now?: () => number } = {},
  ) {
    this.current = store === null ? 'off' : 'idle';
  }

  get status(): KeeperStatus {
    return this.current;
  }

  /** The record of the session under way (a copy of nothing: read it, do not change it); null when there is none. */
  get session(): Readonly<SessionRecord> | null {
    return this.record;
  }

  /** Calls the listener on every change of {@link status}; returns the function that removes it. */
  subscribe(listener: (status: KeeperStatus, error?: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private set(status: KeeperStatus, error?: unknown): void {
    if (this.store === null) return;
    this.current = status;
    for (const listener of this.listeners) listener(status, error);
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  /** Runs the write after the ones before it; a failure is told and does not stop the next. */
  private enqueue(write: (store: KeyValueStore) => Promise<void>): Promise<void> {
    const store = this.store;
    if (store === null) return Promise.resolve();
    this.queue = this.queue.then(
      () => write(store).then(() => this.set(this.timer === null ? 'saved' : 'pending')),
    ).catch((error: unknown) => this.set('error', error));
    return this.queue;
  }

  /** What the store holds: a session, one this editor cannot restore, or nothing. */
  async load(): Promise<Kept> {
    if (this.store === null) return { kind: 'none' };
    const value = await this.store.get(RECORD_KEY);
    if (value === undefined) return { kind: 'none' };
    const record = readRecord(value);
    if ('incompatible' in record) return { kind: 'incompatible', reason: record.incompatible };
    return { kind: 'session', record };
  }

  /**
   * The base of a kept record, read when it is restored, not before: a session that is not
   * restored never touches what it opens from (a folder's handle). Null when it is lost.
   */
  async loadBase(record: SessionRecord): Promise<SessionBase | null> {
    if (this.store === null) return null;
    return readBase(await this.store.get(BASE_KEY), record.base);
  }

  /**
   * A pack was opened from `source`: the store gets its base and a record with no edits,
   * replacing the session that was there. The fingerprint is taken where the base is not
   * kept whole (a folder, a zip or folder to open again).
   */
  begin(pack: Pack, journal: Journal, base: SessionBase, source: PackSource): Promise<void> {
    this.cancelTimer();
    const now = this.now();
    const record: SessionRecord = {
      schema: SESSION_SCHEMA,
      name: base.name,
      base: base.kind,
      reopen: base.kind === 'reopen' ? base.what : null,
      root: pack.root,
      created: now,
      updated: now,
      fingerprint: null,
      overlay: [],
      journal: serializeJournal(journal.state()),
      savePoint: journal.savePoint,
      dirty: pack.dirtyPaths().length,
    };
    this.open = { pack, journal };
    this.record = record;
    this.set('pending');
    return this.enqueue(async (store) => {
      if (base.kind === 'folder' || base.kind === 'reopen') record.fingerprint = await fingerprintOf(source);
      await store.delete(RECORD_KEY);
      await store.set(BASE_KEY, base);
      await store.set(RECORD_KEY, this.snapshot(record));
    });
  }

  /** Carries on with a session restored from `record` (its base stays as kept). */
  adopt(pack: Pack, journal: Journal, record: SessionRecord): Promise<void> {
    this.cancelTimer();
    this.open = { pack, journal };
    this.record = { ...record, overlay: [...record.overlay] };
    return this.flush();
  }

  /** The record with the open pack's journal as it stands. */
  private snapshot(record: SessionRecord): SessionRecord {
    if (this.open !== null && this.record === record) {
      record.journal = serializeJournal(this.open.journal.state());
      record.savePoint = this.open.journal.savePoint;
      record.dirty = this.open.pack.dirtyPaths().length;
      record.updated = this.now();
    }
    return { ...record, overlay: [...record.overlay] };
  }

  private cancelTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  /** The pack or its journal changed: the record is written a moment later. */
  changed(): void {
    if (this.store === null || this.record === null) return;
    this.cancelTimer();
    this.set('pending');
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.options.delay ?? KEEP_DELAY_MS);
  }

  /** Writes the record now (after any write under way). */
  flush(): Promise<void> {
    this.cancelTimer();
    const record = this.record;
    if (record === null) return this.queue;
    return this.enqueue((store) => store.set(RECORD_KEY, this.snapshot(record)));
  }

  /**
   * Before a save writes into the folder: keeps, for each source path the save writes or
   * deletes and the session has not kept yet, what is there now (`read` gives null for no
   * file), and writes the record before the save starts. A crash in the middle of the save
   * then still finds the pack as it was opened.
   */
  async beforeWrite(paths: readonly string[], read: (path: string) => Promise<Uint8Array | null>): Promise<void> {
    const record = this.record;
    if (record === null || this.store === null) return;
    const kept = new Set(record.overlay.map(([path]) => path));
    for (const path of paths) {
      if (kept.has(path)) continue;
      record.overlay.push([path, await read(path)]);
      kept.add(path);
    }
    await this.flush();
  }

  /** After a save into the folder (whole or not): its fingerprint as it is now, and the record written. */
  async saved(source: PackSource | null): Promise<void> {
    const record = this.record;
    if (record === null || this.store === null) return;
    if (source !== null) {
      try {
        record.fingerprint = await fingerprintOf(source);
      } catch (error) {
        this.set('error', error);
      }
    }
    await this.flush();
  }

  /** The source paths whose bytes the session kept before its saves wrote them, and those bytes. */
  overlay(): Map<string, Uint8Array | null> {
    return new Map(this.record?.overlay ?? []);
  }

  /** Forgets the session: the store is emptied, nothing is kept until the next pack opens. */
  discard(): Promise<void> {
    this.cancelTimer();
    this.open = null;
    this.record = null;
    return this.enqueue(async (store) => {
      await store.delete(RECORD_KEY);
      await store.delete(BASE_KEY);
    });
  }

  /** The fingerprint the session has of its base (folder, zip or folder to open again); null when none. */
  fingerprint(): Fingerprint | null {
    return this.record?.fingerprint ?? null;
  }
}
