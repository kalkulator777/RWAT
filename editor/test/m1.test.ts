/**
 * The gate of M1 (docs/proposals/editor.md §7, "Готово, когда"), with the real modules
 * side by side: io/ (a folder of the disk through node-fs, a zip), the pack model, the
 * journal, the schema and the checks. The example pack (CC0) opens from a folder and
 * from a zip; an edit of one field and a save change that file and those lines only;
 * undo and saving return the original bytes; the example pack has no findings.
 *
 * It sits in test/, which the lint lets see io/ and core/ both (core/ may not see io/).
 */

import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkPack } from '../src/checks/pack';
import type { FileChange, PackSource } from '../src/core/contracts';
import { Journal } from '../src/core/journal';
import { Pack } from '../src/core/pack';
import { readTree } from '../src/core/pack/testing.node';
import { createSchema } from '../src/core/schema';
import { readSchemaFiles } from '../src/core/schema/files.node';
import { buildZip, openZipSource, readAll, ZipSink } from '../src/io';
import { NodeFsSource } from '../src/io/nodeFs.node';
import { EXAMPLE_PACK } from '../src/testing/repo.node';

const COACH = 'data/rwat_example/wagon_types/coach.json';
const decoder = new TextDecoder();
const schema = createSchema(readSchemaFiles());
const original = readTree(EXAMPLE_PACK);

let scratch: string;

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'rwat-m1-'));
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

/** A fresh copy of the example pack on the disk, so a save never touches the repository. */
async function folderCopy(name: string): Promise<string> {
  const folder = join(scratch, name);
  await cp(EXAMPLE_PACK, folder, { recursive: true });
  return folder;
}

async function zipOfExample(): Promise<PackSource> {
  const bytes = await buildZip([...original].map(([path, data]) => ({ path, bytes: data })));
  return openZipSource(bytes, 'RwatExamplePack.zip');
}

function same(a: Uint8Array | undefined, b: Uint8Array | undefined): boolean {
  return a !== undefined && b !== undefined && Buffer.from(a).equals(Buffer.from(b));
}

/** The lines (1-based) that differ between two texts of the same number of lines. */
function changedLines(before: string, after: string): number[] {
  const a = before.split('\n');
  const b = after.split('\n');
  expect(b.length).toBe(a.length);
  return a.flatMap((line, i) => (line === b[i] ? [] : [i + 1]));
}

/** The paths whose bytes differ between the example pack and `files`, and the paths one has and the other lacks. */
function differences(files: Map<string, Uint8Array>): string[] {
  const paths = new Set([...original.keys(), ...files.keys()]);
  return [...paths].filter((path) => !same(original.get(path), files.get(path))).sort();
}

const edit = { label: 'edit.field', ops: [{ op: 'set' as const, file: COACH, at: '/mass_t', value: 45 }] };

describe('M1 gate: the example pack through io, the model, the journal and the schema', () => {
  it('opens from a folder (node-fs) and from a zip as the same pack, with no findings', async () => {
    const folder = await Pack.open(new NodeFsSource(EXAMPLE_PACK));
    const zip = await Pack.open(await zipOfExample());
    expect(folder.source.kind).toBe('node');
    expect(zip.source.kind).toBe('zip');
    expect(folder.paths()).toEqual([...original.keys()].sort());
    expect(zip.paths()).toEqual(folder.paths());
    expect(zip.stock()).toEqual(folder.stock());
    expect(zip.json(COACH)).toEqual(folder.json(COACH));
    expect(checkPack(folder, schema)).toEqual([]);
    expect(checkPack(zip, schema)).toEqual([]);
    expect(folder.dirtyPaths()).toEqual([]);
  });

  it('saves an edit of one field into the folder as that file and those lines only', async () => {
    const folder = await folderCopy('edit-one-field');
    const source = new NodeFsSource(folder);
    const pack = await Pack.open(source);
    const journal = new Journal(pack);
    journal.dispatch(edit);

    const written = await pack.save(source.sink());
    expect(written.map((change: FileChange) => change.path)).toEqual([COACH]);
    const onDisk = await readAll(new NodeFsSource(folder));
    expect(differences(onDisk)).toEqual([COACH]);
    expect(changedLines(decoder.decode(original.get(COACH)), decoder.decode(onDisk.get(COACH)))).toEqual([4]);
    expect(decoder.decode(onDisk.get(COACH)).split('\n')[3]).toBe('  "mass_t": 45.0,');
  });

  it('writes the original bytes back after an undo and a save, and writes nothing for an undone unsaved edit', async () => {
    const folder = await folderCopy('undo-and-save');
    const source = new NodeFsSource(folder);
    const pack = await Pack.open(source);
    const journal = new Journal(pack);

    journal.dispatch(edit);
    journal.undo();
    expect(pack.dirtyPaths()).toEqual([]);
    expect(await pack.changes()).toEqual([]);

    journal.redo();
    await pack.save(source.sink());
    expect(differences(await readAll(source))).toEqual([COACH]);
    journal.undo();
    const written = await pack.save(source.sink());
    expect(written.map((change) => change.path)).toEqual([COACH]);
    expect(differences(await readAll(source))).toEqual([]);
  });

  it('saves a zip of the whole pack in which only the edited file differs, and the original bytes after an undo', async () => {
    const pack = await Pack.open(await zipOfExample());
    const journal = new Journal(pack);
    const saved: Uint8Array[] = [];
    const sink = new ZipSink(null, (zip) => void saved.push(zip));

    journal.dispatch(edit);
    await pack.save(sink, { whole: true });
    const edited = await readAll(await openZipSource(saved[0] as Uint8Array, 'saved.zip'));
    expect(differences(edited)).toEqual([COACH]);
    expect(changedLines(decoder.decode(original.get(COACH)), decoder.decode(edited.get(COACH)))).toEqual([4]);

    journal.undo();
    await pack.save(sink, { whole: true });
    expect(differences(await readAll(await openZipSource(saved[1] as Uint8Array, 'saved.zip')))).toEqual([]);
  });

  it('finds the edit that breaks the schema and no longer finds it once undone', async () => {
    const pack = await Pack.open(new NodeFsSource(EXAMPLE_PACK));
    const journal = new Journal(pack);
    journal.dispatch({ label: 'edit.field', ops: [{ op: 'set', file: COACH, at: '/mass_t', value: 'heavy' }] });
    const found = checkPack(pack, schema);
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]?.at).toEqual([{ kind: 'field', file: COACH, at: '/mass_t' }]);
    journal.undo();
    expect(checkPack(pack, schema)).toEqual([]);
  });
});
