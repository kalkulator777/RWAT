/**
 * Golden runner of fixtures/golden/floor_check/ (editor.md §4.5; fixtures/golden/README.md):
 * ./floorCheck against `kinematics/FloorCheck.java` and `FloorFinding.java`, the reference
 * that writes the expected — a type as the pack writes it (OBJ frame) → what the floor
 * check tells its author, each finding `{code, subject, index, params, text}` with the
 * text word for word; or, for `exits_of`, the pieces of the floor a rider walks out
 * through each hull or gangway door from.
 */

import { describe, expect, it } from 'vitest';
import type { ProblemParam } from '../core/contracts';
import { goldenNumber, mismatch, readGoldenFolder } from '../testing/golden.node';
import { REPO_ROOT } from '../testing/repo.node';
import { findingText, findings, problems, walkableThrough, walkablePieces } from './floorCheck';
import { PLAYER_HALF_WIDTH } from './riderWalk';
import { type Door, type Interior, parseWagonType } from './wagonType';

const FOLDER = `${REPO_ROOT}fixtures/golden/floor_check`;

const golden = readGoldenFolder(FOLDER);

describe('golden floor_check', () => {
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

// ---- what the port makes of an input, laid out as FloorCheckGolden lays the engine's

interface Input {
  type?: unknown;
  exits_of?: unknown;
}

/** A param as the cases write it: NaN and the infinities by name (a zero keeps its sign). */
function param(value: ProblemParam): unknown {
  return typeof value === 'number' ? goldenNumber(value) : value;
}

function compute(input: Input): unknown {
  if (input.exits_of !== undefined) {
    const type = parseWagonType('golden:case', input.exits_of);
    if (type.interior === null) return null;
    const shut = type.interior.region(PLAYER_HALF_WIDTH, type.doors, 0);
    return type.doors.map((door) => (door.inner ? null : walkablePieces(door, shut)));
  }
  const type = parseWagonType('golden:case', input.type);
  return findings(type).map((f) => ({
    code: f.code,
    subject: f.subject,
    index: f.index,
    params: Object.fromEntries(Object.entries(f.params).map(([name, value]) => [name, param(value)])),
    text: f.text,
  }));
}

// ---- what the golden cases don't reach

describe('floorCheck', () => {
  it('words numbers as Java does: half up from the shortest decimal, the sign of a zero kept', () => {
    const line = (params: Record<string, ProblemParam>): string => findingText('DOOR_TOO_THICK', 3, { id: 'd', ...params });
    expect(line({ thickness: 1.005 })).toBe("door 3 'd' is 1.01 thick: is the box the door leaf?");
    expect(line({ thickness: 2.675 })).toBe("door 3 'd' is 2.68 thick: is the box the door leaf?");
    expect(line({ thickness: -0.001 })).toBe("door 3 'd' is -0.00 thick: is the box the door leaf?");
    expect(line({ thickness: 1e21 })).toBe("door 3 'd' is 1000000000000000000000.00 thick: is the box the door leaf?");
    expect(line({ thickness: -Infinity })).toBe("door 3 'd' is -Infinity thick: is the box the door leaf?");
    expect(findingText('FLOOR_TOO_NARROW', -1, { player_width: 0.35 })).toBe(
      'a player fits nowhere on the floor: every part of it is narrower than 0.4',
    );
    expect(findingText('DOOR_NOT_AT_FLOOR_END', 0, { id: 'd', slack: 1 })).toContain('within 1.0 of its inner face');
    expect(findingText('ZONES_UNREACHABLE', -1, { zones: [1, 2] })).toMatch(/^floor zones \[1, 2\] can't/);
  });

  it('gives the lines of the findings, and a door with a way out', () => {
    const type = parseWagonType('x', {
      length: 25,
      bogies: [8.5, -8.5],
      mass_t: 50,
      interior: [{ min: [-5, 1.37375, -1], max: [5, 3.87375, 1] }],
      doors: [{ id: 'gangway', min: [-5.05, 1.37375, -0.45], max: [-5, 3.37375, 0.45], connecting: true }],
      cab: {},
    });
    expect(problems(type)).toEqual(findings(type).map((f) => f.text));
    expect(problems(type)).toEqual([
      "a walkable cab needs a driver's chair (cab.seats): in a cab with a floor the keys drive only from a chair",
    ]);
    const region = (type.interior as Interior).region(PLAYER_HALF_WIDTH, type.doors, 0);
    expect(walkableThrough(type.doors[0] as Door, region)).toBe(true);
  });
});
