/**
 * Golden runner of fixtures/golden/validate/ (editor.md §4.5, item 10; fixtures/golden/README.md).
 * The reference is tools/validate_pack.py; the editor checks with Ajv, so the places
 * (pointers) and severities must match exactly, and the words are held equal too except
 * where noted in the case's comparison below. The hint to an unknown key is the port of
 * `suggestion` and is compared word for word (`suggestion.json`).
 *
 * It sits in core/schema, not in ports/: eslint keeps ports/ from importing core/.
 */

import Ajv2020 from 'ajv/dist/2020';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { REPO_ROOT } from '../../testing/repo.node';
import { describe, expect, it } from 'vitest';
import { createSchema, suggestion, type SchemaKind } from './index';
import { readSchemaFiles } from './files.node';

const REPO = REPO_ROOT;
const FOLDER = `${REPO}fixtures/golden/validate`;

interface Case {
  id: string;
  note: string;
  input?: Record<string, unknown>;
  input_file?: string | Record<string, string>;
  expected: unknown;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function inputOf(c: Case): Record<string, unknown> {
  const input = { ...(c.input ?? {}) };
  if (typeof c.input_file === 'object') {
    for (const [key, file] of Object.entries(c.input_file)) input[key] = readJson(`${REPO}${file}`);
  }
  return input;
}

const folderExists = existsSync(FOLDER);
const files = folderExists ? readdirSync(FOLDER).filter((n) => n.endsWith('.json') && n !== 'ports.json').sort() : [];
const schema = createSchema(readSchemaFiles());

describe.skipIf(!folderExists)('golden validate', () => {
  it('names this port in ports.json, and every file follows the golden schema', () => {
    expect(readJson(`${FOLDER}/ports.json`)).toMatchObject({ reference: 'python', ports: expect.arrayContaining(['ts']) as unknown });
    const goldenSchema = readJson(`${REPO}fixtures/golden/schema.json`) as object;
    const ajv = new Ajv2020({ strict: false });
    const valid = ajv.compile(goldenSchema);
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      expect(valid(readJson(`${FOLDER}/${name}`)), `${name}: ${ajv.errorsText(valid.errors)}`).toBe(true);
    }
  });

  for (const name of files) {
    const file = readJson(`${FOLDER}/${name}`) as { cases: Case[] };
    describe(name, () => {
      for (const c of file.cases) {
        it(c.id, () => {
          const input = inputOf(c);
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
