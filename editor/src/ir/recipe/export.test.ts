/** The export of a recipe's markup (./export.ts): the MVP recipe's files in a zip, not one asset. */

import { describe, expect, it } from 'vitest';
import { openZipSource } from '../../io/zip';
import { exportRecipe, isMarkupFile } from './export';
import { setField } from './fields';
import { mvpFiles, openFiles, openRecipe, RECIPE } from './testing.node';

const decoder = new TextDecoder();
const mvp = mvpFiles();

describe('the export of the recipe', () => {
  it.skipIf(mvp === null)('of MVP is the markup: the recipe and its per-type files, no asset, the same bytes every time', async () => {
    const files = mvp as Map<string, Uint8Array>;
    const o = await openFiles(files, 'packs/mvp.json');
    await o.run(setField(o.workspace, 'chme3', '/type/mass_t', 124.0));
    const exported = await exportRecipe(o.workspace);
    const entries = (await (await openZipSource(exported.zip, 'mvp-recipe.zip')).list()).map((entry) => entry.path);
    expect(entries).toEqual(exported.files.map((file) => file.path));
    expect(entries[0]).toBe('packs/mvp.json');
    expect(entries.filter((path) => path.startsWith('packs/mvp/')).length).toBe(o.workspace.overrideIds().length);
    expect(entries.filter((path) => /\.(obj|mtl|png|ogg|anim|zip)$/i.test(path))).toEqual([]);
    expect(entries.every(isMarkupFile)).toBe(true);
    expect(entries.some((path) => path.includes('/geometry/'))).toBe(false);
    expect(exported.sources).toEqual(['../MVP-IR-1.8-mc1.12.2-by-FrozeRain.zip', '../MVP-IR-1.7-bugfix-mc1.12.2-by-FrozeRain.zip']);
    const chme3 = exported.files.find((file) => file.path === 'packs/mvp/chme3.json') as { bytes: Uint8Array };
    expect(decoder.decode(chme3.bytes)).toContain('"mass_t": 124.0,');
    expect(Buffer.from((await exportRecipe(o.workspace)).zip).equals(Buffer.from(exported.zip))).toBe(true);
  });

  it('of a recipe without per-type files is the recipe alone; a source without a zip is no source', async () => {
    const o = await openRecipe({ [RECIPE]: { namespace: 'ns', pack_dir: 'P', sources: [{ zip: 'a.zip', root: 's' }, { root: 't' }] } });
    const exported = await exportRecipe(o.workspace);
    expect(exported.files.map((file) => file.path)).toEqual([RECIPE]);
    expect(exported.sources).toEqual(['a.zip']);
  });
});
