/**
 * Node only (tests): how a port's golden runner reads a folder of fixtures/golden/ and
 * compares a result with the `expected` (fixtures/golden/README.md, "Как сверять").
 * Used by the runners in ports/; the reference writes `expected`, a port never does.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface GoldenCase {
  id: string;
  note: string;
  input: unknown;
  expected: unknown;
}

export interface GoldenFile {
  name: string;
  tolerance: number;
  cases: GoldenCase[];
}

/** Every `*.json` of a golden folder except `ports.json`, by name; empty if the folder is missing. */
export function readGoldenFolder(folder: string): GoldenFile[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((name) => name.endsWith('.json') && name !== 'ports.json')
    .sort()
    .map((name) => {
      const file = JSON.parse(readFileSync(join(folder, name), 'utf8')) as { tolerance?: number; cases: GoldenCase[] };
      return { name, tolerance: file.tolerance ?? 0, cases: file.cases };
    });
}

/** The `ports.json` of a golden folder. */
export function readGoldenPorts(folder: string): { reference: string; ports: string[] } {
  return JSON.parse(readFileSync(join(folder, 'ports.json'), 'utf8')) as { reference: string; ports: string[] };
}

const SPECIAL: Record<string, number> = { NaN: NaN, Infinity: Infinity, '-Infinity': -Infinity };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Where `actual` differs from `expected`, as a path and a reason, or null if it matches:
 * numbers within `tolerance` (zero: exactly, a minus zero apart from a zero); the strings
 * `"NaN"`, `"Infinity"`, `"-Infinity"` of the file stand for those numbers (and match the
 * same string); strings, booleans and null exactly (null is not NaN); arrays element by
 * element; objects with the same keys in the same order.
 */
export function mismatch(actual: unknown, expected: unknown, tolerance: number, path = '$'): string | null {
  if (typeof expected === 'string' && expected in SPECIAL) {
    if (actual === expected) return null;
    const want = SPECIAL[expected] as number;
    if (typeof actual === 'number' && (Number.isNaN(want) ? Number.isNaN(actual) : actual === want)) return null;
    return `${path}: expected ${expected}, got ${JSON.stringify(actual)}`;
  }
  if (typeof expected === 'number') {
    if (typeof actual !== 'number') return `${path}: expected ${expected}, got ${JSON.stringify(actual)}`;
    if (Number.isNaN(actual) || Number.isNaN(expected)) return `${path}: expected ${expected}, got ${actual}`;
    if (tolerance === 0 ? Object.is(actual, expected) : Math.abs(actual - expected) <= tolerance) return null;
    return `${path}: expected ${expected}, got ${actual}`;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return `${path}: expected an array of ${expected.length}, got ${JSON.stringify(actual)}`;
    for (let i = 0; i < expected.length; i++) {
      const found = mismatch(actual[i], expected[i], tolerance, `${path}[${i}]`);
      if (found !== null) return found;
    }
    return null;
  }
  if (isObject(expected)) {
    if (!isObject(actual)) return `${path}: expected an object, got ${JSON.stringify(actual)}`;
    const want = Object.keys(expected);
    const got = Object.keys(actual);
    if (want.join(',') !== got.join(',')) return `${path}: expected keys [${want.join(', ')}], got [${got.join(', ')}]`;
    for (const key of want) {
      const found = mismatch(actual[key], expected[key], tolerance, `${path}.${key}`);
      if (found !== null) return found;
    }
    return null;
  }
  return actual === expected ? null : `${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
}
