/**
 * Node only (tests): the shared part of the TypeScript golden runners
 * (fixtures/golden/README.md, editor.md §4.5) — what `Golden.java` is to Java and
 * tools/tests/golden.py to Python. Every runner of the editor uses it, and nothing else
 * reads a golden folder or compares with it.
 *
 * A runner is the test next to its port (`ports/<logic>.test.ts`, `core/json/golden.test.ts`…).
 * It declares `const FOLDER = \`${REPO_ROOT}fixtures/golden/<folder>\`` — the meta-test
 * test/golden.meta.test.ts finds it by that line — reads the folder with
 * {@link readGoldenFolder}, checks that `ports.json` names `ts` and that the folder has no
 * {@link GoldenFolder.problems}, and holds what its port makes of each case's input to
 * the case's `expected` with {@link mismatch}. The reference writes `expected`; a port
 * never does.
 */

import Ajv2020 from 'ajv/dist/2020';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GOLDEN_DIR, REPO_ROOT } from './repo.node';

/** The only files a case may read by `input_file`: the example pack (CC0), never MVP. */
const PACK_FILES = 'run/rwat_packs/RwatExamplePack/';
/** The fewest cases a folder may have. */
const MIN_CASES = 10;

export interface GoldenCase {
  id: string;
  note: string;
  /** `input` with what `input_file` reads put in. */
  input: unknown;
  expected: unknown;
}

export interface GoldenFile {
  /** The file's name in its folder (`parse.json`). */
  name: string;
  description: string;
  frame: 'obj' | 'model' | 'none';
  tolerance: number;
  cases: GoldenCase[];
}

export interface GoldenFolder {
  /** `ports.json`: `{reference, ports}`. */
  ports: { reference: string; ports: string[] };
  /** Every case file (`*.json` but `ports.json`), by name. */
  files: GoldenFile[];
  /** What breaks the format (fixtures/golden/schema.json, a second id, too few cases); empty for a sound folder. */
  problems: string[];
}

export interface ReadOptions {
  /**
   * Put the text of an `input_file` into the input as it is, a `.json` one too: for a port
   * to which numbers matter as written (`json_dump`), which `JSON.parse` would lose.
   */
  raw?: boolean;
}

interface RawCase {
  id: string;
  note: string;
  input?: unknown;
  input_file?: string | Record<string, string>;
  expected: unknown;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

/** A file of the example pack a case reads: a `.json` one parsed (unless raw), any other its text. */
function packFile(path: string, raw: boolean): unknown {
  if (!path.startsWith(PACK_FILES) || path.includes('..') || path.includes('\\')) {
    throw new Error(`${path}: a case reads only files of ${PACK_FILES}`);
  }
  const text = readFileSync(`${REPO_ROOT}${path}`, 'utf8');
  return path.endsWith('.json') && !raw ? (JSON.parse(text) as unknown) : text;
}

/** A case's input: `input`, with what `input_file` reads (a string: the whole input; an object: files under its keys). */
function inputOf(c: RawCase, raw: boolean): unknown {
  const files = c.input_file;
  if (files === undefined) return c.input;
  if (typeof files === 'string') return packFile(files, raw);
  const input = { ...((c.input as Record<string, unknown> | undefined) ?? {}) };
  for (const [key, path] of Object.entries(files)) input[key] = packFile(path, raw);
  return input;
}

/**
 * Every case file of a golden folder (an absolute path, `${REPO_ROOT}fixtures/golden/<folder>`),
 * by name, with each case's `input_file` read into its input, and what is wrong with the
 * folder: a file against fixtures/golden/schema.json, a second case of an id, fewer than
 * ten cases.
 */
export function readGoldenFolder(folder: string, options: ReadOptions = {}): GoldenFolder {
  const raw = options.raw === true;
  const ajv = new Ajv2020({ strict: false });
  const valid = ajv.compile(readJson(join(GOLDEN_DIR, 'schema.json')) as object);
  const problems: string[] = [];
  const ids = new Set<string>();
  const files: GoldenFile[] = [];
  for (const name of readdirSync(folder).filter((n) => n.endsWith('.json') && n !== 'ports.json').sort()) {
    const document = readJson(join(folder, name)) as Omit<GoldenFile, 'name' | 'cases'> & { cases: RawCase[] };
    if (!valid(document)) problems.push(`${name}: ${ajv.errorsText(valid.errors)}`);
    const cases = document.cases.map((c) => {
      if (ids.has(c.id)) problems.push(`${name}: a second case ${c.id}`);
      ids.add(c.id);
      return { id: c.id, note: c.note, input: inputOf(c, raw), expected: c.expected };
    });
    files.push({ name, description: document.description, frame: document.frame, tolerance: document.tolerance, cases });
  }
  if (ids.size < MIN_CASES) problems.push(`${ids.size} cases, at least ${MIN_CASES}`);
  const ports = readJson(join(folder, 'ports.json')) as GoldenFolder['ports'];
  return { ports, files, problems };
}

// ---------------------------------------------------------------- values

const NON_FINITE: Record<string, number> = { NaN: NaN, Infinity: Infinity, '-Infinity': -Infinity };

/** A number of a case: a JSON number, or `"NaN"`, `"Infinity"`, `"-Infinity"` (`Golden.toDouble`). */
export function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value in NON_FINITE) return NON_FINITE[value] as number;
  throw new Error(`no number of a golden case: ${JSON.stringify(value)}`);
}

/** A number as the cases write it: NaN and the infinities by name (`Golden.number`, golden.py `number`). */
export function goldenNumber(x: number): number | string {
  if (Number.isNaN(x)) return 'NaN';
  if (!Number.isFinite(x)) return x > 0 ? 'Infinity' : '-Infinity';
  return x;
}

/** A float by its shortest decimal, as the cases write one (`Golden.number(float)`): `Math.fround(0.1)` is 0.1. */
export function shortestFloat(f: number): number {
  for (let digits = 1; digits <= 9; digits++) {
    const decimal = Number(f.toPrecision(digits));
    if (Math.fround(decimal) === f) return decimal;
  }
  return f;
}

// ---------------------------------------------------------------- comparing

function show(value: unknown): string {
  return typeof value === 'number' ? String(value) : (JSON.stringify(value) ?? String(value));
}

/**
 * Where `actual` (a port's value) differs from `expected` (a golden value), as
 * `<path>: expected …, got …` of the first difference, or null if it matches — as
 * tools/tests/golden.py `close` compares (fixtures/golden/README.md, "Как сверять"):
 *
 * - a number within `tolerance` of the expected, and finite (a zero's sign is not
 *   compared: the reference writes it only where a text shows it);
 * - `"NaN"`, `"Infinity"`, `"-Infinity"` match those numbers and the same string;
 * - strings, booleans and null exactly (null is not NaN);
 * - arrays element by element (a typed array as its elements);
 * - objects with the same keys in the same order (a Map by its entries, in order).
 */
export function mismatch(actual: unknown, expected: unknown, tolerance: number, path = '$'): string | null {
  const differ = (): string => `${path}: expected ${show(expected)}, got ${show(actual)}`;
  if (typeof expected === 'string' && expected in NON_FINITE) {
    const special = NON_FINITE[expected] as number;
    if (actual === expected || (typeof actual === 'number' && (Number.isNaN(special) ? Number.isNaN(actual) : actual === special))) return null;
    return differ();
  }
  if (typeof expected === 'number') {
    return typeof actual === 'number' && Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance ? null : differ();
  }
  if (expected === null || typeof expected !== 'object') return actual === expected ? null : differ();
  if (Array.isArray(expected)) {
    const items = Array.isArray(actual) || ArrayBuffer.isView(actual) ? Array.from(actual as ArrayLike<unknown>) : null;
    if (items === null || items.length !== expected.length) return differ();
    for (let i = 0; i < expected.length; i++) {
      const found = mismatch(items[i], expected[i], tolerance, `${path}[${i}]`);
      if (found !== null) return found;
    }
    return null;
  }
  const entries =
    actual instanceof Map
      ? [...(actual as Map<unknown, unknown>)]
      : actual !== null && typeof actual === 'object' && !Array.isArray(actual) && !ArrayBuffer.isView(actual)
        ? Object.entries(actual)
        : null;
  const wanted = Object.entries(expected as Record<string, unknown>);
  if (entries === null) return differ();
  const keys = entries.map(([key]) => String(key));
  const wantedKeys = wanted.map(([key]) => key);
  if (keys.join('\u0000') !== wantedKeys.join('\u0000')) return `${path}: expected the keys [${wantedKeys.join(', ')}], got [${keys.join(', ')}]`;
  for (let i = 0; i < wanted.length; i++) {
    const [key, value] = wanted[i]!;
    const found = mismatch(entries[i]![1], value, tolerance, `${path}.${key}`);
    if (found !== null) return found;
  }
  return null;
}
