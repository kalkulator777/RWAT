/**
 * Golden runner of fixtures/golden/wagon_type/ (editor.md §4.5; fixtures/golden/README.md):
 * ./wagonType against `stock/WagonTypeParser.java` and `stock/WagonType.java`, the
 * reference that writes the expected — a type as the pack writes it (OBJ frame) → its
 * error and warnings as findings (only their text yet), the type in the model frame,
 * and the answers to the case's questions about its doors and floor.
 */

import { describe, expect, it } from 'vitest';
import { goldenNumber, shortestFloat, mismatch, readGoldenFolder } from '../testing/golden.node';
import { REPO_ROOT } from '../testing/repo.node';
import { PackJsonError } from './packJson';
import { PLAYER_HALF_WIDTH } from './riderWalk';
import {
  Door,
  Interior,
  Seat,
  WagonType,
  Zone,
  aliases,
  equalsIgnoreCase,
  formatNumber,
  geometryFaults,
  loadWagonType,
  parseWagonType,
} from './wagonType';

const FOLDER = `${REPO_ROOT}fixtures/golden/wagon_type`;

const golden = readGoldenFolder(FOLDER);

describe('golden wagon_type', () => {
  it('names this port in ports.json, and the folder follows the golden format', () => {
    expect(golden.ports).toMatchObject({ reference: 'java', ports: expect.arrayContaining(['ts']) as unknown });
    expect(golden.problems).toEqual([]);
  });

  for (const file of golden.files) {
    describe(file.name, () => {
      for (const c of file.cases) {
        it(c.id, () => {
          expect(mismatch(compute(c.input as Input), c.expected, file.tolerance), c.note).toBeNull();
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
    floor_at: ask(input.floor_at, ([x = NaN, z = NaN]) => goldenNumber(interior().floorAt(x, z, PLAYER_HALF_WIDTH))),
    clamp_feet: ask(input.clamp_feet, (p) => interior().clampFeet(p, PLAYER_HALF_WIDTH, t.doors, open)),
  };
}

function compute(input: Input): unknown {
  const warnings: unknown[] = [];
  let type: WagonType;
  try {
    type = parseWagonType('golden:type', input.type, (w) => warnings.push(finding(w)));
  } catch (e) {
    if (!(e instanceof PackJsonError)) throw e;
    return { error: finding(e.message), warnings, type: null, answers: null };
  }
  return { error: null, warnings, type: typeOut(type), answers: answersOut(type, input) };
}

// ---- what the golden cases don't reach

describe('wagonType', () => {
  const minimal = { length: 25.0, bogies: [8.5, -8.5], mass_t: 50.0 };

  it('writes a number of its errors as the parser does: whole ones without .0, others as Double.toString', () => {
    expect([5, -2, 0, -0, 2.5, -1.5, 1e-5, 12345678.5, 1e21].map(formatNumber)).toEqual([
      '5',
      '-2',
      '0',
      '0',
      '2.5',
      '-1.5',
      '1.0E-5',
      '1.23456785E7',
      '1.0E21',
    ]);
  });

  it('lists every way the geometry makes no wagon in the engine’s order, the first being the parser’s error', () => {
    const faults = geometryFaults(10, [5, -2, -1.5], { front: 0.5, rear: -5.5 });
    expect(faults.map((f) => [f.code, f.params])).toEqual([
      ['bogie-outside', { index: 0, value: 5, half: 5 }],
      ['bogie-order', { index: 2, value: -1.5, previousIndex: 1, previous: -2 }],
      ['coupler-outside', { end: 'rear', value: -5.5, half: 5 }],
    ]);
    expect(() => parseWagonType('x', { length: 10, bogies: [5, -2, -1.5], mass_t: 1, couplers: { front: 0.5, rear: -5.5 } })).toThrow(
      new PackJsonError(faults[0]!.text),
    );
    expect(geometryFaults(0, [99], { front: 99, rear: 0 })).toEqual([
      { code: 'length-not-positive', params: { value: 0 }, text: "'length' must be a positive number of blocks, got 0" },
    ]);
    expect(geometryFaults(10, [4, -4], { front: 0, rear: 0 })).toEqual([]);
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

  it('names a value of the wrong type as the engine does', () => {
    expect(() => parseWagonType('x', { ...minimal, cab: true })).toThrow("'cab' must be an object, got true");
    expect(() => parseWagonType('x', { ...minimal, doors: [{ id: 1 }] })).toThrow("'doors[0].id' must be a string, got the number 1");
    expect(() => parseWagonType('x', { ...minimal, doors: {} })).toThrow("'doors' must be an array, got an object");
    expect(() => parseWagonType('x', { ...minimal, doors: [{ id: 'd', min: [0, 1, 1.4], max: [1, 3, 1.5], group: 5 }] })).toThrow(
      "'doors[0].group' must be a string, got the number 5",
    );
    expect(() => parseWagonType('x', { ...minimal, brakes: { system: 1 } })).toThrow("'brakes.system' must be a string, got the number 1");
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
