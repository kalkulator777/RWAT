/**
 * The recipe's files: what opening reads, saving byte for byte, and the MVP recipe of the
 * repository: open, one edit → one line of one file; no edit → every file as it was.
 */

import { describe, expect, it } from 'vitest';
import { MemorySink, MemorySource } from '../../core/pack/testing.node';
import { setField } from './fields';
import { setDoorField } from './doors';
import { setFloorOption } from './floor';
import { mvpFiles, openFiles, openRecipe, RECIPE } from './testing.node';
import { joinPath, RecipeError, RecipeWorkspace } from './workspace';

const decoder = new TextDecoder();

function recipe(extra: object = {}): object {
  return { namespace: 'ns', pack_dir: 'P', sources: [{ zip: '../ir.zip', root: 'stock' }], overrides_dir: 'r', ...extra };
}

/** The lines where two texts differ. */
function changedLines(before: string, after: string): string[] {
  const a = before.split('\n');
  const b = after.split('\n');
  expect(b.length).toBe(a.length);
  return b.filter((line, i) => line !== a[i]);
}

describe('opening a recipe', () => {
  it('reads the recipe and the *.json right inside its overrides_dir, nothing else', async () => {
    const o = await openRecipe({
      [RECIPE]: recipe(),
      'packs/r/a.json': { sway: 1 },
      'packs/r/b.json': { sway: 2 },
      'packs/r/geometry/a.json': { _about: 'tools/ir2rwat.py --geometry' },
      'packs/r/notes.txt': 'no',
      'packs/r/.json': {},
      'packs/other.json': {},
      'pack.mcmeta': '{"pack": {}}',
    });
    expect(o.workspace.paths()).toEqual([RECIPE, 'packs/r/a.json', 'packs/r/b.json']);
    expect(o.workspace.overrideIds()).toEqual(['a', 'b']);
    expect(o.workspace.overridesDir).toBe('packs/r');
    expect(o.workspace.has('pack.mcmeta')).toBe(false);
    expect(o.workspace.json('pack.mcmeta')).toBeUndefined();
    expect(() => o.workspace.apply({ op: 'set', file: 'pack.mcmeta', at: '/x', value: 1 })).toThrow(RecipeError);
    expect(o.source.reads.sort()).toEqual([RECIPE, RECIPE, 'packs/r/a.json', 'packs/r/b.json'].sort());
  });

  it('finds overrides_dir from the recipe’s folder, and refuses what is no recipe', async () => {
    expect(joinPath('packs', 'mvp')).toBe('packs/mvp');
    expect(joinPath('packs', '../per/./x')).toBe('per/x');
    expect(joinPath('', '../x')).toBeNull();
    expect(joinPath('a', '/abs')).toBeNull();
    const o = await openRecipe({ 'r.json': recipe({ overrides_dir: '.' }) }, 'r.json');
    expect(o.workspace.overridesDir).toBeNull();
    expect(o.workspace.overrideIds()).toEqual([]);
    const source = new MemorySource(new Map());
    await expect(RecipeWorkspace.open(source, 'packs/none.json')).rejects.toMatchObject({ code: 'no-recipe' });
    await expect(RecipeWorkspace.open(source, '../r.json')).rejects.toMatchObject({ code: 'bad-path' });
    await expect(RecipeWorkspace.open(source, 'pack.mcmeta')).rejects.toMatchObject({ code: 'bad-path' });
  });

  it('opens a recipe whose text is no JSON, with its problem', async () => {
    const o = await openRecipe({ [RECIPE]: '{"name": ' });
    expect(o.workspace.recipe()).toEqual({});
    expect(o.workspace.problems().map((p) => p.code)).toEqual(['pack.broken-json']);
  });

  it('saves only what changed, as its own text minimally edited, and then nothing more', async () => {
    const o = await openRecipe({ [RECIPE]: recipe(), 'packs/r/a.json': '{"type": {"mass_t": 40.0, "length": 20.0}}\n' });
    await o.run(setField(o.workspace, 'a', '/type/mass_t', 41.0));
    expect(o.workspace.dirtyPaths()).toEqual(['packs/r/a.json']);
    const sink = new MemorySink();
    const written = await o.workspace.save(sink);
    expect(written.map((change) => change.path)).toEqual(['packs/r/a.json']);
    expect(decoder.decode(sink.files.get('packs/r/a.json'))).toBe('{"type": {"mass_t": 41.0, "length": 20.0}}\n');
    expect(o.workspace.dirtyPaths()).toEqual([]);
    expect(await o.workspace.changes()).toEqual([]);
  });

  it('gives a file as last saved, and takes a recipe the editor made as never saved', async () => {
    const o = await openRecipe({ [RECIPE]: recipe(), 'packs/r/a.json': '{"sway": 1}\n' });
    await o.run(setField(o.workspace, 'a', '/sway', 2));
    expect(decoder.decode((await o.workspace.originalBytes('packs/r/a.json')) ?? new Uint8Array())).toBe('{"sway": 1}\n');
    expect(await o.workspace.originalBytes('packs/r/b.json')).toBeNull();
    const made = await openRecipe({ [RECIPE]: recipe() });
    await made.workspace.markUnsaved();
    expect(made.workspace.status(RECIPE)).toBe('new');
    expect(made.workspace.dirtyPaths()).toEqual([RECIPE]);
    expect(await made.workspace.originalBytes(RECIPE)).toBeNull();
    const sink = new MemorySink();
    await made.workspace.save(sink);
    expect([...sink.files.keys()]).toEqual([RECIPE]);
    expect(made.workspace.dirtyPaths()).toEqual([]);
  });
});

const mvp = mvpFiles();

describe('the MVP recipe (packs/mvp.json and packs/mvp/*.json)', () => {
  it.skipIf(mvp === null)('opens with every per-type file, and without an edit every file stays byte for byte', async () => {
    const files = mvp as Map<string, Uint8Array>;
    const o = await openFiles(files, 'packs/mvp.json');
    const perType = [...files.keys()].filter((path) => /^packs\/mvp\/[^/]+\.json$/.test(path));
    expect(perType.length).toBeGreaterThan(40);
    expect(o.workspace.overrideIds().length).toBe(perType.length);
    expect(o.workspace.dirtyPaths()).toEqual([]);
    expect(await o.workspace.changes()).toEqual([]);
    for (const { path, bytes } of await o.workspace.snapshot()) expect(Buffer.from(bytes).equals(Buffer.from(files.get(path) as Uint8Array)), path).toBe(true);
  });

  it.skipIf(mvp === null)('an edit of one field changes one line of one file; undone, nothing is left to save', async () => {
    const files = mvp as Map<string, Uint8Array>;
    const o = await openFiles(files, 'packs/mvp.json');
    const before = decoder.decode(files.get('packs/mvp/chme3.json'));
    await o.run(setField(o.workspace, 'chme3', '/type/mass_t', 124.0));
    expect(o.workspace.dirtyPaths()).toEqual(['packs/mvp/chme3.json']);
    const changes = await o.workspace.changes();
    expect(changes.map((change) => change.path)).toEqual(['packs/mvp/chme3.json']);
    expect(changedLines(before, decoder.decode((changes[0] as { bytes: Uint8Array }).bytes))).toEqual(['    "mass_t": 124.0,']);
    o.journal.undo();
    expect(o.workspace.dirtyPaths()).toEqual([]);
    expect(await o.workspace.text('packs/mvp/chme3.json')).toBe(before);
  });

  it.skipIf(mvp === null)('a door edited by id and a floor option are one line each too', async () => {
    const files = mvp as Map<string, Uint8Array>;
    const o = await openFiles(files, 'packs/mvp.json');
    const before = decoder.decode(files.get('packs/mvp/2te116.json'));
    await o.run(setDoorField(o.workspace, '2te116', 'CabDoor', 'inner', false, []));
    expect(changedLines(before, await o.workspace.text('packs/mvp/2te116.json'))).toEqual([
      '      "CabDoor": {"min": [-7.5, 2.15675, -0.6], "max": [-7.36, 4.06375, 0.25], "inner": false},',
    ]);
    o.journal.undo();
    await o.run(setFloorOption(o.workspace, '2te116', 'level', [1.79175, 2.2]));
    expect(changedLines(before, await o.workspace.text('packs/mvp/2te116.json'))).toEqual(['    "level": [1.79175, 2.2],']);
    expect(o.workspace.dirtyPaths()).toEqual(['packs/mvp/2te116.json']);
  });
});
