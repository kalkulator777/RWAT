/**
 * Golden runner of fixtures/golden/floor_region/ (editor.md §4.5; fixtures/golden/README.md):
 * ./floorRegion, by ./wagonType's `Interior.region`, against `stock/FloorRegion.java`,
 * the reference that writes the expected — where a rider's centre fits on a type's floor
 * with some doors open (pieces, cuts, links) and the answers to the case's questions,
 * all in the model frame.
 */

import Ajv2020 from 'ajv/dist/2020';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../testing/repo.node';
import { Cut, FloorRegion, Piece, compareDoubles } from './floorRegion';
import { PLAYER_HALF_WIDTH } from './riderWalk';
import { Door, type Interior, Zone, parseWagonType } from './wagonType';

const FOLDER = `${REPO_ROOT}fixtures/golden/floor_region`;

// ---- the golden case files (one copy per runner until a shared helper takes them over)

interface Case {
  id: string;
  note: string;
  input?: unknown;
  input_file?: string | Record<string, string>;
  expected: unknown;
}

interface CaseFile {
  tolerance: number;
  cases: Case[];
}

const NON_FINITE: Record<string, number> = { NaN: NaN, Infinity: Infinity, '-Infinity': -Infinity };

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

const files = readdirSync(FOLDER)
  .filter((name) => name.endsWith('.json') && name !== 'ports.json')
  .sort();

/** First place where `actual` differs from `expected` (numbers within `tol`, non-finite ones by name), or null. */
function mismatch(actual: unknown, expected: unknown, tol: number, path = '$'): string | null {
  const fail = `${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
  if (typeof expected === 'string' && expected in NON_FINITE) {
    return Object.is(actual, NON_FINITE[expected]) || actual === expected ? null : fail;
  }
  if (typeof expected === 'number') {
    return typeof actual === 'number' && Number.isFinite(actual) && Math.abs(actual - expected) <= tol ? null : fail;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return fail;
    for (let i = 0; i < expected.length; i++) {
      const found = mismatch(actual[i], expected[i], tol, `${path}[${i}]`);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof expected === 'object' && expected !== null) {
    if (typeof actual !== 'object' || actual === null || Array.isArray(actual)) return fail;
    const keys = Object.keys(expected);
    if (JSON.stringify(Object.keys(actual)) !== JSON.stringify(keys)) return `${path}: keys ${JSON.stringify(Object.keys(actual))}, expected ${JSON.stringify(keys)}`;
    for (const key of keys) {
      const found = mismatch((actual as Record<string, unknown>)[key], (expected as Record<string, unknown>)[key], tol, `${path}.${key}`);
      if (found !== null) return found;
    }
    return null;
  }
  return actual === expected ? null : fail;
}

/** A case's input: `input`, with the example pack's files `input_file` names under their keys. */
function caseInput(c: Case): unknown {
  const read = (path: string): unknown => {
    const text = readFileSync(`${REPO_ROOT}${path}`, 'utf8');
    return path.endsWith('.json') ? (JSON.parse(text) as unknown) : text;
  };
  if (typeof c.input_file === 'string') return read(c.input_file);
  const input = { ...(c.input as Record<string, unknown> | undefined) };
  for (const [key, path] of Object.entries(c.input_file ?? {})) input[key] = read(path);
  return input;
}

describe('golden floor_region', () => {
  it('names this port in ports.json, every file follows the golden schema, and there are enough cases', () => {
    expect(readJson(`${FOLDER}/ports.json`)).toMatchObject({ reference: 'java', ports: expect.arrayContaining(['ts']) as unknown });
    const ajv = new Ajv2020({ strict: false });
    const valid = ajv.compile(readJson(`${REPO_ROOT}fixtures/golden/schema.json`) as object);
    let cases = 0;
    for (const name of files) {
      const document = readJson(`${FOLDER}/${name}`);
      expect(valid(document), `${name}: ${ajv.errorsText(valid.errors)}`).toBe(true);
      cases += (document as CaseFile).cases.length;
    }
    expect(cases).toBeGreaterThanOrEqual(10);
  });

  for (const name of files) {
    const file = readJson(`${FOLDER}/${name}`) as CaseFile;
    describe(name, () => {
      for (const c of file.cases) {
        it(c.id, () => {
          expect(mismatch(compute(caseInput(c) as Input), c.expected, file.tolerance), c.note).toBeNull();
        });
      }
    });
  }
});

// ---- what the port makes of an input, laid out as FloorRegionGolden lays the engine's

interface Input {
  type: unknown;
  margin?: number;
  open?: number;
  fits?: number[][];
  nearest?: number[][];
  floor?: number[][];
  reach?: number[][];
}

/** A number as the cases write it: NaN and the infinities by name. */
function num(x: number): number | string {
  if (Number.isNaN(x)) return 'NaN';
  if (!Number.isFinite(x)) return x > 0 ? 'Infinity' : '-Infinity';
  return x;
}

function compute(input: Input): unknown {
  const type = parseWagonType('golden:floor', input.type);
  const margin = input.margin ?? PLAYER_HALF_WIDTH;
  const interior = type.interior as Interior;
  const region = interior.region(margin, type.doors, input.open ?? 0);
  const ask = <T>(questions: number[][] | undefined, answer: (q: number[]) => T): T[] => (questions ?? []).map(answer);
  return {
    pieces: region.pieces.map((p) => [p.minX, p.minZ, p.maxX, p.maxZ]),
    cuts: region.cuts.map((c) => [c.minX, c.minZ, c.maxX, c.maxZ]),
    links: region.links(),
    fits: ask(input.fits, ([x = NaN, z = NaN]) => region.fits(x, z)),
    nearest: ask(input.nearest, ([x = NaN, z = NaN]) => region.nearest(x, z)),
    floor: ask(input.floor, ([x = NaN, z = NaN]) => num(interior.floorAt(x, z, margin))),
    reach: ask(input.reach, ([x = NaN, z = NaN, axis = 0, dir = 0]) => num(region.reach(x, z, axis, dir))),
  };
}

// ---- what the golden cases don't reach

describe('floorRegion', () => {
  const zone = (minX: number, minZ: number, maxX: number, maxZ: number): Zone => new Zone(minX, 0, minZ, maxX, 1, maxZ);

  it('takes no margin that is not positive', () => {
    expect(() => FloorRegion.of([zone(-1, -1, 1, 1)], 0)).toThrow(RangeError);
    expect(() => FloorRegion.of([zone(-1, -1, 1, 1)], NaN)).toThrow(RangeError);
  });

  it('has no pieces without zones', () => {
    const region = FloorRegion.of([], 0.3);
    expect(region.pieces).toEqual([]);
    expect(region.fits(0, 0)).toBe(false);
    expect(region.nearest(0, 0)).toBeNull();
  });

  it('sorts a negative zero before a zero, as Java does', () => {
    expect([0, -0, -1].sort(compareDoubles).map((v) => Object.is(v, -0))).toEqual([false, true, false]);
    expect(compareDoubles(-0, 0)).toBe(-1);
    expect(compareDoubles(0, -0)).toBe(1);
    expect(compareDoubles(0, 0)).toBe(0);
  });

  it('crosses a cut only through its inside', () => {
    const cut = new Cut(-0.05, -1, 0.05, 1);
    expect(cut.crossed(-1, 0, 1, 0)).toBe(true);
    expect(cut.crossed(-1, 1, 1, 1)).toBe(false); // along a face
    expect(cut.crossed(0, -2, 0, -1.5)).toBe(false); // short of it
    expect(cut.crossed(0, 0, 0, 0)).toBe(true); // standing in it
    expect(new Cut(0, 0, 0, 1).crossed(-1, 0.5, 1, 0.5)).toBe(false); // no inside at all
  });

  it('cuts a door thinner than a centimetre a centimetre thick (Java: Cut.shut in jshell)', () => {
    expect(Cut.shut(new Door('d', -0.5, 1.8, 4.998, 0.5, 3.8, 5.002), 0.3)).toEqual(new Cut(-0.8, 4.995, 0.8, 5.005));
    expect(Cut.shut(new Door('s', 1.0, 1.8, -2.0, 1.003, 3.8, -1.0), 0.3)).toEqual(new Cut(0.9965, -2.3, 1.0065, -0.7));
  });

  it('keeps a cut that takes something out, and only that one', () => {
    const region = FloorRegion.of([zone(-2, -2, 2, 2)], 0.3, [new Cut(-0.05, -3, 0.05, 3), new Cut(5, 5, 6, 6)]);
    expect(region.cuts).toEqual([new Cut(-0.05, -3, 0.05, 3)]);
    expect(region.fits(0, 0)).toBe(false);
    expect(region.fits(0.06, 0)).toBe(true);
    expect(region.throughCut(-1, 0, 1, 0)).toBe(true);
    expect(region.throughCut(0.5, -1, 0.5, 1)).toBe(false);
    expect(new Piece(0, 0, 1, 1).touches(1, 1, 2, 2)).toBe(true);
  });
});
