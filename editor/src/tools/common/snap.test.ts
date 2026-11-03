import { describe, expect, it } from 'vitest';
import { exampleModel } from '../../model/testing.node';
import { boxModel } from '../../view3d/testModel.node';
import { ALL_SNAPPING, clean, floatDecimal, free, GRID, nearest, snapShift, snapValue, vertexLines, vertexYs, zoneEdges, type SnapLines } from './snap';

const NONE = { grid: false, vertices: false, zones: false };

function lines(zones: number[], vertices: number[]): SnapLines {
  return { zones, vertices: Float64Array.from(vertices) };
}

describe('the numbers the tools write', () => {
  it('take a vertex as the OBJ writes it, a sum without its binary noise, a free value to a thousandth', () => {
    expect(floatDecimal(Math.fround(1.15))).toBe(1.15);
    expect(floatDecimal(Math.fround(-9.6))).toBe(-9.6);
    expect(floatDecimal(0.0625)).toBe(0.0625);
    expect(floatDecimal(Math.fround(1 / 3))).toBe(0.33333334);
    expect(clean(-9.6 + 0.0625)).toBe(-9.5375);
    expect(clean(-1e-17)).toBe(0);
    expect(free(1.23456)).toBe(1.235);
    expect(free(-0.0001)).toBe(0);
  });

  it('find the nearest of a sorted list', () => {
    expect(nearest([0, 1, 2], 1.4)).toBe(1);
    expect(nearest([0, 1, 2], 1.5)).toBe(1);
    expect(nearest([0, 1, 2], 9)).toBe(2);
    expect(nearest([0, 1, 2], -9)).toBe(0);
    expect(nearest([], 1)).toBeUndefined();
  });
});

describe('an edge snaps', () => {
  const near = lines([0.55, 3], [0.56, 2.99, 5.0001]);

  it('to another zone’s edge first, then a vertex, then the grid, all within the tolerance but the grid', () => {
    expect(snapValue(0.555, 0.02, near, ALL_SNAPPING)).toEqual({ value: 0.55, kind: 'zone' });
    expect(snapValue(5.01, 0.02, near, ALL_SNAPPING)).toEqual({ value: 5.0001, kind: 'vertex' });
    expect(snapValue(1.04, 0.02, near, ALL_SNAPPING)).toEqual({ value: 1.0625, kind: 'grid' });
    expect(snapValue(0.555, 0.02, near, { ...ALL_SNAPPING, zones: false })).toEqual({ value: 0.56, kind: 'vertex' });
    expect(snapValue(0.555, 0.001, near, ALL_SNAPPING)).toEqual({ value: 0.5625, kind: 'grid' });
    expect(snapValue(1.04321, 0.02, near, NONE)).toEqual({ value: 1.043, kind: 'free' });
    expect(snapValue(-0.03, 0.02, lines([], []), ALL_SNAPPING).value).toBe(0);
  });

  it('when a zone moves: by the edge a zone or a vertex catches, else in whole grid steps', () => {
    // the right edge 2.9 + 0.12 is caught by the zone's edge 3
    const caught = snapShift(1, 2.9, 0.12, 0.05, near, ALL_SNAPPING);
    expect(caught.kind).toBe('zone');
    expect(clean(2.9 + caught.value)).toBe(3);
    // the zone edge beats the nearer vertex
    expect(snapShift(0.5, 2.9, 0.095, 0.05, near, ALL_SNAPPING).kind).toBe('zone');
    // nothing near: whole steps of the grid, so a zone off the grid keeps its place between the lines
    expect(snapShift(-9.6, -7.9, 0.2, 0.01, near, ALL_SNAPPING)).toEqual({ value: 3 * GRID, kind: 'grid' });
    expect(snapShift(-9.6, -7.9, 0.2001, 0.01, near, NONE)).toEqual({ value: 0.2, kind: 'free' });
  });

  it('to the other zones’ edges only', () => {
    const zones = [{ a: 0, b: 1 }, null, { a: 1, b: 2 }, { a: 5, b: 6 }];
    expect(zoneEdges(zones, 3, (z) => [z.a, z.b])).toEqual([0, 1, 2]);
    expect(zoneEdges(zones, null, (z) => [z.a, z.b])).toEqual([0, 1, 2, 5, 6]);
  });
});

describe('the vertices an edge snaps to', () => {
  it('are every part’s — the ghosts and the floor guides too —, x and z apart, as the OBJ writes them, made once a model', async () => {
    const model = boxModel('test:box', [
      ['FLOOR', 'body', [-1.15, 0, -0.5], [2, 1.3, 0.5]],
      ['GUIDE_FLOOR_0', 'skip', [7, 7, 7], [8, 8, 8]],
    ]);
    const found = vertexLines(model);
    expect([...found.xs]).toEqual([-1.15, 2, 7, 8]);
    expect([...found.zs]).toEqual([-0.5, 0.5, 7, 8]);
    expect(vertexLines(model)).toBe(found);
    expect(vertexLines(null).xs.length).toBe(0);
    // the example coach's floor guides are its zones: their edges are there to snap to
    const coach = vertexLines(await exampleModel('coach'));
    for (const x of [-9.6, -7.9, -7.8, -1.2, 1.2, 7.8, 7.9, 9.6]) expect(coach.xs).toContain(x);
    for (const z of [-1.4, -0.55, 0.55, 1.4]) expect(coach.zs).toContain(z);
    expect([...coach.xs].every((x, i, all) => i === 0 || x > (all[i - 1] as number))).toBe(true);
  });

  it('along y are every part’s too, sorted, each once, as the OBJ writes them, made once a model', async () => {
    const model = boxModel('test:box', [
      ['FLOOR', 'body', [-1.15, 0, -0.5], [2, 1.3, 0.5]],
      ['GUIDE_FLOOR_0', 'skip', [7, 1.3, 7], [8, 8, 8]],
    ]);
    const found = vertexYs(model);
    expect([...found]).toEqual([0, 1.3, 8]);
    expect(vertexYs(model)).toBe(found);
    expect(vertexYs(null).length).toBe(0);
    // the window sill of the coach, which a door's edge snaps to from the side
    expect(vertexYs(await exampleModel('coach'))).toContain(2.3);
  });
});
