// @vitest-environment node
/**
 * The IR session (./session.ts, ./actions.ts) on the synthetic IR pack (ir/testing.node: our
 * own bytes) with the real converter on Pyodide in Node, a Pyodide of its own per bridge as
 * a worker of its own in the page:
 *
 * - import: the zips, the recipe and its per-type files picked → the types the converter
 *   derives, with categories and the marks of an override;
 * - an edit of a field writes one per-type file, one line of it; undo leaves nothing to save;
 * - a field's three states, through the form's layers (./layers.ts);
 * - "Перегенерировать пол": the floor for the new options, the zones before kept, the type
 *   the pack gets = the one the conversion writes;
 * - the type's model read out of the zips by the model pipeline;
 * - the export of the recipe: JSON only, the zips the receiver needs listed;
 * - "Готовый пак для себя" = `python3 -I tools/ir2rwat.py --zip` on the same files, byte for
 *   byte, in a worker of its own (a cancelled one leaves the session's derived recipe alone);
 * - failures in words: a pick that is no zip, a recipe that is no JSON, a zip the recipe
 *   names and nobody picked, a recipe the converter refuses (opened, its refusal a finding).
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSchema } from '../../core/schema';
import { readSchemaFiles } from '../../core/schema/files.node';
import { openZipSource } from '../../io';
import { removeField, setFloorOption } from '../../ir/recipe';
import { havePython, irRecipe, runTool, writeFolder } from '../../ir/testing.node';
import { createModelApi } from '../../model/api';
import { ModelLoader } from '../../model/client';
import { fakeBitmap } from '../../preview/testing.node';
import { listChanges } from '../save/changes';
import { installShortcuts, redo, undo } from '../session';
import { activeJournal, canRedo, canUndo, failure, irWork, mode, schema, selection } from '../store';
import { closeIr, convertIr, importIr, runIrMade, saveIr } from './actions';
import { overrideLayers } from './layers';
import { irModelFiles } from './model';
import { useBridgeMaker } from './session';
import { fileRecipeSource, named, newRecipeSource, draftRecipe } from './sources';
import { irConversion, irDialog, irDirtyCount, irFindings, irOpenType, irSession } from './state';
import { made, syntheticPicks, useNodeBridges } from './testing.node';

const decoder = new TextDecoder();
let scratch: string;

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'rwat-ir-session-'));
  schema.value = createSchema(readSchemaFiles());
});

afterAll(async () => {
  closeIr();
  useBridgeMaker(null);
  schema.value = null;
  await rm(scratch, { recursive: true, force: true });
});

beforeEach(() => {
  made.length = 0;
  useNodeBridges();
  mode.value = '2b';
});

afterEach(() => {
  closeIr();
  failure.value = null;
  mode.value = '2a';
});

/** Opens the synthetic pack: the zips, the recipe file and its per-type files' zip. */
async function importSynthetic(recipe?: Record<string, unknown>) {
  const picks = await syntheticPicks(recipe);
  const { source, recipePath } = await fileRecipeSource(picks.recipe, { zip: picks.overrides });
  const outcome = await importIr({ source, recipePath, zips: picks.zips.map(named) });
  expect(outcome).toEqual({ ok: true });
  const session = irSession.value;
  if (session === null) throw new Error('no session');
  return { session, picks };
}

describe('importing an IR pack', () => {
  it('derives the types, opens the first, and the top bar works on its journal', async () => {
    const { session } = await importSynthetic();
    expect(session.typeIds().sort()).toEqual(['hopper', 'loco', 'test_coach']);
    expect(session.derivedOf('test_coach')?.category).toBe('passenger');
    expect(session.derivedOf('loco')?.category).toBe('locomotives');
    expect(session.hasOverride('hopper')).toBe(true);
    expect(session.hasOverride('loco')).toBe(false);
    expect(session.recipePath).toBe('packs/test.json');
    expect(session.workspace.overrideIds()).toEqual(['hopper', 'test_coach']);
    expect(irOpenType.value).toBe(session.typeIds()[0]);
    expect(selection.value).toEqual([session.typeLink(session.typeIds()[0]!)]);
    expect(irWork.value?.journal).toBe(session.journal);
    expect(activeJournal.value).toBe(session.journal);
    // the converter's error about the type with no model is a finding, of the recipe
    const errors = irFindings.value.filter((p) => p.source === 'converter' && p.severity === 'error');
    expect(errors.map((p) => p.text).join('\n')).toContain('no_model.json: skipped');
    expect(errors[0]?.at).toEqual([{ kind: 'file', file: 'packs/test.json' }]);
    // the recipe's unknown key: the schema's warning and the converter's
    expect(irFindings.value.some((p) => p.code === 'schema.unknown-key' && p.at.some((l) => l.kind === 'field' && l.at === '/unknown_key'))).toBe(true);
    // one bridge, the session's own (the page's, the suggestions', is never touched)
    expect(made).toHaveLength(1);
  }, 60_000);

  it('says why it did not open, in words: a pick that is no zip, a recipe that is no JSON, a zip nobody picked', async () => {
    const picks = await syntheticPicks();
    const { source, recipePath } = await fileRecipeSource(picks.recipe, null);
    const notZip = new File(['not a zip'], 'test-ir.zip');
    expect(await importIr({ source, recipePath, zips: [notZip, picks.zips[1]!].map(named) })).toEqual({ ok: false, cancelled: false, key: 'ir.error.not-zip', params: { file: 'test-ir.zip' } });
    expect(await importIr({ source, recipePath, zips: [named(picks.zips[0]!)] })).toEqual({
      ok: false,
      cancelled: false,
      key: 'ir.error.missing-zips',
      params: { files: 'Second IR.zip', count: 1 },
    });
    await expect(fileRecipeSource(new File(['{"name": '], 'bad.json'), null)).rejects.toMatchObject({ key: 'ir.error.recipe-json', params: { file: 'bad.json' } });
    await expect(fileRecipeSource(new File(['[]'], 'list.json'), null)).rejects.toMatchObject({ key: 'ir.error.recipe-object' });
    expect(irSession.value).toBeNull();
  }, 60_000);

  it('opens a recipe the converter refuses, its refusal a finding in the converter\'s words', async () => {
    const { session } = await importSynthetic({ ...irRecipe(), namespace: 'Not A Namespace' });
    expect(session.typeIds()).toEqual([]);
    expect(session.deriveError).toContain('"namespace" must be a Minecraft namespace');
    const refusal = irFindings.value.find((p) => p.code === 'converter.refusal');
    expect(refusal?.text).toContain('"namespace" must be a Minecraft namespace');
    expect(refusal?.text).not.toContain('Traceback');
    expect(selection.value).toEqual([{ kind: 'file', file: 'packs/test.json' }]);
  }, 60_000);
});

describe('editing a type', () => {
  it('writes one per-type file, one line of it; undo leaves nothing to save', async () => {
    const { session } = await importSynthetic();
    const form = overrideLayers(session, 'hopper', runIrMade);
    expect(form.view('/type/mass_t')).toEqual({ state: 'set', derived: 20 });
    form.set('/type/mass_t', 22);
    await vi_wait(() => expect(session.workspace.dirtyPaths()).toEqual(['packs/tp/hopper.json']));
    expect(irDirtyCount.value).toBe(1);
    const changes = await listChanges(session.workspace);
    expect(changes).toEqual([{ path: 'packs/tp/hopper.json', status: 'changed', kind: 'json', added: 1, removed: 1, exact: true }]);
    expect(await session.workspace.text('packs/tp/hopper.json')).toBe('{\n  "type": {\n    "mass_t": 22\n  }\n}\n');
    expect(session.layers('hopper')?.result.type.mass_t).toBe(22);
    // the top bar's undo acts on the session in 2b (and on the pack's journal in 2a)
    expect(canUndo.value).toBe(true);
    undo();
    expect(session.workspace.dirtyPaths()).toEqual([]);
    expect(irDirtyCount.value).toBe(0);
    expect(session.layers('hopper')?.result.type.mass_t).toBe(21);
    expect(canRedo.value).toBe(true);
    mode.value = '2a';
    expect(canRedo.value).toBe(false);
    redo();
    expect(session.workspace.dirtyPaths()).toEqual([]);
    mode.value = '2b';
    redo();
    expect(session.workspace.dirtyPaths()).toEqual(['packs/tp/hopper.json']);
    // Ctrl+S opens the session's save dialog
    const keys = new EventTarget();
    const stop = installShortcuts(keys);
    const press = new Event('keydown') as Event & { key: string; ctrlKey: boolean };
    Object.assign(press, { key: 's', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false });
    keys.dispatchEvent(press);
    stop();
    expect(irDialog.value).toBe('save');
    irDialog.value = null;
  }, 60_000);

  it('moves a field between its three states, the first edit of a type making its file', async () => {
    const { session } = await importSynthetic();
    const loco = overrideLayers(session, 'loco', runIrMade);
    const derivedMass = session.layers('loco')?.result.type.mass_t;
    expect(loco.view('/type/mass_t')).toEqual({ state: 'derived', derived: derivedMass });
    loco.set('/type/mass_t', 81);
    await vi_wait(() => expect(loco.view('/type/mass_t').state).toBe('set'));
    expect(session.workspace.status('packs/tp/loco.json')).toBe('new');
    // the derived value typed back is a reset: the file goes again
    loco.set('/type/mass_t', derivedMass);
    await vi_wait(() => expect(session.workspace.has('packs/tp/loco.json')).toBe(false));
    expect(loco.canRemove('/type/max_speed_kmh')).toBe(true);
    expect(loco.canRemove('/type/doors')).toBe(false);
    loco.remove('/type/max_speed_kmh');
    await vi_wait(() => expect(loco.view('/type/max_speed_kmh').state).toBe('removed'));
    expect(session.layers('loco')?.result.type).not.toHaveProperty('max_speed_kmh');
    loco.reset('/type/max_speed_kmh');
    await vi_wait(() => expect(loco.view('/type/max_speed_kmh').state).toBe('derived'));
    // a place no override has is refused in words, nothing changes
    await runIrMade(() => removeField(session.workspace, 'loco', '/type/doors'));
    expect(failure.value?.key).toBe('ir.error.edit');
    expect(session.workspace.dirtyPaths()).toEqual([]);
  }, 60_000);
});

/** Waits for a condition the journal's async run makes true. */
async function vi_wait(check: () => void): Promise<void> {
  const until = Date.now() + 5000;
  for (;;) {
    try {
      check();
      return;
    } catch (error) {
      if (Date.now() > until) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
}

describe('the floor', () => {
  it('is generated when the type is first looked at, regenerated for new options, the zones before kept; the type is the conversion\'s', async () => {
    const { session } = await importSynthetic();
    expect(session.floorNeeded('test_coach')).toBe(true);
    expect(session.floorNeeded('loco')).toBe(false);
    session.ensureFloor('test_coach');
    await vi_wait(() => expect(session.floor('test_coach')?.status).toBe('ready'));
    const first = session.floor('test_coach')!;
    expect(Array.isArray(first.floor?.interior)).toBe(true);
    expect(first.previous).toBeNull();
    expect(session.layers('test_coach')?.result.type.interior).toEqual(first.floor?.interior);

    await runIrMade(() => setFloorOption(session.workspace, 'test_coach', 'clearance', 0.3));
    expect(session.floorStale('test_coach')).toBe(true);
    await session.regenerateFloor('test_coach');
    const second = session.floor('test_coach')!;
    expect(second.status).toBe('ready');
    expect(session.floorStale('test_coach')).toBe(false);
    expect(second.previous).toEqual(first.floor?.interior);
    expect(second.ms).toBeGreaterThan(0);

    // what the pack gets = what the conversion writes for the same override
    const result = await convertIr({ kind: 'zip', deliver: () => undefined });
    const pack = result?.pack;
    if (pack?.kind !== 'zip') throw new Error('no zip');
    const written = await openZipSource(pack.bytes, pack.name);
    expect(JSON.parse(decoder.decode(await written.read('data/tp/wagon_types/test_coach.json')))).toEqual(session.layers('test_coach')?.result.type);
    expect(JSON.parse(decoder.decode(await written.read('assets/tp/wagon_models/test_coach.json')))).toEqual(session.layers('test_coach')?.result.model);
  }, 120_000);
});

describe('the model of a type', () => {
  it('is read out of the zips by the model pipeline, its textures with it', async () => {
    const { session } = await importSynthetic();
    const files = irModelFiles(await session.modelFiles('test_coach'), (source) => session.sourceZip(source), `ir ${session.serial}`);
    const layers = session.layers('test_coach')!;
    const loader = new ModelLoader(createModelApi((_bytes, path) => Promise.resolve(fakeBitmap(path))));
    const model = await loader.load(files, { id: 'tp:test_coach', file: 'assets/tp/wagon_models/test_coach.json', declaration: layers.result.model });
    expect(model.problems.filter((p) => p.severity === 'error')).toEqual([]);
    expect(model.parts.length).toBeGreaterThan(0);
    expect(model.objects.map((o) => o.name)).toContain('DOOR_1_EXTERNAL');
    // the material the model draws with (the glass's is not used by any face)
    expect(Object.keys(model.textures)).toEqual(['assets/tp/stock/textures/coach/body.png']);
    expect(Object.values(model.textures).every((bitmap) => bitmap !== null)).toBe(true);
  }, 60_000);
});

describe('saving and the export', () => {
  it('saves the changed per-type file as a zip of the markup; the export has JSON only and names the zips needed', async () => {
    const { session } = await importSynthetic();
    await runIrMade(() => setFloorOption(session.workspace, 'test_coach', 'clearance', 0.2));
    expect(session.saveTarget).toBe('zip');
    let delivered: { zip: Uint8Array; name: string } | null = null;
    expect(await saveIr('zip', (zip, name) => void (delivered = { zip, name }))).toBe(true);
    expect(session.workspace.dirtyPaths()).toEqual([]);
    expect(session.journal.atSavePoint).toBe(true);
    expect(delivered!.name).toBe('test-recipe.zip');

    const markup = await session.exportMarkup();
    const zip = await openZipSource(markup.zip, 'export.zip');
    const paths = (await zip.list()).map((entry) => entry.path);
    expect(paths).toEqual(['packs/test.json', 'packs/tp/hopper.json', 'packs/tp/test_coach.json']);
    expect(paths.every((path) => path.endsWith('.json'))).toBe(true);
    expect(markup.sources).toEqual(['test-ir.zip', '../sources/Second IR.zip']);
    expect(decoder.decode(await zip.read('packs/tp/test_coach.json'))).toContain('"clearance": 0.2');
    expect(decoder.decode(await zip.read('packs/test.json'))).toContain('"_comment"');
  }, 60_000);

  it('makes a recipe in the editor new until it is saved', async () => {
    const picks = await syntheticPicks();
    const draft: Record<string, unknown> = { ...draftRecipe(picks.zips.map(named)), namespace: 'tp' };
    expect(draft.sources).toEqual([
      { zip: '../test-ir.zip', root: 'stock', label: 'test-ir' },
      { zip: '../Second IR.zip', root: 'stock_2', label: 'Second IR' },
    ]);
    const { source, recipePath } = newRecipeSource(draft);
    expect(recipePath).toBe('packs/testir.json');
    expect(await importIr({ source, recipePath, zips: picks.zips.map(named), fresh: true })).toEqual({ ok: true });
    const session = irSession.value!;
    expect(session.typeIds().sort()).toEqual(['hopper', 'loco', 'test_coach']);
    expect(session.workspace.recipe().overrides_dir).toBe('testir');
    expect(session.workspace.dirtyPaths()).toEqual(['packs/testir.json']);
    expect((await listChanges(session.workspace))[0]?.status).toBe('new');
  }, 60_000);
});

describe.skipIf(!havePython)('the pack for oneself', () => {
  it('is the zip python3 -I tools/ir2rwat.py --zip writes from the same files, byte for byte', async () => {
    const { session, picks } = await importSynthetic();
    await runIrMade(() => setFloorOption(session.workspace, 'test_coach', 'clearance', 0.2));
    let delivered: { zip: Uint8Array; name: string } | null = null;
    const result = await convertIr({ kind: 'zip', deliver: (zip, name) => void (delivered = { zip, name }) });
    expect(result?.exitCode).toBe(1); // the type with no model
    expect(irConversion.value?.written).toBe('TestPack.zip');
    expect(made).toHaveLength(2); // the session's, and the conversion's own

    const root = join(scratch, 'cli');
    const files: Record<string, Uint8Array> = {};
    for (const { path, bytes } of await session.workspace.snapshot()) files[path] = bytes;
    files['packs/test-ir.zip'] = new Uint8Array(await picks.zips[0]!.arrayBuffer());
    files['sources/Second IR.zip'] = new Uint8Array(await picks.zips[1]!.arrayBuffer());
    await writeFolder(root, files);
    const run = runTool('ir2rwat.py', [join(root, 'packs', 'test.json'), '--out', join(root, 'out'), '--zip']);
    expect(run.status).toBe(1);
    expect(delivered!.name).toBe('TestPack.zip');
    expect(delivered!.zip).toEqual(new Uint8Array(await readFile(join(root, 'out', 'TestPack.zip'))));
  }, 120_000);

  it('cancelled, stops its own worker only: the session goes on with its derived recipe', async () => {
    const { session } = await importSynthetic();
    const converting = convertIr({ kind: 'zip', deliver: () => undefined });
    // the conversion's bridge is made when it starts; cancel it then
    await vi_wait(() => expect(made).toHaveLength(2));
    (await import('./state')).irTask.value?.cancel();
    expect(await converting).toBeNull();
    expect(failure.value).toBeNull();
    await session.regenerateFloor('test_coach');
    expect(session.floor('test_coach')?.status).toBe('ready');
  }, 120_000);
});
