/**
 * Node only (tests): the shared part of the golden runners of ports/obj, mtl, anim,
 * pivotAxis and lampIslands (fixtures/golden/README.md, editor.md §4.5) — what
 * tools/tests/golden.py is to Python:
 *
 * - {@link readGoldenFolder}: every case file of a folder (`*.json` but `ports.json`, by
 *   name), its `input_file` read into the input (the example pack only: `.json` as JSON,
 *   anything else as text), and what is wrong with the folder against
 *   fixtures/golden/schema.json, unique ids and the fewest cases;
 * - {@link mismatch}: a port's value against the expected — numbers within the file's
 *   tolerance, `"NaN"`, `"Infinity"`, `"-Infinity"` as those numbers, strings, booleans
 *   and null exactly, objects key by key in order (a Map by its entries), arrays and
 *   typed arrays element by element.
 *
 * The other runners of M2 have the same needs: this is to become one helper with
 * goldenCompare.node.ts.
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
  name: string;
  description: string;
  frame: 'obj' | 'model' | 'none';
  tolerance: number;
  cases: GoldenCase[];
}

export interface GoldenFolder {
  /** `ports.json`: `{reference, ports}`. */
  ports: { reference: string; ports: string[] };
  files: GoldenFile[];
  /** What breaks the format (schema, ids, size); empty for a sound folder. */
  problems: string[];
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

function packFile(path: string): unknown {
  if (!path.startsWith(PACK_FILES) || path.includes('..') || path.includes('\\')) {
    throw new Error(`${path}: a case reads only files of ${PACK_FILES}`);
  }
  const text = readFileSync(`${REPO_ROOT}${path}`, 'utf8');
  return path.endsWith('.json') ? (JSON.parse(text) as unknown) : text;
}

function inputOf(c: RawCase): unknown {
  const files = c.input_file;
  if (files === undefined) return c.input;
  if (typeof files === 'string') return packFile(files);
  const input = { ...((c.input as Record<string, unknown> | undefined) ?? {}) };
  for (const [key, path] of Object.entries(files)) input[key] = packFile(path);
  return input;
}

/** Every case file of `fixtures/golden/<folder>` (an absolute path), checked and with its inputs read. */
export function readGoldenFolder(folder: string): GoldenFolder {
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
      return { id: c.id, note: c.note, input: inputOf(c), expected: c.expected };
    });
    files.push({ name, description: document.description, frame: document.frame, tolerance: document.tolerance, cases });
  }
  if (ids.size < MIN_CASES) problems.push(`${ids.size} cases, at least ${MIN_CASES}`);
  const ports = readJson(join(folder, 'ports.json')) as GoldenFolder['ports'];
  return { ports, files, problems };
}

const SPECIAL: Record<string, number> = { NaN: NaN, Infinity: Infinity, '-Infinity': -Infinity };

function show(value: unknown): string {
  return typeof value === 'number' ? String(value) : (JSON.stringify(value) ?? String(value));
}

/**
 * Where `actual` differs from `expected` (a golden value), or null if it matches: the
 * first difference, as `at <path>: expected …, got …`.
 */
export function mismatch(actual: unknown, expected: unknown, tolerance: number, path = ''): string | null {
  const differ = (): string => `at ${path === '' ? '(top)' : path}: expected ${show(expected)}, got ${show(actual)}`;
  if (typeof expected === 'number') {
    return typeof actual === 'number' && Math.abs(actual - expected) <= tolerance ? null : differ();
  }
  if (typeof expected === 'string' && expected in SPECIAL) {
    const special = SPECIAL[expected]!;
    if (actual === expected || (typeof actual === 'number' && (Number.isNaN(special) ? Number.isNaN(actual) : actual === special))) return null;
    return differ();
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
  const entries = actual instanceof Map ? [...(actual as Map<unknown, unknown>)] : actual !== null && typeof actual === 'object' && !Array.isArray(actual) ? Object.entries(actual) : null;
  const wanted: [string, unknown][] = Object.entries(expected as Record<string, unknown>);
  if (entries === null || entries.map(([key]) => key).join('\u0000') !== wanted.map(([key]) => key).join('\u0000')) return differ();
  for (let i = 0; i < wanted.length; i++) {
    const [key, value] = wanted[i]!;
    const found = mismatch(entries[i]![1], value, tolerance, `${path}.${key}`);
    if (found !== null) return found;
  }
  return null;
}
