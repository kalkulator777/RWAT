import { describe, expect, it } from 'vitest';
import type { OverlayShape, Vec3 } from '../core/contracts';
import {
  arcEndTangent,
  arcPoints,
  boxEdges,
  circlePoints,
  pickShape,
  polygonAxes,
  polygonNormal,
  rayBox,
  rayDisc,
  rayPoint,
  rayPolygon,
  rayRect,
  rectCorners,
  rotate,
  sameLink,
} from './overlayGeometry';

function close(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i] as number, 9));
}

const down = (x: number, z: number): { origin: Vec3; direction: Vec3 } => ({ origin: [x, 10, z], direction: [0, -1, 0] });

describe('the overlay geometry', () => {
  it('turns by the right-hand rule: +X a quarter round +Y is −Z', () => {
    close(rotate([1, 0, 0], [0, 1, 0], 90), [0, 0, -1]);
    close(rotate([1, 0, 0], [0, 2, 0], -90), [0, 0, 1]);
    close(rotate([0, 1, 0], [1, 0, 0], 90), [0, 0, 1]);
  });

  it('runs an arc from its start through the whole sweep around a centre off the origin', () => {
    const points = arcPoints([1, 2, 3], [0, 0, 1], [2, 2, 3], 180);
    close(points[0] as Vec3, [2, 2, 3]);
    close(points.at(-1) as Vec3, [0, 2, 3]);
    // 7.5° a segment: 24 of them, the middle point a quarter round
    expect(points).toHaveLength(25);
    close(points[12] as Vec3, [1, 3, 3]);
    for (const point of points) expect(Math.hypot(point[0] - 1, point[1] - 2)).toBeCloseTo(1, 9);
    expect(arcPoints([0, 0, 0], [0, 1, 0], [1, 0, 0], 1)).toHaveLength(2);
  });

  it('points an arc end the way it sweeps', () => {
    close(arcEndTangent([0, 0, 0], [0, 1, 0], [1, 0, 0], 90), [-1, 0, 0]);
    close(arcEndTangent([0, 0, 0], [0, 1, 0], [1, 0, 0], -90), [-1, 0, 0]);
    close(arcEndTangent([0, 0, 0], [0, 1, 0], [1, 0, 0], 45), [-Math.SQRT1_2, 0, -Math.SQRT1_2]);
    close(arcEndTangent([0, 0, 0], [0, 1, 0], [1, 0, 0], 0), [0, 0, 0]);
  });

  it('lays a circle flat at its centre height', () => {
    const points = circlePoints([1, 0.5, -1], 2, 8);
    expect(points).toHaveLength(8);
    close(points[0] as Vec3, [3, 0.5, -1]);
    close(points[2] as Vec3, [1, 0.5, -3]);
    for (const point of points) expect(point[1]).toBe(0.5);
  });

  it('gives a box its twelve edges whichever corners it is given, and a rectangle its corners at the first height', () => {
    const edges = boxEdges([1, 1, 1], [0, 0, 0]);
    expect(edges).toHaveLength(12);
    for (const [a, b] of edges) {
      expect(a.filter((v, i) => v !== b[i])).toHaveLength(1);
    }
    expect(rectCorners([2, 1.2, 1], [-2, 9, -1])).toEqual([
      [-2, 1.2, -1],
      [2, 1.2, -1],
      [2, 1.2, 1],
      [-2, 1.2, 1],
    ]);
  });

  it('meets a box, a rectangle and a disc from above and misses beside them', () => {
    expect(rayBox(down(0, 0), [-1, 0, -1], [1, 2, 1])).toBe(8);
    expect(rayBox(down(2, 0), [-1, 0, -1], [1, 2, 1])).toBeNull();
    expect(rayBox({ origin: [0, 1, 0], direction: [1, 0, 0] }, [-1, 0, -1], [1, 2, 1])).toBe(0);
    expect(rayRect(down(0.5, 0.5), [-1, 1.2, -1], [1, 5, 1])).toBeCloseTo(8.8, 12);
    expect(rayRect(down(0.5, 1.5), [-1, 1.2, -1], [1, 5, 1])).toBeNull();
    expect(rayRect({ origin: [0, 0, 0], direction: [0, -1, 0] }, [-1, 1, -1], [1, 1, 1])).toBeNull();
    expect(rayDisc(down(0.3, 0.4), [0, 1, 0], 0.5)).toBe(9);
    expect(rayDisc(down(0.4, 0.4), [0, 1, 0], 0.5)).toBeNull();
  });

  it('meets a polygon inside its outline on its own plane, any way round, and a point within a little of it', () => {
    // an L-shaped floor piece at y = 1, clockwise from above, and the same wound the other way
    const ell: Vec3[] = [
      [0, 1, 0],
      [4, 1, 0],
      [4, 1, 1],
      [1, 1, 1],
      [1, 1, 3],
      [0, 1, 3],
    ];
    close(polygonNormal(ell), [0, -1, 0]);
    close(polygonNormal([...ell].reverse()), [0, 1, 0]);
    expect(polygonAxes(polygonNormal(ell))).toEqual([0, 2]);
    expect(rayPolygon(down(3, 0.5), ell)).toBe(9);
    expect(rayPolygon(down(0.5, 2.5), [...ell].reverse())).toBe(9);
    // the notch of the L is outside
    expect(rayPolygon(down(3, 2), ell)).toBeNull();
    // a door's face standing upright, met from the side
    const face: Vec3[] = [
      [2, 0, 0],
      [2, 0, 1],
      [2, 2, 1],
      [2, 2, 0],
    ];
    expect(polygonAxes(polygonNormal(face))).toEqual([1, 2]);
    expect(rayPolygon({ origin: [0, 1, 0.5], direction: [1, 0, 0] }, face)).toBe(2);
    expect(rayPolygon({ origin: [0, 1, 0.5], direction: [-1, 0, 0] }, face)).toBeNull();
    expect(rayPolygon(down(0, 0), ell.slice(0, 2))).toBeNull();
    expect(rayPoint(down(1, 2), [1.05, 0, 2])).toBe(10);
    expect(rayPoint(down(1, 2), [1.5, 0, 2])).toBeNull();
    expect(rayPoint(down(1, 2), [1, 11, 2])).toBeNull();
  });

  it('picks the nearest shape with a link, never one without, nor an arrow or an arc', () => {
    const zone: OverlayShape = { shape: 'rect', min: [-5, 1, -1], max: [5, 1, 1], style: 'zone', link: { kind: 'zone', type: 't', index: 0 } };
    const door: OverlayShape = { shape: 'box', min: [-1, 1, -1], max: [1, 3, 1], style: 'door', link: { kind: 'door', type: 't', index: 2 } };
    const bare: OverlayShape = { shape: 'box', min: [-9, 0, -9], max: [9, 9, 9], style: 'hull' };
    const arrow: OverlayShape = { shape: 'arrow', from: [0, 0, 0], to: [0, 9, 0], style: 'door', link: { kind: 'door', type: 't', index: 3 } };
    expect(pickShape(down(0, 0), [[zone], [bare, door, arrow]])).toEqual({ link: door.link, distance: 7 });
    expect(pickShape(down(3, 0), [[zone], [bare, door, arrow]])).toEqual({ link: zone.link, distance: 9 });
    expect(pickShape(down(8, 0), [[zone], [bare, door, arrow]])).toBeNull();
  });

  it('tells links apart by kind and by every field', () => {
    expect(sameLink({ kind: 'object', model: 'm', name: 'A' }, { kind: 'object', model: 'm', name: 'A' })).toBe(true);
    expect(sameLink({ kind: 'object', model: 'm', name: 'A' }, { kind: 'object', model: 'n', name: 'A' })).toBe(false);
    expect(sameLink({ kind: 'zone', type: 't', index: 1 }, { kind: 'door', type: 't', index: 1 })).toBe(false);
    expect(sameLink({ kind: 'seat', type: 't', index: 1 }, { kind: 'seat', type: 't', index: 1 })).toBe(true);
    expect(sameLink({ kind: 'file', file: 'a' }, { kind: 'field', file: 'a', at: '' })).toBe(false);
    expect(sameLink({ kind: 'field', file: 'a', at: '/x' }, { kind: 'field', file: 'a', at: '/x' })).toBe(true);
  });
});
