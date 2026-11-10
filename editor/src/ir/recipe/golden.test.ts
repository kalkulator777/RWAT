/**
 * Golden runner of fixtures/golden/recipe_merge/ (editor.md §4.5; fixtures/golden/README.md):
 * the editor's merge of a stock type's override (./merge.ts) against tools/ir2rwat.py, the
 * reference that writes the expected (tools/tests/test_golden_recipe_merge.py runs the real
 * converter on the case's derived layer). Everything is compared: the type and the model
 * as written, keys in order, the lang entries and the converter's warnings.
 */

import { describe, expect, it } from 'vitest';
import { mismatch, readGoldenFolder } from '../../testing/golden.node';
import { REPO_ROOT } from '../../testing/repo.node';
import { type Derived, mergeOverride } from './merge';

const FOLDER = `${REPO_ROOT}fixtures/golden/recipe_merge`;

/** The id and namespace the reference converts the case's type under. */
const TYPE_ID = 'car';
const NAMESPACE = 'ns';

interface Input {
  category: string;
  derived: Omit<Derived, 'category'>;
  floor: unknown;
  inline?: unknown;
  override?: unknown;
}

const golden = readGoldenFolder(FOLDER);

describe('golden recipe_merge', () => {
  it('names this port in ports.json, and the folder follows the golden format', () => {
    expect(golden.ports).toMatchObject({ reference: 'python', ports: expect.arrayContaining(['ts']) as unknown });
    expect(golden.problems).toEqual([]);
  });

  for (const file of golden.files) {
    describe(file.name, () => {
      for (const c of file.cases) {
        it(c.id, () => {
          const input = c.input as Input;
          const result = mergeOverride({
            derived: { ...input.derived, category: input.category },
            floor: input.floor,
            inline: input.inline,
            override: input.override,
            namespace: NAMESPACE,
            id: TYPE_ID,
          });
          expect(mismatch(result, c.expected, file.tolerance), c.note).toBeNull();
        });
      }
    });
  }
});
