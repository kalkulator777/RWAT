/**
 * Golden runner of fixtures/golden/cab_area/ (editor.md §4.5; fixtures/golden/README.md):
 * ./cabArea against `kinematics/CabArea.java`, the reference that writes the expected —
 * a type as the pack writes it (OBJ frame) → its driver's cabs: the cab of each chair and
 * of each piece of the floor, the doors that want the key, the passengers' side doors,
 * and the answers to the case's questions, asked in the model frame.
 */

import Ajv2020 from 'ajv/dist/2020';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../testing/repo.node';
import { NO_CAB_AREA, cabArea, facing, leftSide, passengerSideDoors } from './cabArea';
import { PLAYER_HALF_WIDTH } from './riderWalk';
import { type Seat, parseWagonType } from './wagonType';

const FOLDER = `${REPO_ROOT}fixtures/golden/cab_area`;

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

describe('golden cab_area', () => {
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

// ---- what the port makes of an input, laid out as CabAreaGolden lays the engine's

interface Input {
  type: unknown;
  cab_at?: number[][];
  nearest_chair?: number[][];
  cab_door?: number[];
  facing?: [boolean, number][];
  left_side?: [boolean, number][];
}

function compute(input: Input): unknown {
  const type = parseWagonType('golden:cab', input.type);
  const area = cabArea(type);
  const seats = type.cab?.seats ?? [];
  const shut = type.interior?.region(PLAYER_HALF_WIDTH, type.doors, 0);
  const ask = <Q, T>(questions: Q[] | undefined, answer: (q: Q) => T): T[] => (questions ?? []).map(answer);
  return {
    cabs: area.cabs(),
    cab_of_chair: seats.map((_, c) => area.cabOfChair(c)),
    cab_of_piece: (shut?.pieces ?? []).map((p) => area.cabAt((p.minX + p.maxX) * 0.5, (p.minZ + p.maxZ) * 0.5)),
    cab_doors: area.cabDoors,
    passenger_side_doors: [passengerSideDoors(type, 1), passengerSideDoors(type, -1)],
    cab_at: ask(input.cab_at, ([x = NaN, z = NaN]) => area.cabAt(x, z)),
    nearest_chair: ask(input.nearest_chair, ([cab = -1, x = NaN, z = NaN]) => area.nearestChair(cab, x, z)),
    cab_door: ask(input.cab_door, (index) => area.cabDoor(index)),
    facing: ask(input.facing, ([flipped, chair]) => facing(flipped, chair < 0 ? null : (seats[chair] as Seat))),
    left_side: ask(input.left_side, ([flipped, ahead]) => leftSide(flipped, ahead)),
  };
}

// ---- what the golden cases don't reach

describe('cabArea', () => {
  const type = {
    length: 16,
    bogies: [5, -5],
    mass_t: 90,
    cab: { seats: [{ at: [-6.5, 2.2, 0.5] }] },
    interior: [{ min: [-7.5, 1.4, -1.4], max: [7.5, 3.9, 1.4] }],
  };

  it('makes the cabs of a type once', () => {
    const parsed = parseWagonType('x', type);
    expect(cabArea(parsed)).toBe(cabArea(parsed));
    expect(cabArea(parseWagonType('x', type))).not.toBe(cabArea(parsed));
  });

  it('has no cab for no type, and none of its own on a car without one', () => {
    expect(cabArea(null)).toBe(NO_CAB_AREA);
    expect(NO_CAB_AREA.region).toBeNull();
    expect(NO_CAB_AREA.cabAt(0, 0)).toBe(-1);
    expect(NO_CAB_AREA.cabOfChair(0)).toBe(-1);
    expect(NO_CAB_AREA.cabOfChair(-1)).toBe(-1);
    expect(NO_CAB_AREA.cabs()).toBe(0);
  });
});
