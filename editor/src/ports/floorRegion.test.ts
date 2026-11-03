/**
 * Golden runner of fixtures/golden/floor_region/ (editor.md §4.5; fixtures/golden/README.md):
 * ./floorRegion, by ./wagonType's `Interior.region`, against `stock/FloorRegion.java`,
 * the reference that writes the expected — where a rider's centre fits on a type's floor
 * with some doors open (pieces, cuts, links) and the answers to the case's questions,
 * all in the model frame.
 */

import { describe, expect, it } from 'vitest';
import { goldenNumber, mismatch, readGoldenFolder } from '../testing/golden.node';
import { REPO_ROOT } from '../testing/repo.node';
import { Cut, FloorRegion, Piece, compareDoubles } from './floorRegion';
import { PLAYER_HALF_WIDTH } from './riderWalk';
import { Door, type Interior, Zone, parseWagonType } from './wagonType';

const FOLDER = `${REPO_ROOT}fixtures/golden/floor_region`;

const golden = readGoldenFolder(FOLDER);

describe('golden floor_region', () => {
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
    floor: ask(input.floor, ([x = NaN, z = NaN]) => goldenNumber(interior.floorAt(x, z, margin))),
    reach: ask(input.reach, ([x = NaN, z = NaN, axis = 0, dir = 0]) => goldenNumber(region.reach(x, z, axis, dir))),
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
