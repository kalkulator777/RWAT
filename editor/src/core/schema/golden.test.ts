/**
 * Golden runner of fixtures/golden/validate/ (editor.md §4.5, item 10; fixtures/golden/README.md).
 * The reference is tools/validate_pack.py; the editor checks with Ajv, so the places
 * (pointers) and severities must match exactly, and the words are held equal too except
 * where noted in the case's comparison below. The hint to an unknown key is the port of
 * `suggestion` and is compared word for word (`suggestion.json`).
 *
 * It sits in core/schema, not in ports/: eslint keeps ports/ from importing core/.
 */

import { describe, expect, it } from 'vitest';
import { readGoldenFolder } from '../../testing/golden.node';
import { REPO_ROOT } from '../../testing/repo.node';
import { createSchema, suggestion, type SchemaKind } from './index';
import { readSchemaFiles } from './files.node';

const FOLDER = `${REPO_ROOT}fixtures/golden/validate`;

const golden = readGoldenFolder(FOLDER);
const schema = createSchema(readSchemaFiles());

describe('golden validate', () => {
  it('names this port in ports.json, and the folder follows the golden format', () => {
    expect(golden.ports).toMatchObject({ reference: 'python', ports: expect.arrayContaining(['ts']) as unknown });
    expect(golden.problems).toEqual([]);
  });

  for (const file of golden.files) {
    describe(file.name, () => {
      for (const c of file.cases) {
        it(c.id, () => {
          const input = c.input as Record<string, unknown>;
          if ('key' in input) {
            expect(suggestion(input.key as string, input.known as string[])).toBe(c.expected);
            return;
          }
          const found = schema.checker
            .check(input.schema as SchemaKind, input.document)
            .map((f) => ({ pointer: f.pointer, severity: f.level, text: f.message }));
          const order = (a: { pointer: string; severity: string; text: string }, b: typeof a): number =>
            `${a.pointer}\u0000${a.severity}\u0000${a.text}`.localeCompare(`${b.pointer}\u0000${b.severity}\u0000${b.text}`);
          const expected = (c.expected as typeof found).slice().sort(order);
          // Places and severities exactly; the words are held equal as well.
          expect(found.slice().sort(order)).toEqual(expected);
        });
      }
    });
  }
});
