/**
 * Golden runner of fixtures/golden/cab_area/ (editor.md §4.5; fixtures/golden/README.md):
 * ./cabArea against `kinematics/CabArea.java`, the reference that writes the expected —
 * a type as the pack writes it (OBJ frame) → its driver's cabs: the cab of each chair and
 * of each piece of the floor, the doors that want the key, the passengers' side doors,
 * and the answers to the case's questions, asked in the model frame.
 */

import { describe, expect, it } from 'vitest';
import { mismatch, readGoldenFolder } from '../testing/golden.node';
import { REPO_ROOT } from '../testing/repo.node';
import { NO_CAB_AREA, cabArea, facing, leftSide, passengerSideDoors } from './cabArea';
import { PLAYER_HALF_WIDTH } from './riderWalk';
import { type Seat, parseWagonType } from './wagonType';

const FOLDER = `${REPO_ROOT}fixtures/golden/cab_area`;

const golden = readGoldenFolder(FOLDER);

describe('golden cab_area', () => {
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
