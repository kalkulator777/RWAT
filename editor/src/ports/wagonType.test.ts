/**
 * Golden runner of fixtures/golden/wagon_type/ (editor.md §4.5; fixtures/golden/README.md):
 * ./wagonType against `stock/WagonTypeParser.java` and `stock/WagonType.java`, the
 * reference that writes the expected — a type as the pack writes it (OBJ frame) → its
 * error and warnings as findings (only their text yet), the type in the model frame,
 * and the answers to the case's questions about its doors and floor.
 */

import Ajv2020 from 'ajv/dist/2020';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../testing/repo.node';
import { PLAYER_HALF_WIDTH } from './riderWalk';
import {
  Door,
  Interior,
  Seat,
  WagonType,
  WagonTypeError,
  Zone,
  aliases,
  describe as describeValue,
  equalsIgnoreCase,
  javaDoubleToString,
  loadWagonType,
  nearestKey,
  parseWagonType,
} from './wagonType';

const FOLDER = `${REPO_ROOT}fixtures/golden/wagon_type`;

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

describe('golden wagon_type', () => {
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

// ---- what the port makes of an input, laid out as WagonTypeGolden lays the engine's

interface Input {
  type: unknown;
  open?: number;
  door_holding?: number[][];
  doors_worked_by?: string[];
  doors_opened_with?: number[];
  door_open?: number[][];
  floor_at?: number[][];
  clamp_feet?: number[][];
}

/** A number as the cases write it: NaN and the infinities by name. */
function num(x: number): number | string {
  if (Number.isNaN(x)) return 'NaN';
  if (!Number.isFinite(x)) return x > 0 ? 'Infinity' : '-Infinity';
  return x;
}

/** A float by its shortest decimal, as the cases write one (`Golden.number(float)`): 0.1F is 0.1. */
function shortestFloat(f: number): number {
  for (let digits = 1; digits <= 9; digits++) {
    const decimal = Number(f.toPrecision(digits));
    if (Math.fround(decimal) === f) return decimal;
  }
  return f;
}

/** A loader's message as a finding: only its text yet. */
function finding(text: string): unknown {
  return { code: null, subject: null, index: null, params: {}, text };
}

function typeOut(t: WagonType): unknown {
  const hull = t.collidableHull();
  return {
    length: t.length,
    bogies: t.bogieOffsets,
    mass_t: t.massT,
    max_speed_kmh: t.maxSpeedKmh,
    resistance: { a: t.resistance.a, b: t.resistance.b, c: t.resistance.c, c_front: t.resistance.cFront },
    traction:
      t.traction === null
        ? null
        : {
            power_kw: t.traction.powerKw,
            max_tractive_effort_kn: t.traction.maxTractiveEffortKn,
            adhesion: t.traction.adhesion,
            ramp_s: t.traction.rampS,
          },
    cab:
      t.cab === null
        ? null
        : { seats: t.cab.seats.map((s) => ({ at: [s.x, s.y, s.z], yaw: shortestFloat(s.yaw), faces_back: s.facesBack() })) },
    brakes: {
      train_kn: t.brakes.trainKn,
      independent_kn: t.brakes.independentKn,
      dynamic_kn: t.brakes.dynamicKn,
      dynamic_fade_kmh: t.brakes.dynamicFadeKmh,
      parking_kn: t.brakes.parkingKn,
      apply_s: t.brakes.applyS,
      release_s: t.brakes.releaseS,
    },
    interior:
      t.interior === null
        ? null
        : { zones: t.interior.zones.map((z) => [z.minX, z.minY, z.minZ, z.maxX, z.maxY, z.maxZ]), floor_y: t.interior.floorY() },
    doors: t.doors.map((d) => ({
      id: d.id,
      box: [d.minX, d.minY, d.minZ, d.maxX, d.maxY, d.maxZ],
      inner: d.inner,
      fixed: d.fixed,
      connecting: d.connecting,
      group: d.group,
      external: d.external(),
      axis: d.axis(),
      outward: d.outward(),
      inner_face: d.innerFace(),
      outer_face: d.outerFace(),
      span: [d.spanMin(), d.spanMax()],
    })),
    couplers: { front: t.couplers.front, rear: t.couplers.rear, reach: [t.couplerReach(true), t.couplerReach(false)] },
    hull: [hull.minX, hull.minY, hull.minZ, hull.maxX, hull.maxY, hull.maxZ],
    powered: t.powered(),
    drivable: t.drivable(),
    boardable: t.boardable(),
    doors_only: t.doorsOnly(),
    wheelbase: t.wheelbase(),
    leaf_doors: t.leafDoors(),
  };
}

function answersOut(t: WagonType, input: Input): unknown {
  const open = input.open ?? 0;
  const interior = (): Interior => t.interior as Interior;
  const ask = <Q, T>(questions: Q[] | undefined, answer: (q: Q) => T): T[] => (questions ?? []).map(answer);
  return {
    door_holding: ask(input.door_holding, ([x = NaN, y = NaN, z = NaN]) => t.doorHolding(x, y, z)),
    doors_worked_by: ask(input.doors_worked_by, (group) => t.doorsWorkedBy(group)),
    doors_opened_with: ask(input.doors_opened_with, (index) => t.doorsOpenedWith(index)),
    door_open: ask(input.door_open, ([mask = 0, index = 0]) => (t.doors[index] as Door).open(mask, index)),
    floor_at: ask(input.floor_at, ([x = NaN, z = NaN]) => num(interior().floorAt(x, z, PLAYER_HALF_WIDTH))),
    clamp_feet: ask(input.clamp_feet, (p) => interior().clampFeet(p, PLAYER_HALF_WIDTH, t.doors, open)),
  };
}

function compute(input: Input): unknown {
  const warnings: unknown[] = [];
  let type: WagonType;
  try {
    type = parseWagonType('golden:type', input.type, (w) => warnings.push(finding(w)));
  } catch (e) {
    if (!(e instanceof WagonTypeError)) throw e;
    return { error: finding(e.message), warnings, type: null, answers: null };
  }
  return { error: null, warnings, type: typeOut(type), answers: answersOut(type, input) };
}

// ---- what the golden cases don't reach

describe('wagonType', () => {
  const minimal = { length: 25.0, bogies: [8.5, -8.5], mass_t: 50.0 };

  it('writes doubles as Java does', () => {
    expect(javaDoubleToString(0.4)).toBe('0.4');
    expect(javaDoubleToString(1)).toBe('1.0');
    expect(javaDoubleToString(100)).toBe('100.0');
    expect(javaDoubleToString(0.001)).toBe('0.001');
    expect(javaDoubleToString(0.0001)).toBe('1.0E-4');
    expect(javaDoubleToString(1e-5)).toBe('1.0E-5');
    expect(javaDoubleToString(9999999)).toBe('9999999.0');
    expect(javaDoubleToString(1e7)).toBe('1.0E7');
    expect(javaDoubleToString(-12345678.9)).toBe('-1.23456789E7');
    expect(javaDoubleToString(-0)).toBe('-0.0');
    expect(javaDoubleToString(0)).toBe('0.0');
    expect(javaDoubleToString(NaN)).toBe('NaN');
    expect(javaDoubleToString(-Infinity)).toBe('-Infinity');
    expect(javaDoubleToString(Infinity)).toBe('Infinity');
  });

  it('says what the loader says of a file that is not an object', () => {
    expect(() => parseWagonType('x', [1])).toThrow("the file must be a JSON object {…}, got an array");
    expect(loadWagonType('x', 'text')).toEqual({
      type: null,
      aliases: [],
      error: 'the file must be a JSON object {…}, got the string "text"',
      warnings: [],
    });
  });

  it('loads a type with its aliases, and fails on aliases that are not a list of strings', () => {
    const loaded = loadWagonType('x', { ...minimal, aliases: ['ns:old'], colour: 1 });
    expect(loaded.type?.id).toBe('x');
    expect(loaded.aliases).toEqual(['ns:old']);
    expect(loaded.warnings).toEqual(["unknown key 'colour' (ignored)"]);
    expect(loadWagonType('x', { ...minimal, aliases: [1] }).error).toBe("'aliases[0]' must be a string, got the number 1");
    expect(aliases(null)).toEqual([]);
    expect(aliases(minimal)).toEqual([]);
    expect(() => loadWagonType('x', { get length(): number { throw new TypeError('not the parser'); } })).toThrow(TypeError);
  });

  it('describes values as the engine does', () => {
    expect(describeValue(undefined)).toBe('nothing');
    expect(describeValue(true)).toBe('true');
    expect(describeValue(-0)).toBe('the number -0');
    expect(describeValue({})).toBe('an object');
    expect(describeValue('x'.repeat(41))).toBe(`the string "${'x'.repeat(40)}…"`);
    expect(() => parseWagonType('x', { ...minimal, cab: true })).toThrow("'cab' must be an object, got true");
    expect(() => parseWagonType('x', { ...minimal, doors: [{ id: 1 }] })).toThrow("'doors[0].id' must be a string, got the number 1");
    expect(() => parseWagonType('x', { ...minimal, doors: {} })).toThrow("'doors' must be an array, got an object");
    expect(() => parseWagonType('x', { ...minimal, doors: [{ id: 'd', min: [0, 1, 1.4], max: [1, 3, 1.5], group: 5 }] })).toThrow(
      "'doors[0].group' must be a string, got the number 5",
    );
    expect(() => parseWagonType('x', { ...minimal, brakes: { system: 1 } })).toThrow("'brakes.system' must be a string, got the number 1");
  });

  it('hints the nearest known key', () => {
    expect(nearestKey('livery', ['liveries'])).toBe('liveries');
    expect(nearestKey('ab', ['a', 'ab', 'abc'])).toBe('ab');
    expect(nearestKey('AB', ['ab'])).toBe('ab');
    expect(nearestKey('xy', ['ab'])).toBeNull();
    expect(nearestKey('cfront', ['c_front'])).toBe('c_front');
    expect(nearestKey('max_tractive', ['max_tractive_effort_kn'])).toBe('max_tractive_effort_kn');
    expect(nearestKey('maxx_tractive_effort_kn', ['max_tractive_effort_kn'])).toBe('max_tractive_effort_kn');
    expect(nearestKey('aplpy_s', ['apply_s'])).toBe('apply_s');
  });

  it('matches names case aside as Java does', () => {
    expect(equalsIgnoreCase('DoorsL', 'doorsl')).toBe(true);
    expect(equalsIgnoreCase('a', null)).toBe(false);
    expect(equalsIgnoreCase('a', 'ab')).toBe(false);
    expect(equalsIgnoreCase('Ǆ', 'ǆ')).toBe(true); // a letter with a title case
    expect(equalsIgnoreCase('ß', 'SS')).toBe(false); // no one-letter upper case
    expect(equalsIgnoreCase('a😀', 'A😀')).toBe(true);
    expect(equalsIgnoreCase('😀a', '😁a')).toBe(false);
  });

  it('mirrors a floor, a door and a chair for a flipped wagon', () => {
    const interior = new Interior([new Zone(-1, 2, -5, 1, 4, 3)]);
    expect(interior.inFrame(false)).toBe(interior);
    const mirrored = interior.inFrame(true);
    expect(mirrored.zones[0]).toEqual(new Zone(-1, 2, -3, 1, 4, 5));
    expect(interior.inFrame(true)).toBe(mirrored);
    expect(mirrored.inFrame(true)).toBe(interior);
    expect([interior.minX(), interior.minZ(), interior.maxX(), interior.maxZ()]).toEqual([-1, -5, 1, 3]);
    expect(() => new Interior([])).toThrow(RangeError);
    const door = new Door('d', 1.4, 2, 6, 1.5, 4, 7, true, false, false, '');
    expect(door.group).toBeNull();
    expect(door.inFrame(false)).toBe(door);
    expect(door.inFrame(true)).toEqual(new Door('d', -1.5, 2, -7, -1.4, 4, -6, true, false, false, null));
    const seat = new Seat(0.5, 2, 7, 10);
    expect(seat.inFrame(false)).toBe(seat);
    expect(seat.inFrame(true)).toEqual(new Seat(-0.5, 2, -7, 190));
  });

  it('keeps the shut-door regions apart and forgets them past a limit', () => {
    const type = parseWagonType('x', {
      ...minimal,
      interior: [
        { min: [-10, 1.37375, -1.4], max: [0, 3.87375, 1.4] },
        { min: [0, 1.37375, -1.4], max: [10, 3.87375, 1.4] },
      ],
      doors: [{ id: 'inner', min: [-0.05, 1.37375, -0.5], max: [0.05, 3.47375, 0.5], inner: true }],
    });
    const interior = type.interior as Interior;
    const shut = interior.region(0.3, type.doors, 0);
    expect(interior.region(0.3, type.doors, 0)).toBe(shut);
    expect(interior.region(0.3, type.doors, 1)).toBe(interior.region(0.3));
    for (let i = 0; i < 70; i++) interior.region(0.3 + i * 1e-3, type.doors, 0);
    expect(interior.region(0.3, type.doors, 0)).not.toBe(shut);
    expect(interior.region(0.3, type.doors, 0).pieces).toEqual(shut.pieces);
    expect(interior.clampFeet([0, 0, 0], 0.3)).toEqual(interior.clampFeet([0, 0, 0], 0.3, [], 0));
  });
});
