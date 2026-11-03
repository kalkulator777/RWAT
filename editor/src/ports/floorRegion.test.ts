/**
 * Golden runner of fixtures/golden/floor_region/ (editor.md §4.5; fixtures/golden/README.md):
 * ./floorRegion, by ./wagonType's `Interior.region`, against `stock/FloorRegion.java`,
 * the reference that writes the expected — where a rider's centre fits on a type's floor
 * with some doors open (pieces, cuts, links) and the answers to the case's questions,
 * all in the model frame.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { goldenNumber, mismatch, readGoldenFolder } from '../testing/golden.node';
import { EXAMPLE_PACK, REPO_ROOT } from '../testing/repo.node';
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

  /**
   * `FloorRegion.reach` as the engine writes it: passes over every piece, in order, until
   * one moves nothing. The port visits only the pieces a pass can move the point by.
   */
  function reachOverEveryPiece(region: FloorRegion, x: number, z: number, axis: number, dir: number): number {
    const EPS = 1.0e-9;
    if (!region.fits(x, z)) return NaN;
    let at = axis === 0 ? x : z;
    let grew = true;
    while (grew) {
      grew = false;
      for (const p of region.pieces) {
        const onLine = axis === 0 ? z >= p.minZ - EPS && z <= p.maxZ + EPS : x >= p.minX - EPS && x <= p.maxX + EPS;
        const lo = axis === 0 ? p.minX : p.minZ;
        const hi = axis === 0 ? p.maxX : p.maxZ;
        if (!onLine || at < lo - EPS || at > hi + EPS) continue;
        const end = dir > 0 ? hi : lo;
        if (dir * (end - at) > EPS) {
          at = end;
          grew = true;
        }
      }
    }
    return at;
  }

  /** Every point a check asks reach about there: the pieces' corners and edges' middles, ±EPS-scale nudges, and a grid. */
  function probes(region: FloorRegion): [number, number][] {
    const out: [number, number][] = [];
    const nudges = [0, 1e-9, -1e-9, 5e-10, -5e-10, 2e-9];
    for (const p of region.pieces) {
      for (const x of [p.minX, p.maxX, (p.minX + p.maxX) / 2]) {
        for (const z of [p.minZ, p.maxZ, (p.minZ + p.maxZ) / 2]) {
          for (const n of nudges) out.push([x + n, z - n], [x - n, z + n]);
        }
      }
    }
    return out;
  }

  it('answers reach as a pass over every piece does, to the last bit: the example pack, doors shut and open, and close calls', () => {
    const types = ['coach', 'shunter', 'gondola'].map((id) =>
      parseWagonType(`rwat_example:${id}`, JSON.parse(readFileSync(join(EXAMPLE_PACK, 'data', 'rwat_example', 'wagon_types', `${id}.json`), 'utf8'))),
    );
    const regions: FloorRegion[] = [];
    for (const type of types) {
      if (type.interior === null) continue;
      regions.push(type.interior.region(PLAYER_HALF_WIDTH), type.interior.region(PLAYER_HALF_WIDTH, type.doors, 0));
    }
    // zones that touch, overlap, meet a hair apart and corner to corner
    regions.push(
      FloorRegion.of([zone(-1, -5, 1, 0), zone(-1, 0, 1, 5), zone(-1.5, 5 + 1e-9, 1.5, 7), zone(1, -2, 3, 2), zone(-3, 7, -1, 9)], 0.3),
      FloorRegion.of([zone(-1, -5, 1, 5), zone(1 - 5e-10, -1, 3, 1)], 0.3, [new Cut(-0.05, -1, 0.05, 1), new Cut(-1, 2, 1, 2.05)]),
    );
    let asked = 0;
    for (const region of regions) {
      for (const [x, z] of probes(region)) {
        for (const [axis, dir] of [[0, 1], [0, -1], [2, 1], [2, -1]] as const) {
          const want = reachOverEveryPiece(region, x, z, axis, dir);
          const got = region.reach(x, z, axis, dir);
          if (!Object.is(got, want)) expect([x, z, axis, dir, got]).toEqual([x, z, axis, dir, want]);
          asked++;
        }
      }
    }
    expect(asked).toBeGreaterThan(10_000);
  });

  it('walks the length of a long floor towards −Z without a pass over every piece per piece it walks through', () => {
    // a corridor of 2000 zones end to end, some 8000 pieces: a pass of the engine's rule
    // moves the point by one piece towards −Z, so it makes some 8000 passes over 8000 pieces
    const zones = Array.from({ length: 2000 }, (_, i) => zone(-1, i, 1, i + 1));
    const region = FloorRegion.of(zones, 0.3);
    expect(region.pieces.length).toBeGreaterThan(6000);
    expect(region.reach(0, 1999.5, 2, -1)).toBe(0.3);
    let best = Infinity;
    for (let run = 0; run < 3; run++) {
      const started = performance.now();
      region.reach(0, 1999.5, 2, -1);
      region.reach(0, 0.5, 2, 1);
      best = Math.min(best, performance.now() - started);
    }
    // the port: under a millisecond (a few under coverage); the engine's rule: seconds
    expect(best).toBeLessThan(50);
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
