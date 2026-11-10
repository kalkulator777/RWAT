import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command } from '../contracts';
import { Journal } from '../journal/journal';
import { parseJournal, serializeJournal } from '../journal/serialize';
import { Pack, putJson } from '../pack/pack';
import { MemorySink, MemorySource, filesOf } from '../pack/testing.node';
import { compareFingerprints, fingerprintOf, isUnchanged, sha256 } from './fingerprint';
import { KEEP_DELAY_MS, SessionKeeper } from './keeper';
import { BASE_KEY, RECORD_KEY, SESSION_SCHEMA, readBase, readRecord, type SessionRecord } from './record';
import { replaySession } from './replay';
import { FilesSource, OverlaySource, homeOf } from './sources';
import { MemoryStore, indexedDbStore, type KeyValueStore } from './store';

const TYPE = 'data/ns/wagon_types/coach.json';
const FILES = {
  'pack.mcmeta': '{\n  "pack": {"pack_format": 34},\n  "rwat": {"format": 1}\n}\n',
  [TYPE]: '{\n  "length": 20.0,\n  "bogies": [7.0, -7.0],\n  "mass_t": 40\n}\n',
  'assets/ns/stock/body.png': new Uint8Array([137, 80, 78, 71]),
};
const decoder = new TextDecoder();
const set = (value: number): Command => ({ label: 'edit', ops: [{ op: 'set', file: TYPE, at: '/mass_t', value }] });
const massOf = (pack: Pack): unknown => (pack.json(TYPE) as { mass_t: unknown }).mass_t;

afterEach(() => {
  vi.useRealTimers();
});

describe('the fingerprint', () => {
  it('marks every file by its size and the JSON files by their SHA-256, and names what changed', async () => {
    const before = await fingerprintOf(new MemorySource(filesOf(FILES)));
    expect(before.files['assets/ns/stock/body.png']).toEqual({ size: 4 });
    expect(before.files[TYPE]?.sha256).toBe(await sha256(new TextEncoder().encode(FILES[TYPE])));
    expect(isUnchanged(compareFingerprints(before, before))).toBe(true);
    const after = await fingerprintOf(
      new MemorySource(filesOf({ ...FILES, [TYPE]: (FILES[TYPE]).replace('40', '41'), 'b.txt': 'x', 'assets/ns/stock/body.png': new Uint8Array([1, 2, 3, 4]) })),
    );
    // the PNG of the same size is not noticed: assets are compared by size alone
    expect(compareFingerprints(before, after)).toEqual({ added: ['b.txt'], removed: [], changed: [TYPE] });
    expect(compareFingerprints(after, before)).toEqual({ added: [], removed: ['b.txt'], changed: [TYPE] });
  });
});

describe('the record', () => {
  const record = (): SessionRecord => ({
    schema: SESSION_SCHEMA,
    name: 'P',
    base: 'zip',
    reopen: null,
    root: '',
    created: 1,
    updated: 2,
    fingerprint: null,
    overlay: [['a.json', null], ['b.json', new Uint8Array([1])]],
    journal: serializeJournal({ committed: [], done: [], undone: [] }),
    savePoint: 0,
    dirty: 0,
  });

  it('reads a record of this schema and says why another is not one', () => {
    expect(readRecord(record())).toEqual(record());
    expect(readRecord(null)).toEqual({ incompatible: 'not a session record' });
    expect(readRecord({ ...record(), schema: 2 })).toEqual({ incompatible: 'session schema 2, this editor keeps 1' });
    expect(readRecord({ ...record(), savePoint: -1 })).toEqual({ incompatible: '"savePoint" is not as this editor keeps it' });
    expect(readRecord({ ...record(), overlay: [['a', 'text']] })).toMatchObject({ incompatible: expect.stringContaining('overlay') as string });
    expect(readRecord({ ...record(), journal: '{"format": 9}' })).toMatchObject({ incompatible: expect.stringContaining('format') as string });
  });

  it('reads a base of the kind the record names', () => {
    expect(readBase({ kind: 'folder', name: 'P', handle: {} }, 'folder')).not.toBeNull();
    expect(readBase({ kind: 'folder', name: 'P', handle: null }, 'folder')).toBeNull();
    expect(readBase({ kind: 'zip', name: 'P', zip: new Uint8Array() }, 'zip')).not.toBeNull();
    expect(readBase({ kind: 'zip', name: 'P', zip: new Blob([]) }, 'zip')).not.toBeNull();
    expect(readBase({ kind: 'zip', name: 'P', zip: 'no' }, 'zip')).toBeNull();
    expect(readBase({ kind: 'files', name: 'P', files: [['a', new Uint8Array()]] }, 'files')).not.toBeNull();
    expect(readBase({ kind: 'files', name: 'P', files: [['a', 1]] }, 'files')).toBeNull();
    expect(readBase({ kind: 'reopen', name: 'P', what: 'zip' }, 'reopen')).not.toBeNull();
    expect(readBase({ kind: 'reopen', name: 'P', what: 'disk' }, 'reopen')).toBeNull();
    expect(readBase({ kind: 'zip', name: 'P', zip: new Uint8Array() }, 'files')).toBeNull();
    expect(readBase(undefined, 'zip')).toBeNull();
  });
});

describe('the sources of a restored session', () => {
  it('sees a folder as it was opened: kept bytes over the files a save wrote, no file where a save created one', async () => {
    const home = new MemorySource(filesOf({ 'pack.mcmeta': '{}', 'new.json': '{}', 'kept.json': '{"saved": 1}' }), 'Folder', 'fs-access', true);
    const overlay = new OverlaySource(
      home,
      new Map<string, Uint8Array | null>([
        ['new.json', null],
        ['kept.json', new TextEncoder().encode('{"opened": 1}')],
        ['gone.json', new TextEncoder().encode('{}')],
      ]),
    );
    expect([overlay.kind, overlay.name, overlay.writable]).toEqual(['fs-access', 'Folder', true]);
    expect((await overlay.list()).map((e) => e.path)).toEqual(['gone.json', 'kept.json', 'pack.mcmeta']);
    expect(decoder.decode(await overlay.read('kept.json'))).toBe('{"opened": 1}');
    expect(decoder.decode(await overlay.read('pack.mcmeta'))).toBe('{}');
    await expect(overlay.read('new.json')).rejects.toThrow('no file new.json');
    expect(homeOf(overlay)).toBe(home);
    expect(homeOf(home)).toBe(home);
  });

  it('holds kept files read-only', async () => {
    const source = new FilesSource('New', [['b', new Uint8Array([2])], ['a', new Uint8Array([1])]]);
    expect([source.kind, source.writable]).toEqual(['memory', false]);
    expect(await source.list()).toEqual([{ path: 'a', size: 1 }, { path: 'b', size: 1 }]);
    expect(await source.read('a')).toEqual(new Uint8Array([1]));
    await expect(source.read('c')).rejects.toThrow('no file c');
  });

  it('has no IndexedDB in Node, and a store in memory', async () => {
    expect(indexedDbStore()).toBeNull();
    const store = new MemoryStore();
    await store.set('a', 1);
    expect(await store.get('a')).toBe(1);
    await store.delete('a');
    expect(await store.get('a')).toBeUndefined();
  });
});

describe('the keeper', () => {
  async function opened(): Promise<{ pack: Pack; journal: Journal; source: MemorySource }> {
    const source = new MemorySource(filesOf(FILES), 'P');
    const pack = await Pack.open(source);
    return { pack, journal: new Journal(pack), source };
  }

  it('keeps the base and the record on open, the journal a moment after each change, and forgets it all on discard', async () => {
    vi.useFakeTimers();
    const store = new MemoryStore();
    const keeper = new SessionKeeper(store, { now: () => 1000 });
    const statuses: string[] = [];
    keeper.subscribe((status) => statuses.push(status));
    expect(await keeper.load()).toEqual({ kind: 'none' });
    const { pack, journal, source } = await opened();
    await keeper.begin(pack, journal, { kind: 'folder', name: 'P', handle: { fake: true } }, source);
    const kept = await keeper.load();
    expect(kept).toMatchObject({ kind: 'session', record: { name: 'P', base: 'folder', reopen: null, dirty: 0, savePoint: 0, created: 1000 } });
    expect(await keeper.loadBase((kept as { record: SessionRecord }).record)).toEqual({ kind: 'folder', name: 'P', handle: { fake: true } });
    expect(keeper.fingerprint()?.files[TYPE]).toBeDefined();

    journal.subscribe(() => keeper.changed());
    journal.dispatch(set(41));
    journal.dispatch(set(42));
    expect(keeper.status).toBe('pending');
    expect(parseJournal((store.values.get(RECORD_KEY) as SessionRecord).journal).done).toEqual([]);
    await vi.advanceTimersByTimeAsync(KEEP_DELAY_MS);
    await keeper.flush();
    const written = store.values.get(RECORD_KEY) as SessionRecord;
    expect(parseJournal(written.journal).done).toEqual([set(41), set(42)]);
    expect(written.dirty).toBe(1);
    expect(keeper.status).toBe('saved');
    expect(statuses).toContain('pending');

    await keeper.discard();
    expect(store.values.size).toBe(0);
    keeper.changed(); // nothing open: nothing to keep
    expect(keeper.status).toBe('saved');
  });

  it('keeps the bytes a save replaces once, before the save, and the folder’s new fingerprint after it', async () => {
    const store = new MemoryStore();
    const keeper = new SessionKeeper(store);
    const { pack, journal, source } = await opened();
    await keeper.beforeWrite(['x'], () => Promise.resolve(null)); // no session yet: nothing
    await keeper.begin(pack, journal, { kind: 'zip', name: 'P', zip: new Uint8Array([1]) }, source);
    expect(keeper.fingerprint()).toBeNull();
    const reads: string[] = [];
    const read = (path: string): Promise<Uint8Array | null> => {
      reads.push(path);
      return Promise.resolve(path === TYPE ? new Uint8Array([7]) : null);
    };
    await keeper.beforeWrite([TYPE, 'new.json'], read);
    await keeper.beforeWrite([TYPE, 'other.json'], read);
    expect(reads).toEqual([TYPE, 'new.json', 'other.json']);
    expect([...keeper.overlay()]).toEqual([[TYPE, new Uint8Array([7])], ['new.json', null], ['other.json', null]]);
    expect((store.values.get(RECORD_KEY) as SessionRecord).overlay).toHaveLength(3);
    await keeper.saved(source);
    expect(keeper.fingerprint()?.files['pack.mcmeta']).toBeDefined();
    const broken = new MemorySource(new Map());
    broken.list = () => Promise.reject(new Error('gone'));
    await keeper.saved(broken);
    expect(keeper.status).toBe('saved');
  });

  it('carries on with a restored record, and tells a store that fails without stopping', async () => {
    const failing: KeyValueStore = { get: () => Promise.resolve(undefined), set: () => Promise.reject(new Error('quota')), delete: () => Promise.resolve() };
    const keeper = new SessionKeeper(failing);
    const errors: unknown[] = [];
    keeper.subscribe((status, error) => {
      if (status === 'error') errors.push(error);
    });
    const { pack, journal, source } = await opened();
    await keeper.begin(pack, journal, { kind: 'files', name: 'P', files: [] }, source);
    expect(keeper.status).toBe('error');
    expect(errors).toEqual([new Error('quota')]);
    const store = new MemoryStore();
    const other = new SessionKeeper(store);
    const record = readRecord({ ...(keeper.session as SessionRecord) }) as SessionRecord;
    journal.dispatch(set(5));
    await other.adopt(pack, journal, record);
    expect((store.values.get(RECORD_KEY) as SessionRecord).dirty).toBe(1);
    expect(store.values.has(BASE_KEY)).toBe(false);
  });

  it('is off without a store, and says what it holds when the record is of another schema', async () => {
    const off = new SessionKeeper(null);
    expect(off.status).toBe('off');
    expect(await off.load()).toEqual({ kind: 'none' });
    expect(await off.loadBase({} as SessionRecord)).toBeNull();
    const { pack, journal, source } = await opened();
    await off.begin(pack, journal, { kind: 'files', name: 'P', files: [] }, source);
    await off.flush();
    await off.saved(source);
    expect(off.session).not.toBeNull(); // begin keeps the record in memory; nothing is written
    await off.discard();
    expect(off.session).toBeNull();
    expect(off.status).toBe('off');
    const store = new MemoryStore();
    await store.set(RECORD_KEY, { schema: 0 });
    expect(await new SessionKeeper(store).load()).toEqual({ kind: 'incompatible', reason: 'session schema 0, this editor keeps 1' });
  });
});

describe('replaying a session', () => {
  async function session(): Promise<{ pack: Pack; journal: Journal; source: MemorySource }> {
    const source = new MemorySource(filesOf(FILES), 'P');
    const pack = await Pack.open(source);
    return { pack, journal: new Journal(pack, { depth: 2 }), source };
  }

  it('brings back a copy’s edits, undo and redo, and what was saved: committed, done and undone alike', async () => {
    const { pack, journal, source } = await session();
    for (const value of [41, 42, 43]) journal.dispatch(set(value));
    await pack.save(new MemorySink());
    journal.markSaved();
    journal.dispatch(set(44));
    await journal.run({ label: 'new file', ops: [putJson('data/ns/wagon_types/flat.json', { length: 1 })] });
    journal.undo();
    const state = journal.state();
    expect([state.committed.length, state.done.length, state.undone.length]).toEqual([3, 1, 1]);

    const again = await replaySession(source, parseJournal(serializeJournal(state)), { savePoint: journal.savePoint, depth: 2 });
    expect(again.journal.state()).toEqual(state);
    expect([again.journal.savePoint, again.journal.position]).toEqual([3, 4]);
    expect(massOf(again.pack)).toBe(44);
    expect(again.pack.dirtyPaths()).toEqual([TYPE]);
    again.journal.undo();
    expect(again.pack.dirtyPaths()).toEqual([]);
    again.journal.redo();
    again.journal.redo();
    expect(again.pack.has('data/ns/wagon_types/flat.json')).toBe(true);
  });

  it('takes the pack as opened for saved at save point 0 or with none to reach', async () => {
    const { journal, source } = await session();
    journal.dispatch(set(41));
    for (const savePoint of [0, null, 99]) {
      const again = await replaySession(source, journal.state(), { savePoint });
      expect(again.pack.dirtyPaths()).toEqual([TYPE]);
    }
  });

  it('takes what a folder holds as saved for every file its saves wrote, whatever the save point', async () => {
    const { pack, journal } = await session();
    journal.dispatch(set(41));
    const folder = new MemorySink(new Map(filesOf(FILES)));
    await pack.save(folder);
    journal.markSaved();
    journal.dispatch(set(42));
    journal.undo();
    journal.undo();
    journal.dispatch(set(50)); // past the save point and on: it can no longer be reached
    expect(journal.savePoint).toBeNull();
    const home = new MemorySource(folder.files, 'P', 'fs-access', true);
    const before = new Map<string, Uint8Array | null>([[TYPE, filesOf(FILES).get(TYPE) as Uint8Array]]);
    const again = await replaySession(new OverlaySource(home, before), journal.state(), {
      savePoint: journal.savePoint,
      folder: { paths: [TYPE], read: (path) => home.read(path) },
    });
    expect(massOf(again.pack)).toBe(50);
    expect(again.pack.dirtyPaths()).toEqual([TYPE]);
    expect(decoder.decode(await again.pack.bytes(TYPE))).toContain('"mass_t": 50\n');
    again.journal.undo();
    // the pack as opened (40) differs from what the folder holds (41): still to be saved
    expect(again.pack.dirtyPaths()).toEqual([TYPE]);
    expect(decoder.decode(await again.pack.originalBytes(TYPE) as Uint8Array)).toContain('"mass_t": 41');
  });
});
