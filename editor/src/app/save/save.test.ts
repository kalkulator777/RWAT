import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Command } from '../../core/contracts';
import { putJson } from '../../core/pack';
import { filesOf, MemorySource, readTree } from '../../core/pack/testing.node';
import { MemoryStore, RECORD_KEY, type SessionRecord } from '../../core/session';
import { FsAccessSource, openZipSource, readAll } from '../../io';
import { FakeDirectory } from '../../io/testPack.node';
import { EXAMPLE_PACK } from '../../testing/repo.node';
import { openSource, savePack } from '../session';
import { dirtyCount, failure, journal, pack, revision, selection } from '../store';
import { listChanges } from './changes';
import { useSessionStore } from './keep';
import { saveTarget } from './save';
import { saveReport } from './state';

const COACH = 'data/rwat_example/wagon_types/coach.json';
const MCMETA = 'pack.mcmeta';
const files = readTree(EXAMPLE_PACK);
const decoder = new TextDecoder();
let store: MemoryStore;

// the example pack is opened, kept and zipped in these tests: a busy runner with coverage takes seconds
vi.setConfig({ testTimeout: 30_000 });

function reset(): void {
  pack.value = null;
  journal.value = null;
  failure.value = null;
  saveReport.value = null;
  selection.value = [];
  revision.value = 0;
}

beforeEach(() => {
  reset();
  store = new MemoryStore();
  useSessionStore(store, { delay: 0 });
});
afterEach(reset);

const edit = (at: string, value: unknown, file = COACH): Command => ({ label: 'edit', ops: [{ op: 'set', file, at, value }] });

async function run(command: Command): Promise<void> {
  await journal.value?.run(command);
}

/** A folder of File System Access holding the example pack, opened for writing. */
async function exampleFolder(): Promise<{ folder: FakeDirectory; source: FsAccessSource }> {
  const folder = new FakeDirectory('RwatExamplePack');
  const source = new FsAccessSource(folder, true);
  await source.sink().write([...files].map(([path, bytes]) => ({ path, bytes })));
  return { folder, source };
}

/** Saves a zip of the open pack and returns its bytes. */
async function zip(): Promise<Uint8Array> {
  const delivered: Uint8Array[] = [];
  expect(await savePack((bytes) => void delivered.push(bytes), 'zip')).toBe(true);
  return delivered[0] as Uint8Array;
}

/** The lines where two texts differ. */
function changedLines(before: string, after: string): number[] {
  const a = before.split('\n');
  const b = after.split('\n');
  return a.flatMap((line, i) => (line === b[i] ? [] : [i + 1]));
}

const same = (a: Uint8Array | undefined, b: Uint8Array | undefined): boolean => a !== undefined && b !== undefined && Buffer.from(a).equals(Buffer.from(b));

describe('the list of changes', () => {
  it('lists the new, changed and deleted files with the lines each gains and loses', async () => {
    await openSource(new MemorySource(files, 'RwatExamplePack'));
    expect(await listChanges(pack.value!)).toEqual([]);
    await run(edit('/mass_t', 45));
    await run({
      label: 'more',
      ops: [
        putJson('data/rwat_example/wagon_types/flat.json', { length: 12, bogies: [4, -4] }),
        { op: 'deleteFile', file: 'assets/rwat_example/stock/coach/salon_door.anim' },
        { op: 'putFile', file: 'assets/rwat_example/stock/coach/coach_body.png', bytes: new Uint8Array([1]) },
      ],
    });
    const list = await listChanges(pack.value!);
    expect(list.map((item) => [item.path, item.status, item.added, item.removed])).toEqual([
      ['assets/rwat_example/stock/coach/coach_body.png', 'changed', null, null],
      ['assets/rwat_example/stock/coach/salon_door.anim', 'deleted', 0, decoder.decode(files.get('assets/rwat_example/stock/coach/salon_door.anim')).trimEnd().split('\n').length],
      [COACH, 'changed', 1, 1],
      ['data/rwat_example/wagon_types/flat.json', 'new', 4, 0],
    ]);
  });
});

describe('saving into a folder', () => {
  it('writes only the changed files, the changed JSON with its one line edited, pack.mcmeta last, and deletes what was deleted', async () => {
    const { source } = await exampleFolder();
    await openSource(source);
    expect(saveTarget(pack.value!)).toBe('folder');
    await run(edit('/mass_t', 45));
    await run(edit('/rwat/name', 'Renamed', MCMETA));
    await run({ label: 'gone', ops: [{ op: 'deleteFile', file: 'README.md' }] });
    const steps: string[] = [];
    const sink = source.sink.bind(source);
    source.sink = (observe) =>
      sink((step) => {
        steps.push(`${step.action} ${step.path}`);
        observe?.(step);
      });
    expect(await savePack(() => Promise.reject(new Error('no zip')))).toBe(true);
    expect(steps).toEqual(['delete README.md', `write ${COACH}`, `write ${MCMETA}`]);
    expect(changedLines(decoder.decode(files.get(COACH)), decoder.decode(await source.read(COACH)))).toEqual([4]);
    expect(changedLines(decoder.decode(files.get(MCMETA)), decoder.decode(await source.read(MCMETA))).length).toBe(1);
    const after = await readAll(source);
    expect(after.size).toBe(files.size - 1);
    for (const [path, bytes] of files) if (![COACH, MCMETA, 'README.md'].includes(path)) expect(same(after.get(path), bytes), path).toBe(true);
    expect(dirtyCount.value).toBe(0);
    expect(journal.value?.atSavePoint).toBe(true);
  });

  it('says what a write that fails part way did, leaves the pack unsaved, and writes it all on the next try', async () => {
    const { folder, source } = await exampleFolder();
    await openSource(source);
    await run(edit('/mass_t', 45));
    await run(edit('/mass_t', 9, 'data/rwat_example/wagon_types/shunter.json'));
    await run(edit('/rwat/name', 'Renamed', MCMETA));
    // the shunter's file cannot be written: the disk is full
    const types = (await (await folder.getDirectoryHandle('data')).getDirectoryHandle('rwat_example')).getDirectoryHandle('wagon_types');
    const shunter = await (await types).getFileHandle('shunter.json');
    const write = shunter.createWritable.bind(shunter);
    let full = true;
    shunter.createWritable = async () => {
      const stream = await write();
      return { ...stream, write: (data: Uint8Array) => (full ? Promise.reject(Object.assign(new Error('disk full'), { name: 'QuotaExceededError' })) : stream.write(data)) };
    };
    expect(await savePack()).toBe(false);
    expect(saveReport.value).toEqual({
      written: [COACH],
      deleted: [],
      failed: 'data/rwat_example/wagon_types/shunter.json',
      pending: [MCMETA],
      detail: expect.stringContaining('disk full') as string,
    });
    expect(failure.value?.key).toBe('save.error.partial');
    expect(dirtyCount.value).toBe(3);
    expect(journal.value?.atSavePoint).toBe(false);
    expect(decoder.decode(await source.read(COACH))).toContain('"mass_t": 45.0');
    expect(same(await source.read(MCMETA), files.get(MCMETA))).toBe(true);
    // the session kept what the save replaced before it wrote anything
    const record = store.values.get(RECORD_KEY) as SessionRecord;
    expect(record.overlay.map(([path]) => path)).toEqual([COACH, 'data/rwat_example/wagon_types/shunter.json', MCMETA]);
    expect(same(record.overlay[0]?.[1] ?? undefined, files.get(COACH))).toBe(true);

    full = false;
    expect(await savePack()).toBe(true);
    expect(saveReport.value).toBeNull();
    expect(dirtyCount.value).toBe(0);
    expect(decoder.decode(await source.read('data/rwat_example/wagon_types/shunter.json'))).toContain('"mass_t": 9');
    expect(decoder.decode(await source.read(MCMETA))).toContain('Renamed');
  });

  it('asks for the permission again and says when it stays refused, blaming no file', async () => {
    const { folder, source } = await exampleFolder();
    await openSource(source);
    await run(edit('/mass_t', 45));
    folder.state = 'prompt';
    folder.onRequest = 'denied';
    expect(await savePack()).toBe(false);
    expect(failure.value?.key).toBe('io.error.permission-denied');
    expect(saveReport.value).toMatchObject({ written: [], failed: null, pending: [COACH] });
  });

  it('downloads a zip of a folder’s pack as a copy: the pack stays unsaved until written into the folder', async () => {
    const { source } = await exampleFolder();
    await openSource(source);
    await run(edit('/mass_t', 45));
    const copy = await openZipSource(await zip(), 'copy.zip');
    expect(decoder.decode(await copy.read(COACH))).toContain('"mass_t": 45.0');
    expect(dirtyCount.value).toBe(1);
    expect(journal.value?.atSavePoint).toBe(false);
  });
});

describe('saving as a zip', () => {
  it('writes the example pack back byte for byte, the same archive every time; one edit is one line of one file', async () => {
    await openSource(new MemorySource(files, 'RwatExamplePack'));
    const first = await zip();
    expect(Buffer.from(await zip()).equals(Buffer.from(first))).toBe(true);
    const saved = await readAll(await openZipSource(first, 'saved.zip'));
    expect([...saved.keys()]).toEqual([...files.keys()].sort());
    for (const [path, bytes] of files) expect(same(saved.get(path), bytes), path).toBe(true);

    await run(edit('/mass_t', 45));
    const edited = await readAll(await openZipSource(await zip(), 'edited.zip'));
    const differ = [...files].filter(([path, bytes]) => !same(edited.get(path), bytes)).map(([path]) => path);
    expect(differ).toEqual([COACH]);
    expect(changedLines(decoder.decode(files.get(COACH)), decoder.decode(edited.get(COACH)))).toEqual([4]);

    // a pack opened from the same files and edited the same way zips to the same bytes
    const again = await zip();
    reset();
    await openSource(new MemorySource(files, 'RwatExamplePack'));
    await run(edit('/mass_t', 45));
    expect(Buffer.from(await zip()).equals(Buffer.from(again))).toBe(true);
  });

  it('marks the save point: undo past it makes the pack changed again, redo saved again', async () => {
    await openSource(new MemorySource(filesOf({ [MCMETA]: '{"pack": {}}\n' }), 'P'));
    await run(edit('/a', 1, MCMETA));
    await run(edit('/b', 2, MCMETA));
    expect(dirtyCount.value).toBe(1);
    await zip();
    expect([dirtyCount.value, journal.value?.savePoint]).toEqual([0, 2]);
    journal.value?.undo();
    expect(dirtyCount.value).toBe(1);
    expect(journal.value?.atSavePoint).toBe(false);
    journal.value?.redo();
    expect(dirtyCount.value).toBe(0);
    expect(journal.value?.atSavePoint).toBe(true);
    journal.value?.undo();
    journal.value?.undo();
    expect(dirtyCount.value).toBe(1);
  });
});
