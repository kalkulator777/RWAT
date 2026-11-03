/**
 * Golden runner of fixtures/golden/json_dump/ (editor.md §4.5; fixtures/golden/README.md):
 * the editor's `dump` (./dump.ts) against tools/ir2rwat.py `dump`, the reference that
 * writes the expected.
 *
 * A case gives its JSON as text (`input.json`) or names a file of the example pack
 * (`input_file.value`); either is read losslessly (`parseLossless`), so `100.0` stays
 * apart from `100` as it does for Python. The folder is read and checked against
 * fixtures/golden/schema.json by the runners' shared part (testing/golden.node.ts).
 *
 * It sits in core/json, next to the port, not in ports/: eslint keeps ports/ from
 * importing core/.
 */

import { describe, expect, it } from 'vitest';
import { mismatch, readGoldenFolder } from '../../testing/golden.node';
import { REPO_ROOT } from '../../testing/repo.node';
import { dump } from './dump';
import { parseLossless } from './parse';

const FOLDER = `${REPO_ROOT}fixtures/golden/json_dump`;

/** A case's input: the JSON as text, given (`json`) or read from the example pack as it is (`value`). */
interface Input {
  json?: string;
  value?: string;
}

const golden = readGoldenFolder(FOLDER, { raw: true });

describe('golden json_dump', () => {
  it('names this port in ports.json, and the folder follows the golden format', () => {
    expect(golden.ports).toMatchObject({ reference: 'python', ports: expect.arrayContaining(['ts']) as unknown });
    expect(golden.problems).toEqual([]);
  });

  for (const file of golden.files) {
    describe(file.name, () => {
      for (const c of file.cases) {
        it(c.id, () => {
          const input = c.input as Input;
          const text = input.value ?? input.json;
          expect(typeof text, 'the case gives input.json or input_file.value').toBe('string');
          expect(mismatch(dump(parseLossless(text as string)), c.expected, file.tolerance), c.note).toBeNull();
        });
      }
    });
  }
});
