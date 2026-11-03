import { describe, expect, it } from 'vitest';
import type { Op } from '../contracts';
import { Journal } from '../journal/journal';
import { parseJson } from '../json/parse';
import { Pack, PackError, putJson } from './pack';
import { EXAMPLE_PACK, MemorySink, MemorySource, filesOf, readTree } from './testing.node';

const COACH_TYPE = 'data/rwat_example/wagon_types/coach.json';
const COACH_OBJ = 'assets/rwat_example/stock/coach/coach.obj';
const BODY_PNG = 'assets/rwat_example/stock/coach/coach_body.png';
const decoder = new TextDecoder();

async function openExample(): Promise<{ pack: Pack; source: MemorySource; files: Map<string, Uint8Array> }> {
  const files = readTree(EXAMPLE_PACK);
  const source = new MemorySource(files, 'RwatExamplePack');
  return { pack: await Pack.open(source), source, files };
}

/** The same bytes (vitest's deep equality is slow on a big array). */
function same(a: Uint8Array | undefined, b: Uint8Array): boolean {
  return a !== undefined && Buffer.from(a).equals(Buffer.from(b));
}

/** The lines where two texts differ, by line number. */
function changedLines(before: string, after: string): number[] {
  const a = before.split('\n');
  const b = after.split('\n');
  expect(b.length).toBe(a.length);
  return a.flatMap((line, i) => (line === b[i] ? [] : [i + 1]));
}

function code(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof PackError) return error.code;
    throw error;
  }
  return undefined;
}

describe('the pack model on the example pack', () => {
  it('opens it: every file indexed, only the JSON read', async () => {
    const { pack, source, files } = await openExample();
    expect(pack.paths()).toEqual([...files.keys()].sort());
    expect(pack.root).toBe('');
    expect(pack.generated).toBe(false);
    expect(pack.readOnly).toBe(false);
    expect(pack.problems()).toEqual([]);
    expect(source.reads.every((path) => path.endsWith('.json') || path.endsWith('.mcmeta'))).toBe(true);
    expect(source.reads.length).toBe([...files.keys()].filter((path) => /\.(json|mcmeta)$/.test(path)).length);
    expect(pack.isLoaded(COACH_OBJ)).toBe(false);
    expect(pack.json(COACH_OBJ)).toBeUndefined();
    expect((await pack.text(COACH_OBJ)).startsWith('# ')).toBe(true);
    expect(source.reads).toContain(COACH_OBJ);
    expect(pack.isLoaded(COACH_OBJ)).toBe(true);
    expect(await pack.bytes(BODY_PNG)).toEqual(files.get(BODY_PNG));
    expect((pack.json(COACH_TYPE) as { mass_t: number }).mass_t).toBe(42);
    expect(pack.kind(COACH_TYPE)).toBe('json');
    expect(pack.jsonError(COACH_TYPE)).toBeNull();
  });

  it('pairs types and models by id, lists the rail styles, the languages and the names', async () => {
    const { pack } = await openExample();
    expect(pack.stock()).toEqual(
      ['coach', 'gondola', 'shunter'].map((name) => ({
        id: `rwat_example:${name}`,
        type: `data/rwat_example/wagon_types/${name}.json`,
        model: `assets/rwat_example/wagon_models/${name}.json`,
      })),
    );
    expect(pack.railStyles()).toEqual([{ id: 'rwat_example:wooden_track', file: 'assets/rwat_example/rail_models/wooden_track.json' }]);
    expect(pack.langs()).toEqual(['en_us', 'ru_ru']);
    const ru = pack.names('ru_ru');
    expect(ru.get('wagon.rwat_example.coach')).toEqual({ value: 'Пассажирский вагон (пример)', file: 'assets/rwat_example/lang/ru_ru.json' });
    expect(ru.get('light.rwat_example.shunter.FHL')?.value).toBe('Прожектор передний');
    expect(pack.names('de_de').size).toBe(0);
    expect(pack.meta()).toMatchObject({ rwat: { format: 1, name: 'RWAT Example Pack' }, format: 1, formatAssumed: false, supported: true });
    expect(pack.meta().pack).toMatchObject({ pack_format: 34 });
    expect(pack.declarations().length).toBe(9);
  });

  it('saves an edit of one field as that line of that file only, and an undone edit as nothing', async () => {
    const { pack, files } = await openExample();
    const journal = new Journal(pack);
    const original = decoder.decode(files.get(COACH_TYPE));
    journal.dispatch({ label: 'edit.field', ops: [{ op: 'set', file: COACH_TYPE, at: '/mass_t', value: 45 }] });
    expect(pack.dirtyPaths()).toEqual([COACH_TYPE]);
    expect(pack.status(COACH_TYPE)).toBe('changed');
    const changes = await pack.changes();
    expect(changes.map((change) => change.path)).toEqual([COACH_TYPE]);
    const edited = decoder.decode((changes[0] as { bytes: Uint8Array }).bytes);
    expect(changedLines(original, edited)).toEqual([4]);
    expect(edited.split('\n')[3]).toBe('  "mass_t": 45.0,');

    journal.undo();
    expect(pack.dirtyPaths()).toEqual([]);
    expect(await pack.changes()).toEqual([]);
    expect(await pack.bytes(COACH_TYPE)).toEqual(files.get(COACH_TYPE));

    journal.redo();
    const sink = new MemorySink(new Map(files));
    const written = await pack.save(sink);
    expect(written.map((change) => change.path)).toEqual([COACH_TYPE]);
    expect(changedLines(original, decoder.decode(sink.files.get(COACH_TYPE)))).toEqual([4]);
    for (const [path, bytes] of files) if (path !== COACH_TYPE) expect(same(sink.files.get(path), bytes), path).toBe(true);
    expect(pack.dirtyPaths()).toEqual([]);

    journal.undo();
    expect(pack.dirtyPaths()).toEqual([COACH_TYPE]);
    expect(await pack.bytes(COACH_TYPE)).toEqual(files.get(COACH_TYPE));
  });

  it('puts a member an undone edit removed back where it stood: the value’s order and the file’s text as they were', async () => {
    const { pack, files } = await openExample();
    const journal = new Journal(pack);
    const json = [...files.keys()].filter((path) => pack.kind(path) === 'json' && pack.jsonError(path) === null);
    let members = 0;
    for (const file of json) {
      const walk = (value: unknown, at: string): void => {
        if (Array.isArray(value)) value.forEach((item, i) => walk(item, `${at}/${i}`));
        if (value === null || typeof value !== 'object' || Array.isArray(value)) return;
        for (const key of Object.keys(value)) {
          const place = `${at}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
          journal.dispatch({ label: 'x', ops: [{ op: 'remove', file, at: place }] });
          journal.undo();
          expect(JSON.stringify(pack.json(file)), `${file} ${place}`).toBe(JSON.stringify(parseJson(decoder.decode(files.get(file)))));
          members++;
          walk((value as Record<string, unknown>)[key], place);
        }
      };
      walk(pack.json(file), '');
    }
    expect(members).toBeGreaterThan(150);

    // saved without a member, then undone: the file's text comes back byte for byte
    journal.dispatch({ label: 'x', ops: [{ op: 'remove', file: COACH_TYPE, at: '/max_speed_kmh' }] });
    await pack.save(new MemorySink(new Map(files)));
    journal.undo();
    expect(await pack.text(COACH_TYPE)).toBe(decoder.decode(files.get(COACH_TYPE)));

    // a door made in the editor, a flag of it turned off and the edit undone: its text as before the edit
    const door = { id: 'hatch', min: [0, 1.15, 1.45], max: [1, 3.3, 1.51] };
    journal.dispatch({ label: 'x', ops: [{ op: 'insert', file: COACH_TYPE, at: '/doors/-', value: door }] });
    journal.dispatch({ label: 'x', ops: [{ op: 'set', file: COACH_TYPE, at: '/doors/8/inner', value: true }] });
    journal.dispatch({ label: 'x', ops: [{ op: 'set', file: COACH_TYPE, at: '/doors/8/group', value: 'Hatches' }] });
    const before = await pack.text(COACH_TYPE);
    journal.dispatch({ label: 'x', ops: [{ op: 'remove', file: COACH_TYPE, at: '/doors/8/inner' }] });
    expect(await pack.text(COACH_TYPE)).not.toBe(before);
    journal.undo();
    expect(await pack.text(COACH_TYPE)).toBe(before);
  });

  it('writes the whole pack, and a new JSON file as dump writes it', async () => {
    const { pack, files } = await openExample();
    const journal = new Journal(pack);
    journal.dispatch({ label: 'new.type', ops: [putJson('data/rwat_example/wagon_types/flat.json', { length: 12, bogies: [4, -4] })] });
    expect(pack.status('data/rwat_example/wagon_types/flat.json')).toBe('new');
    expect(await pack.text('data/rwat_example/wagon_types/flat.json')).toBe('{\n  "length": 12,\n  "bogies": [4, -4]\n}\n');
    expect(pack.stock().find((entry) => entry.id === 'rwat_example:flat')).toEqual({ id: 'rwat_example:flat', type: 'data/rwat_example/wagon_types/flat.json', model: null });
    const sink = new MemorySink();
    const written = await pack.save(sink, { whole: true });
    expect(written.length).toBe(files.size + 1);
    for (const [path, bytes] of files) expect(same(sink.files.get(path), bytes), path).toBe(true);
    expect((await pack.snapshot()).length).toBe(files.size + 1);
  });
});

describe('the pack model, case by case', () => {
  const mcmeta = (rwat?: unknown): string => JSON.stringify(rwat === undefined ? { pack: { pack_format: 34 } } : { pack: { pack_format: 34 }, rwat });

  it('reads the rwat block and its format as the engine does', async () => {
    const meta = async (rwat?: unknown) => (await Pack.open(new MemorySource(filesOf({ 'pack.mcmeta': mcmeta(rwat) })))).meta();
    expect(await meta()).toEqual({ pack: { pack_format: 34 }, rwat: null, format: 1, formatAssumed: true, supported: true });
    expect(await meta({ name: 'x' })).toMatchObject({ format: 1, formatAssumed: true, supported: true });
    expect(await meta({ format: 2 })).toMatchObject({ format: 2, formatAssumed: false, supported: false });
    expect(await meta({ format: 1.5 })).toMatchObject({ format: null, supported: false });
    expect(await meta({ format: '1' })).toMatchObject({ format: null, supported: false });
    expect(await meta('rwat')).toMatchObject({ rwat: null, format: null, supported: false });
    const broken = await Pack.open(new MemorySource(filesOf({ 'pack.mcmeta': '{' })));
    expect(broken.meta()).toMatchObject({ pack: undefined, rwat: null, formatAssumed: true });
  });

  it('opens a generated pack for viewing only', async () => {
    const pack = await Pack.open(new MemorySource(filesOf({ 'pack.mcmeta': mcmeta({ format: 1 }), 'RWAT_CONVERSION.txt': 'converted', 'data/mvp/wagon_types/a.json': '{}' })));
    expect(pack.generated).toBe(true);
    expect(pack.readOnly).toBe(true);
    expect(code(() => pack.apply({ op: 'set', file: 'data/mvp/wagon_types/a.json', at: '/mass_t', value: 1 }))).toBe('read-only');
    expect(code(() => pack.apply({ op: 'deleteFile', file: 'pack.mcmeta' }))).toBe('read-only');
  });

  it('opens a pack zipped in its folder from there, with a warning, and writes back into the folder', async () => {
    const source = new MemorySource(filesOf({ 'MyPack/pack.mcmeta': mcmeta({ format: 1 }), 'MyPack/assets/ns/lang/en_us.json': '{"wagon.ns.a": "A"}', '__MACOSX/x': 'junk' }), 'MyPack.zip', 'zip');
    const pack = await Pack.open(source);
    expect(pack.root).toBe('MyPack/');
    expect(pack.paths()).toEqual(['assets/ns/lang/en_us.json', 'pack.mcmeta']);
    expect(pack.problems()).toEqual([
      expect.objectContaining({ severity: 'warning', source: 'loader', code: 'pack.in-folder', params: { folder: 'MyPack' }, at: [{ kind: 'file', file: 'pack.mcmeta' }] }),
    ]);
    expect(pack.names('en_us').get('wagon.ns.a')?.value).toBe('A');
    pack.apply({ op: 'set', file: 'assets/ns/lang/en_us.json', at: '/wagon.ns.b', value: 'B' });
    expect((await pack.changes()).map((change) => change.path)).toEqual(['assets/ns/lang/en_us.json']);
    expect((await pack.changes({ inSource: true })).map((change) => change.path)).toEqual(['MyPack/assets/ns/lang/en_us.json']);
    const sink = new MemorySink();
    await pack.save(sink, { inSource: true });
    expect([...sink.files.keys()]).toEqual(['MyPack/assets/ns/lang/en_us.json']);
  });

  it('refuses to open what is no pack, or several', async () => {
    await expect(Pack.open(new MemorySource(filesOf({ 'assets/a.png': 'x' }), 'loose.zip'))).rejects.toMatchObject({ code: 'not-a-pack' });
    await expect(Pack.open(new MemorySource(filesOf({ 'A/pack.mcmeta': '{}', 'B/pack.mcmeta': '{}' })))).rejects.toMatchObject({ code: 'several-packs', message: expect.stringContaining('A/, B/') as unknown });
  });

  it('says which JSON files are not JSON, and edits them only by putting the file again', async () => {
    const pack = await Pack.open(new MemorySource(filesOf({ 'pack.mcmeta': mcmeta(), 'assets/ns/wagon_models/a.json': '{"obj": "a.obj",, }' })));
    const file = 'assets/ns/wagon_models/a.json';
    expect(pack.json(file)).toBeUndefined();
    expect(pack.jsonError(file)?.code).toBe('PropertyNameExpected');
    expect(pack.problems()).toEqual([expect.objectContaining({ severity: 'error', code: 'pack.broken-json', params: { error: 'PropertyNameExpected', offset: 16 }, at: [{ kind: 'file', file }] })]);
    expect(code(() => pack.apply({ op: 'set', file, at: '/obj', value: 'b.obj' }))).toBe('broken-json');
    const journal = new Journal(pack);
    await journal.run({ label: 'fix', ops: [putJson(file, { obj: 'a.obj' })] });
    expect(pack.problems()).toEqual([]);
    expect(pack.json(file)).toEqual({ obj: 'a.obj' });
    journal.undo();
    expect(pack.jsonError(file)).not.toBeNull();
    expect(pack.dirtyPaths()).toEqual([]);
  });

  it('refuses ops it cannot apply, changing nothing', async () => {
    const pack = await Pack.open(new MemorySource(filesOf({ 'pack.mcmeta': mcmeta({ format: 1 }), 'a.png': new Uint8Array([1, 2]), 'b.txt': 'b' })));
    const before = pack.version;
    const cases: [Op, string][] = [
      [{ op: 'set', file: 'missing.json', at: '/a', value: 1 }, 'no-file'],
      [{ op: 'set', file: 'b.txt', at: '/a', value: 1 }, 'not-json'],
      [{ op: 'set', file: 'pack.mcmeta', at: 'rwat', value: 1 }, 'bad-target'],
      [{ op: 'set', file: 'pack.mcmeta', at: '/nothing/here', value: 1 }, 'bad-target'],
      [{ op: 'remove', file: 'pack.mcmeta', at: '/nothing' }, 'bad-target'],
      [{ op: 'insert', file: 'pack.mcmeta', at: '/rwat/0', value: 1 }, 'bad-target'],
      [{ op: 'set', file: 'pack.mcmeta', at: '/x', value: Number.NaN }, 'bad-value'],
      [{ op: 'set', file: 'pack.mcmeta', at: '/x', value: undefined }, 'bad-value'],
      [{ op: 'set', file: 'pack.mcmeta', at: '/x', value: [new Date(0)] }, 'bad-value'],
      [{ op: 'renameFile', file: 'a.png', to: 'b.txt' }, 'file-exists'],
      [{ op: 'renameFile', file: 'a.png', to: 'a.json' }, 'kind-change'],
      [{ op: 'deleteFile', file: 'a.png' }, 'not-loaded'],
      [{ op: 'putFile', file: 'b.txt', bytes: new Uint8Array() }, 'not-loaded'],
      [{ op: 'deleteFile', file: 'gone' }, 'no-file'],
      [{ op: 'putFile', file: '../evil.json', bytes: new Uint8Array() }, 'bad-path'],
      [{ op: 'putFile', file: '/abs.json', bytes: new Uint8Array() }, 'bad-path'],
      [{ op: 'putFile', file: 'a//b.json', bytes: new Uint8Array() }, 'bad-path'],
      [{ op: 'renameFile', file: 'b.txt', to: 'x/../y.txt' }, 'bad-path'],
      [{ op: 'renameFile', file: 'b.txt', to: 'C:/y.txt' }, 'bad-path'],
    ];
    for (const [op, expected] of cases) expect(code(() => pack.apply(op)), JSON.stringify(op)).toBe(expected);
    expect(pack.version).toBe(before);
    expect(() => pack.status('gone')).toThrow(PackError);
  });

  it('copies the values it is given and keeps __proto__ a member', async () => {
    const pack = await Pack.open(new MemorySource(filesOf({ 'pack.mcmeta': mcmeta({ format: 1 }) })));
    const value = { list: [1, 2] };
    pack.apply({ op: 'set', file: 'pack.mcmeta', at: '/extra', value });
    value.list.push(3);
    expect((pack.json('pack.mcmeta') as { extra: unknown }).extra).toEqual({ list: [1, 2] });
    pack.apply({ op: 'set', file: 'pack.mcmeta', at: '/extra', value: JSON.parse('{"__proto__": {"x": 1}}') as unknown });
    const extra = (pack.json('pack.mcmeta') as { extra: object }).extra;
    expect(Object.keys(extra)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(extra)).toBe(Object.prototype);
    const nullProto = Object.create(null) as Record<string, unknown>;
    nullProto.a = 1;
    pack.apply({ op: 'set', file: 'pack.mcmeta', at: '/extra', value: nullProto });
    expect(parseJson(await pack.text('pack.mcmeta'))).toMatchObject({ extra: { a: 1 } });
  });

  it('tells new, changed, deleted and renamed files; a rename undone is nothing', async () => {
    const pack = await Pack.open(new MemorySource(filesOf({ 'pack.mcmeta': mcmeta({ format: 1 }), 'a.png': new Uint8Array([1, 2]), 'c.png': new Uint8Array([3]) })));
    const journal = new Journal(pack);
    journal.dispatch({ label: 'rename', ops: [{ op: 'renameFile', file: 'a.png', to: 'b.png' }] });
    expect(pack.paths()).toEqual(['b.png', 'c.png', 'pack.mcmeta']);
    expect(pack.has('a.png')).toBe(false);
    expect(pack.status('a.png')).toBe('deleted');
    expect(pack.status('b.png')).toBe('new');
    expect(pack.isLoaded('b.png')).toBe(false);
    expect(await pack.changes()).toEqual([
      { path: 'a.png', delete: true },
      { path: 'b.png', bytes: new Uint8Array([1, 2]) },
    ]);
    journal.undo();
    expect(pack.dirtyPaths()).toEqual([]);
    await journal.run({ label: 'replace', ops: [{ op: 'putFile', file: 'c.png', bytes: new Uint8Array([4]) }] });
    expect(pack.status('c.png')).toBe('changed');
    await journal.run({ label: 'same', ops: [{ op: 'putFile', file: 'c.png', bytes: new Uint8Array([3]) }] });
    expect(pack.status('c.png')).toBe('unchanged');
    await journal.run({ label: 'swap', ops: [{ op: 'renameFile', file: 'a.png', to: 'd.png' }, { op: 'deleteFile', file: 'd.png' }] });
    expect(pack.paths()).toEqual(['c.png', 'pack.mcmeta']);
    journal.undo();
    expect(await pack.bytes('a.png')).toEqual(new Uint8Array([1, 2]));
    expect(pack.has('d.png')).toBe(false);
    await pack.load(['a.png', 'nothing']);
  });
});
