/**
 * Golden runner of fixtures/golden/model_check/ (editor.md §4.5; fixtures/golden/README.md):
 * ./modelCheck against `pack/ModelCheck.java`, the reference that writes the expected — a
 * wagon model declaration and a pack's files → what the check of `/rwatc packs validate`
 * finds in them, in its order, each finding's severity, its code (`ModelFinding.Code.key`),
 * its params in the line's order and its line; no subject or index (null). Or, for a
 * `location` alone, how the check takes it: {@link validLocation} and {@link splitLocation}
 * against the Java runner's `ResourceLocations.valid` (Minecraft's `ResourceLocation.tryParse`
 * written out) and `ModelCheck.namespace`, `path`.
 *
 * The case's pack takes a location by {@link validLocation} and names its file by
 * {@link splitLocation}, as the Java runner does by Minecraft's rule (the model worker's own
 * reader, model/build `checkFiles`, is model/resources').
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mismatch, readGoldenFolder } from '../testing/golden.node';
import { REPO_ROOT } from '../testing/repo.node';
import { AnimError } from './anim';
import {
  animRefusal,
  MODEL_CODES,
  modelCheck,
  modelFindingText,
  objOf,
  objRefusal,
  splitLocation,
  validLocation,
  type ModelCheckFiles,
  type ModelCode,
} from './modelCheck';
import { modelDeclaration } from './modelParts';
import { ObjError } from './obj';

const FOLDER = `${REPO_ROOT}fixtures/golden/model_check`;

const golden = readGoldenFolder(FOLDER);

interface Input {
  location?: string;
  namespace: string;
  declaration: unknown;
  files?: Record<string, string>;
  present?: string[];
  [location: string]: unknown;
}

/** The file a location names, as Minecraft names it: `namespace:path`, the namespace never left out. */
function fileOf(location: string): string {
  const { namespace, path } = splitLocation(location);
  return `${namespace}:${path}`;
}

/** The case's pack: its files with their text (a key of the input with a colon is one too), and the ones only there. */
function filesOf(input: Input): ModelCheckFiles {
  const texts = new Map<string, string>(Object.entries(input.files ?? {}).map(([location, text]) => [fileOf(location), text]));
  for (const [key, value] of Object.entries(input)) if (key.includes(':')) texts.set(fileOf(key), value as string);
  const present = new Set((input.present ?? []).map(fileOf));
  const textOf = (location: string): string | undefined =>
    validLocation(location) ? (texts.get(fileOf(location)) ?? (present.has(fileOf(location)) ? '' : undefined)) : undefined;
  return {
    valid: validLocation,
    exists: (location) => textOf(location) !== undefined,
    read: (location) => {
      const text = textOf(location);
      return text === undefined ? Promise.reject(new Error(`no file ${location}`)) : Promise.resolve(text);
    },
  };
}

/** What the port makes of an input, laid out as ModelCheckGolden lays the engine's. */
async function compute(input: Input): Promise<unknown> {
  if (input.location !== undefined) return { valid: validLocation(input.location), ...splitLocation(input.location) };
  const findings = await modelCheck(modelDeclaration(input.namespace, input.declaration), filesOf(input));
  return findings.map((f) => ({ severity: f.severity, finding: { code: f.code, subject: null, index: null, params: f.params, text: f.text } }));
}

describe('golden model_check', () => {
  it('names this port in ports.json, and the folder follows the golden format', () => {
    expect(golden.ports).toMatchObject({ reference: 'java', ports: expect.arrayContaining(['ts']) as unknown });
    expect(golden.problems).toEqual([]);
  });

  for (const file of golden.files) {
    describe(file.name, () => {
      for (const c of file.cases) {
        it(c.id, async () => {
          expect(mismatch(await compute(c.input as Input), c.expected, file.tolerance), c.note).toBeNull();
        });
      }
    });
  }
});

// ---- what the golden cases don't reach

describe('modelCheck', () => {
  it('knows the engine’s codes by their keys, in their order, each as bad as there (pack/ModelFinding.java)', () => {
    const java = readFileSync(`${REPO_ROOT}src/main/java/com/muzhik17/trainsmod/pack/ModelFinding.java`, 'utf8');
    const declared = [...java.matchAll(/^ {8}([A-Z_]+)\(PackProblem\.Severity\.(ERROR|WARNING)\)[,;]$/gm)].map(
      ([, name, severity]) => [name!.toLowerCase().replaceAll('_', '-'), severity!.toLowerCase()],
    );
    expect(declared).toHaveLength(17);
    expect(Object.entries(MODEL_CODES)).toEqual(declared);
  });

  it('makes each line of its code and params alone, and every code has its severity', () => {
    const codes = Object.keys(MODEL_CODES) as ModelCode[];
    expect(codes).toHaveLength(17);
    for (const code of codes) expect(modelFindingText(code, {}), code).not.toBe('');
    expect(modelFindingText('untextured-faces', { path: 't:a.obj', materials: 'glass, (none)' })).toBe(
      "model t:a.obj: faces with no texture (map_Kd) aren't drawn, material(s) glass, (none)",
    );
  });

  it('takes every refusal of the OBJ reader for the exception the engine throws there', () => {
    const refusal = (text: string): unknown => {
      const read = objOf('t:a.obj', text);
      return 'finding' in read ? [read.finding.code, read.finding.params] : null;
    };
    expect(refusal('v 0 0 0\nvn 0 1\nf 1//1 1//1 1//1\n')).toEqual(['bad-face-index', { path: 't:a.obj', detail: 'Index 3 out of bounds for length 3' }]);
    expect(refusal('v 0 0 0\nf 1/ 1 +1\n')).toBeNull(); // reads: an empty texture index is none, a sign is a number
    expect(refusal('v 0 0 0\nf 1 1 1/x\n')).toEqual(['unreadable', { path: 't:a.obj', error: 'java.lang.NumberFormatException: For input string: "x"' }]);
    expect(refusal('v 0 0 0\nf 1 1 -2147483648\n')).toEqual(['bad-face-index', { path: 't:a.obj', detail: 'Index 2147483647 out of bounds for length 1' }]);
  });

  it('knows each way ./obj.ts and ./anim.ts word a refusal: a reworded one fails here, not silently in the panel', () => {
    expect(objRefusal('f\n', new ObjError(1, 'something new'))).toEqual({ kind: 'other', detail: 'something new' });
    expect(animRefusal(new AnimError(3, 'something new'))).toBe('something new');
    expect(animRefusal(new AnimError(3, "'\t' is no number"))).toBe('java.lang.NumberFormatException: empty String');
  });
});
