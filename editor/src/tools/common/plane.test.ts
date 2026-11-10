import { describe, expect, it } from 'vitest';
import type { ViewPointer } from '../../core/contracts';
import { nearEnd, PLANES, planeOf, planePoint, planPoint } from './plane';

/** A pointer from `origin` along `direction`, from the top. */
function ray(origin: [number, number, number], direction: [number, number, number]): ViewPointer {
  return { origin, direction, pixel: 0.01, view: 'top', shift: false, ctrl: false, alt: false };
}

describe('the plane a tool works in', () => {
  it('is met by the pointer’s ray at a level of its axis; a ray along the plane meets it nowhere', () => {
    expect(planePoint(ray([0, 5, 0], [0.6, -0.8, 0]), PLANES.top, 1)).toEqual([3, 0]);
    expect(planePoint(ray([0, 0, 0], [1, 0, 0]), PLANES.top, 1)).toBeNull();
    // from the side (+Z) the plane is x and y; from the front (−X), z and y
    expect(planePoint(ray([2, 1, 10], [0, 0, -1]), PLANES.side, 0.5)).toEqual([2, 1]);
    expect(planePoint(ray([-10, 1, 3], [1, 0, 0]), PLANES.front, -4)).toEqual([3, 1]);
  });

  it('of the plan is the top view’s: x and z at a height', () => {
    const at = ray([0.5, 7, -2], [0.6, -0.8, 0]);
    expect(planPoint(at, 3)).toEqual(planePoint(at, PLANES.top, 3));
    expect(planPoint(at, 3)).toEqual([3.5, -2]);
  });

  it('is the fixed views’ only: the orbit has none', () => {
    expect(planeOf('top')).toBe(PLANES.top);
    expect(planeOf('side')).toBe(PLANES.side);
    expect(planeOf('front')).toBe(PLANES.front);
    expect(planeOf('orbit')).toBeNull();
  });

  it('says which end of a span a press is near, the nearer of the two', () => {
    expect(nearEnd(0.04, 0, 2, 0.05)).toBe('min');
    expect(nearEnd(1.97, 0, 2, 0.05)).toBe('max');
    expect(nearEnd(1, 0, 2, 0.05)).toBeNull();
    expect(nearEnd(0.05, 0, 0.08, 0.05)).toBe('max');
  });
});
