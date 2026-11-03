/**
 * Golden runner of fixtures/golden/json_dump/ (editor.md §4.5; fixtures/golden/README.md):
 * the editor's `dump` (./dump.ts) against tools/ir2rwat.py `dump`, the reference that
 * writes the expected.
 *
 * A case gives its JSON as text (`input.json`) or names a file of the example pack
 * (`input_file.value`); either is read losslessly (`parseLossless`), so `100.0` stays
 * apart from `100` as it does for Python. Every file of the folder is checked against
 * fixtures/golden/schema.json before it is read.
 *
 * It sits in core/json, next to the port, not in ports/: eslint keeps ports/ from
 * importing core/.
 */

import Ajv2020 from 'ajv/dist/2020';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { REPO_ROOT } from '../../testing/repo.node';
import { describe, expect, it } from 'vitest';
import { dump } from './dump';
import { parseLossless } from './parse';

const REPO = REPO_ROOT;
const FOLDER = `${REPO}fixtures/golden/json_dump`;

interface Case {
  id: string;
  note: string;
  input?: { json: string };
  input_file?: { value: string };
  expected: string;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

const folderExists = existsSync(FOLDER);
const files = folderExists ? readdirSync(FOLDER).filter((name) => name.endsWith('.json') && name !== 'ports.json').sort() : [];

describe.skipIf(!folderExists)('golden json_dump', () => {
  it('names this port in ports.json, and every file follows the golden schema', () => {
    expect(readJson(`${FOLDER}/ports.json`)).toMatchObject({ reference: 'python', ports: expect.arrayContaining(['ts']) as unknown });
    const ajv = new Ajv2020({ strict: false });
    const valid = ajv.compile(readJson(`${REPO}fixtures/golden/schema.json`) as object);
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
          const text = c.input_file !== undefined ? readFileSync(`${REPO}${c.input_file.value}`, 'utf8') : c.input?.json;
          expect(typeof text, 'the case gives input.json or input_file.value').toBe('string');
          expect(dump(parseLossless(text as string)), c.note).toBe(c.expected);
        });
      }
    });
  }
});
