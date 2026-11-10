/** The schema check of a recipe and its per-type files (./check.ts). */

import { describe, expect, it } from 'vitest';
import { createSchema } from '../../core/schema';
import { readSchemaFiles } from '../../core/schema/files.node';
import { checkRecipe } from './check';
import { mvpFiles, openFiles, openRecipe, RECIPE } from './testing.node';

const schema = createSchema(readSchemaFiles());
const mvp = mvpFiles();

function recipe(extra: object = {}): object {
  return { namespace: 'ns', pack_dir: 'P', sources: [{ zip: '../ir.zip', root: 'stock' }], overrides_dir: 'r', ...extra };
}

describe('the schema check', () => {
  it('finds what the schemas say, an unknown key a warning with its hint, linked to the field', async () => {
    const o = await openRecipe({
      [RECIPE]: recipe({ overides: {} }),
      'packs/r/a.json': { _about: 'fine', type: { mass_tt: 40, length: -1 }, floor: { levle: 1 }, sway: 7 },
      'packs/r/b.json': { name: { ru_ru: 'Б' } },
    });
    const problems = checkRecipe(schema, o.workspace, { typeIds: ['a', 'c'] });
    const brief = problems.map((p) => [p.severity, p.code, p.at[0]?.kind === 'field' ? `${p.at[0].file}#${p.at[0].at}` : p.at[0]?.kind === 'file' ? p.at[0].file : '']);
    expect(brief).toEqual(
      expect.arrayContaining([
        ['warning', 'schema.unknown-key', `${RECIPE}#/overides`],
        ['warning', 'schema.unknown-key', 'packs/r/a.json#/type/mass_tt'],
        ['warning', 'schema.unknown-key', 'packs/r/a.json#/floor/levle'],
        ['warning', 'recipe.unknown-type', 'packs/r/b.json'],
      ]),
    );
    expect(problems.find((p) => p.code === 'schema.unknown-key' && p.params.key === 'overides')?.text).toMatch(/did you mean 'overrides'/);
    expect(problems.find((p) => p.code === 'recipe.unknown-type')?.text).toBe("packs/r/b.json: no stock type 'b' in the packs, not used");
    expect(problems.filter((p) => p.severity === 'error').map((p) => (p.at[0] as { at: string }).at).sort()).toEqual(['/sway', '/type/length']);
    expect(problems.some((p) => JSON.stringify(p.at).includes('_about'))).toBe(false);
  });

  it.skipIf(mvp === null)('finds no error in the MVP recipe', async () => {
    const o = await openFiles(mvp as Map<string, Uint8Array>, 'packs/mvp.json');
    expect(checkRecipe(schema, o.workspace).filter((p) => p.severity === 'error')).toEqual([]);
  });
});
