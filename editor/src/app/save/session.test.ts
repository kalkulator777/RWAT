import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Command } from '../../core/contracts';
import { serializeJournal } from '../../core/journal';
import { MemorySource, readTree } from '../../core/pack/testing.node';
import { BASE_KEY, MemoryStore, RECORD_KEY, ZIP_KEEP_LIMIT, type SessionRecord } from '../../core/session';
import { buildZip, FsAccessSource, openZipSource, readAll } from '../../io';
import { FakeDirectory } from '../../io/testPack.node';
import { newPackSource } from '../../panels/newpack/model';
import { EXAMPLE_PACK } from '../../testing/repo.node';
import { openSource, savePack } from '../session';
import { dirtyCount, failure, journal, pack, revision, selection } from '../store';
import { baseFor, keeper, sessionSettled, useSessionStore } from './keep';
import { checkKeptSession, discardKept, postponeRestore, restoreAnyway, restoreKept } from './restore';
import { restoreState, saveReport } from './state';

const COACH = 'data/rwat_example/wagon_types/coach.json';
const files = readTree(EXAMPLE_PACK);
const decoder = new TextDecoder();
let store: MemoryStore;

// the example pack is opened, kept and zipped in these tests: a busy runner with coverage takes seconds
vi.setConfig({ testTimeout: 30_000 });

function close(): void {
  pack.value = null;
  journal.value = null;
  failure.value = null;
  saveReport.value = null;
  restoreState.value = null;
  selection.value = [];
  revision.value = 0;
}

/** The page is loaded again: the signals are empty, a new keeper reads the same store (`flush`: the page wrote its session as it went away). */
async function reload(flush = true): Promise<void> {
  if (flush) await keeper().flush();
  close();
  useSessionStore(store, { delay: 0 });
  await checkKeptSession();
}

beforeEach(() => {
  close();
  store = new MemoryStore();
  useSessionStore(store, { delay: 0 });
});
afterEach(close);

const mass = (value: number, file = COACH): Command => ({ label: 'edit', ops: [{ op: 'set', file, at: '/mass_t', value }] });
const massOf = (): unknown => (pack.value?.json(COACH) as { mass_t: unknown }).mass_t;

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 5));
  await sessionSettled();
}

async function exampleFolder(): Promise<{ folder: FakeDirectory; source: FsAccessSource }> {
  const folder = new FakeDirectory('RwatExamplePack');
  const source = new FsAccessSource(folder, true);
  await source.sink().write([...files].map(([path, bytes]) => ({ path, bytes })));
  return { folder, source };
}

describe('what a session keeps of a source', () => {
  it('keeps a folder’s handle, a zip, a new pack’s files, and only the name of a folder read through a file input', async () => {
    const { folder, source } = await exampleFolder();
    expect(await baseFor(source)).toEqual({ kind: 'folder', name: 'RwatExamplePack', handle: folder });
    const bytes = await buildZip([{ path: 'pack.mcmeta', bytes: new Uint8Array([123, 125]) }]);
    expect(await baseFor(await openZipSource(bytes, 'P.zip'))).toEqual({ kind: 'zip', name: 'P.zip', zip: bytes });
    expect(await baseFor(await openZipSource(bytes.buffer as ArrayBuffer, 'P.zip'))).toMatchObject({ kind: 'zip', zip: bytes });
    const big = { size: ZIP_KEEP_LIMIT + 1 } as Blob;
    const zipOfBlob = await openZipSource(new Blob([bytes.slice()]), 'Big.zip');
    Object.assign(zipOfBlob, { input: big });
    expect(await baseFor(zipOfBlob)).toEqual({ kind: 'reopen', name: 'Big.zip', what: 'zip' });
    expect(await baseFor(new MemorySource(files, 'Dir', 'dir-input'))).toEqual({ kind: 'reopen', name: 'Dir', what: 'folder' });
    expect(await baseFor(newPackSource({ name: 'New', namespace: 'ns', title: '', version: '', authors: '', license: '', description: '' }))).toMatchObject({
      kind: 'files',
      name: 'New',
      files: [['pack.mcmeta', expect.any(Uint8Array) as Uint8Array]],
    });
    expect(await baseFor(new MemorySource(files, 'Node', 'node'))).toBeNull();
    const huge = new MemorySource(new Map([['a.png', new Uint8Array(1)]]), 'Huge');
    huge.list = () => Promise.resolve([{ path: 'a.png', size: ZIP_KEEP_LIMIT + 1 }]);
    expect(await baseFor(huge)).toBeNull();
  });
});

describe('restoring a session', () => {
  it('brings back a zip’s edits after the page is reloaded, with undo and redo', async () => {
    const zip = await buildZip([...files].map(([path, bytes]) => ({ path, bytes })));
    await openSource(await openZipSource(zip, 'RwatExamplePack.zip'));
    await settle();
    expect(store.values.get(BASE_KEY)).toEqual({ kind: 'zip', name: 'RwatExamplePack.zip', zip });
    await journal.value?.run(mass(45));
    await journal.value?.run(mass(46));
    journal.value?.undo();
    await settle();

    await reload();
    expect(pack.value).toBeNull();
    expect(restoreState.value).toMatchObject({ step: 'offer', record: { name: 'RwatExamplePack.zip', dirty: 1 } });
    await restoreKept();
    expect(restoreState.value).toBeNull();
    expect(pack.value?.source.kind).toBe('zip');
    expect(massOf()).toBe(45);
    expect(dirtyCount.value).toBe(1);
    journal.value?.redo();
    expect(massOf()).toBe(46);
    journal.value?.undo();
    journal.value?.undo();
    expect(dirtyCount.value).toBe(0);
    // the restored session goes on being kept
    await journal.value?.run(mass(47));
    await settle();
    await reload();
    await restoreKept();
    expect(massOf()).toBe(47);
  });

  it('brings back a folder’s edits over what its saves wrote: unsaved stays unsaved, saved stays saved', async () => {
    const { folder } = await exampleFolder();
    await openSource(new FsAccessSource(folder, true));
    await journal.value?.run(mass(45));
    expect(await savePack()).toBe(true);
    await journal.value?.run(mass(46));
    await settle();
    expect((store.values.get(RECORD_KEY) as SessionRecord).overlay.map(([path]) => path)).toEqual([COACH]);

    await reload();
    expect(restoreState.value).toMatchObject({ step: 'offer', record: { base: 'folder', reopen: null } });
    folder.state = 'prompt'; // the browser asks again after a reload
    await restoreKept();
    expect(restoreState.value).toBeNull();
    expect(pack.value?.source.writable).toBe(true);
    expect(massOf()).toBe(46);
    expect(pack.value?.dirtyPaths()).toEqual([COACH]);
    journal.value?.undo(); // back to what was saved
    expect(dirtyCount.value).toBe(0);
    journal.value?.undo(); // past it: the folder holds 45
    expect(dirtyCount.value).toBe(1);
    journal.value?.redo();
    journal.value?.redo();
    expect(await savePack()).toBe(true);
    expect(decoder.decode(await new FsAccessSource(folder, true).read(COACH))).toContain('"mass_t": 46');
  });

  it('names the files that changed on disk since, and replays over them only when asked', async () => {
    const { folder, source } = await exampleFolder();
    await openSource(source);
    await journal.value?.run(mass(45));
    await settle();
    // someone edits the shunter while the tab is closed
    const shunter = 'data/rwat_example/wagon_types/shunter.json';
    await source.sink().write([{ path: shunter, bytes: new TextEncoder().encode('{"length": 1}\n') }]);

    await reload();
    await restoreKept();
    expect(restoreState.value).toMatchObject({ step: 'changed', changes: { changed: [shunter], added: [], removed: [] } });
    expect(pack.value).toBeNull();
    await restoreAnyway();
    expect(restoreState.value).toBeNull();
    expect(massOf()).toBe(45);
    expect(pack.value?.json(shunter)).toEqual({ length: 1 });
    // the files as they are now are the ones the session saw
    await reload();
    await restoreKept();
    expect(restoreState.value).toBeNull();
    expect(folder.name).toBe('RwatExamplePack');
  });

  it('restores a new pack from its kept files, and offers nothing when nothing was unsaved', async () => {
    await openSource(newPackSource({ name: 'New', namespace: 'ns', title: '', version: '', authors: '', license: '', description: '' }));
    await settle();
    await reload();
    expect(restoreState.value).toBeNull();
    await openSource(newPackSource({ name: 'New', namespace: 'ns', title: '', version: '', authors: '', license: '', description: '' }));
    await journal.value?.run({ label: 'name', ops: [{ op: 'set', file: 'pack.mcmeta', at: '/rwat/name', value: 'Mine' }] });
    await settle();
    await reload();
    await restoreKept();
    expect(pack.value?.source.name).toBe('New');
    expect((pack.value?.json('pack.mcmeta') as { rwat: { name: string } }).rwat.name).toBe('Mine');
    const delivered: Uint8Array[] = [];
    expect(await savePack((zip) => void delivered.push(zip))).toBe(true);
    expect(Object.keys(Object.fromEntries(await readAll(await openZipSource(delivered[0] as Uint8Array, 'x'))))).toEqual(['pack.mcmeta']);
  });

  it('offers to start afresh from a session of another editor version, and from one that fails to replay', async () => {
    await store.set(RECORD_KEY, { schema: 99 });
    await checkKeptSession();
    expect(restoreState.value).toEqual({ step: 'incompatible', reason: 'session schema 99, this editor keeps 1' });
    await discardKept();
    expect(store.values.size).toBe(0);
    expect(restoreState.value).toBeNull();

    await openSource(new MemorySource(files, 'P'));
    await journal.value?.run(mass(45));
    await settle();
    const record = store.values.get(RECORD_KEY) as SessionRecord;
    // a journal whose edit no longer fits the pack
    store.values.set(RECORD_KEY, { ...record, journal: serializeJournal({ committed: [], done: [{ label: 'x', ops: [{ op: 'remove', file: 'nothing.json', at: '/a' }] }], undone: [] }) });
    await reload(false);
    await restoreKept();
    expect(restoreState.value).toMatchObject({ step: 'failed', key: 'save.restore.failed' });
    postponeRestore();
    expect(restoreState.value).toBeNull();
    expect(store.values.has(RECORD_KEY)).toBe(true);

    // a record whose base is lost
    store.values.delete(BASE_KEY);
    await reload(false);
    await restoreKept();
    expect(restoreState.value).toMatchObject({ step: 'failed' });
  });

  it('says when the folder refuses even reading', async () => {
    const { folder, source } = await exampleFolder();
    await openSource(source);
    await journal.value?.run(mass(45));
    await settle();
    await reload();
    folder.state = 'prompt';
    folder.onRequest = 'denied';
    await restoreKept();
    expect(restoreState.value).toMatchObject({ step: 'failed', key: 'io.error.permission-denied' });
  });
});
