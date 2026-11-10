// @vitest-environment node
/**
 * The MVP recipe of the repository (`packs/mvp.json`, `packs/mvp/*.json`, the two MVP zips)
 * in the IR session, picked as an author picks it: the zips (as files on disk, never read
 * whole), the recipe file, its per-type files.
 *
 * - Always, where the inputs are there: the session opens (the zips matched to the
 *   recipe's sources, their central directories read), and an edit of one field changes one
 *   line of one per-type file; every other file stays byte for byte; undo gives it back.
 * - With `RWAT_MVP=1` (minutes: `derive` of the whole pack in wasm): the full import, and an
 *   edit through the form's layers (with the derived values: an equal value would be a
 *   reset) is one line too; the time and Python's memory printed.
 *
 * Without the zips (they leave the repository after phase 2, D3, R12) it says it is
 * skipped (E9). Nothing of MVP is written anywhere.
 */

import { existsSync, openAsBlob } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setField } from '../../ir/recipe';
import { REPO_ROOT } from '../../testing/repo.node';
import { listChanges } from '../save/changes';
import { mode } from '../store';
import { closeIr, importIr, runIrMade } from './actions';
import { overrideLayers } from './layers';
import { IrSession, makeBridge, useBridgeMaker } from './session';
import { fileRecipeSource, sourceZips, type NamedBlob } from './sources';
import { irSession } from './state';
import { useNodeBridges } from './testing.node';

const RECIPE = join(REPO_ROOT, 'packs', 'mvp.json');
const recipe = existsSync(RECIPE) ? (JSON.parse(await readFile(RECIPE, 'utf8')) as Record<string, unknown>) : null;
const zips = recipe === null ? [] : sourceZips(recipe).map((zip) => join(REPO_ROOT, 'packs', zip));
const present = recipe !== null && zips.length > 0 && zips.every((zip) => existsSync(zip));
const asked = process.env.RWAT_MVP === '1';
const decoder = new TextDecoder();

/** The MVP recipe as picked: its file, its per-type files (by name), the zips as files on disk. */
async function picks() {
  const recipeFile = new File([await readFile(RECIPE)], 'mvp.json');
  const folder = join(REPO_ROOT, 'packs', 'mvp');
  const overrides: File[] = [];
  for (const name of (await readdir(folder)).filter((n) => n.endsWith('.json')).sort()) overrides.push(new File([await readFile(join(folder, name))], name));
  const picked: NamedBlob[] = [];
  for (const zip of zips) picked.push({ name: zip.split('/').pop() ?? zip, blob: await openAsBlob(zip) });
  return { recipeFile, overrides, picked };
}

/** The lines where two texts differ (the same number of lines). */
function changedLines(before: string, after: string): string[] {
  const a = before.split('\n');
  const b = after.split('\n');
  expect(b.length).toBe(a.length);
  return b.filter((line, i) => line !== a[i]);
}

beforeAll(() => {
  useNodeBridges();
});

afterEach(() => {
  closeIr();
  mode.value = '2a';
  useBridgeMaker(null);
  useNodeBridges();
});

describe('the MVP recipe in the IR session', () => {
  it.skipIf(!present)('opens with its 45 per-type files and both zips; one edit is one line of one file', async () => {
    const { recipeFile, overrides, picked } = await picks();
    const { source, recipePath } = await fileRecipeSource(recipeFile, { files: overrides });
    const session = await IrSession.open({ source, recipePath, zips: picked }, await makeBridge());
    try {
      expect([...session.sources.keys()]).toEqual(sourceZips(recipe));
      expect(session.workspace.overrideIds().length).toBe(overrides.length);
      expect(session.workspace.dirtyPaths()).toEqual([]);
      const before = decoder.decode(new Uint8Array(await overrides.find((f) => f.name === 'chme3.json')!.arrayBuffer()));
      await session.run(setField(session.workspace, 'chme3', '/type/mass_t', 125.0));
      expect(session.workspace.dirtyPaths()).toEqual(['packs/mvp/chme3.json']);
      expect(changedLines(before, await session.workspace.text('packs/mvp/chme3.json'))).toEqual(['    "mass_t": 125.0,']);
      const changes = await listChanges(session.workspace);
      expect(changes.map((c) => [c.path, c.added, c.removed])).toEqual([['packs/mvp/chme3.json', 1, 1]]);
      for (const { path, bytes } of await session.workspace.snapshot()) {
        if (path === 'packs/mvp/chme3.json') continue;
        const original = path === recipePath ? recipeFile : overrides.find((f) => `packs/mvp/${f.name}` === path)!;
        expect(Buffer.from(bytes).equals(Buffer.from(await original.arrayBuffer())), path).toBe(true);
      }
      session.journal.undo();
      expect(session.workspace.dirtyPaths()).toEqual([]);
    } finally {
      session.dispose();
    }
  }, 60_000);

  it.skipIf(!present || !asked)('imports whole (derive), and an edit through the form is one line (time and memory printed)', async () => {
    const { recipeFile, overrides, picked } = await picks();
    const { source, recipePath } = await fileRecipeSource(recipeFile, { files: overrides });
    mode.value = '2b';
    const started = performance.now();
    expect(await importIr({ source, recipePath, zips: picked })).toEqual({ ok: true });
    const importMs = performance.now() - started;
    const session = irSession.value!;
    expect(session.typeIds().length).toBe(45);
    const form = overrideLayers(session, 'chme3', runIrMade);
    expect(form.view('/type/mass_t').state).toBe('set');
    form.set('/type/mass_t', 125.0);
    const until = Date.now() + 5000;
    while (session.workspace.dirtyPaths().length === 0 && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(session.workspace.dirtyPaths()).toEqual(['packs/mvp/chme3.json']);
    const before = decoder.decode(new Uint8Array(await overrides.find((f) => f.name === 'chme3.json')!.arrayBuffer()));
    expect(changedLines(before, await session.workspace.text('packs/mvp/chme3.json'))).toEqual(['    "mass_t": 125.0,']);
    const floorStarted = performance.now();
    const passenger = session.typeIds().find((id) => session.derivedOf(id)?.category === 'passenger')!;
    await session.regenerateFloor(passenger);
    expect(session.floor(passenger)?.status).toBe('ready');
    console.info(
      `MVP in the IR session (Node): import ${(importMs / 1000).toFixed(1)} s, floor of ${passenger} ${((performance.now() - floorStarted) / 1000).toFixed(1)} s, ` +
        `Python memory ${((await session.memory()) / 2 ** 20).toFixed(0)} MiB`,
    );
  }, 30 * 60_000);

  it.skipIf(present && asked)('is skipped in part: needs packs/mvp.json with its zips, and RWAT_MVP=1 for the full import (minutes)', () => {
    expect(present && asked).toBe(false);
  });
});
