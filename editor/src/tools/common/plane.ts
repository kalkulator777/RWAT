/**
 * Where the pointer is on the plane a markup tool works in (docs/proposals/editor.md §3.9):
 * the views from the top, the side and the front show two axes of the OBJ frame each, and a
 * tool meets the pointer's ray (core/contracts `ViewPointer`) with the plane through a level
 * along the third — the zones tool and the chairs tool the plan at a floor's or a cushion's
 * height, the doors tool a door's middle in whichever of the three views. And which end of a
 * span a press is near, to stretch a shape by its edge. Pure: no DOM, no signals.
 */

import type { ViewPointer } from '../../core/contracts';

/** An axis of the OBJ frame: 0 x, 1 y, 2 z. */
export type Axis = 0 | 1 | 2;

/** A view a tool works in: its two axes on the screen (`u` to the right, `v` up or down) and the one it looks along. */
export interface ViewPlane {
  readonly u: Axis;
  readonly v: Axis;
  readonly n: Axis;
  /** True when +v runs down the screen (the top view: +z, the left side, at the bottom). */
  readonly vDown: boolean;
}

/** The fixed views (view3d/cameras: the top as Blender's 7, the side as 1 from +Z, the front as 3 from −X). */
export const PLANES: Readonly<Record<'top' | 'side' | 'front', ViewPlane>> = {
  top: { u: 0, v: 2, n: 1, vDown: true },
  side: { u: 0, v: 1, n: 2, vDown: false },
  front: { u: 2, v: 1, n: 0, vDown: false },
};

/** The plane of a view a tool works in, or null for one it does not (the perspective). */
export function planeOf(view: ViewPointer['view']): ViewPlane | null {
  return view === 'top' || view === 'side' || view === 'front' ? PLANES[view] : null;
}

/** Where a ray meets the plane of a view through `level` on its axis: the point's u and v; null for a ray along the plane. */
export function planePoint(at: ViewPointer, plane: ViewPlane, level: number): [number, number] | null {
  const d = at.direction[plane.n];
  if (Math.abs(d) < 1e-6) return null;
  const t = (level - at.origin[plane.n]) / d;
  return [at.origin[plane.u] + t * at.direction[plane.u], at.origin[plane.v] + t * at.direction[plane.v]];
}

/** Where a ray meets the level y = `height`, as a point of the plan (x, z); null for a ray along the level. */
export function planPoint(at: ViewPointer, height: number): [number, number] | null {
  return planePoint(at, PLANES.top, height);
}

/** The end of the span [min, max] that `value` is within `tolerance` of, the nearer of the two; null when it is near neither. */
export function nearEnd(value: number, min: number, max: number, tolerance: number): 'min' | 'max' | null {
  const toMin = Math.abs(value - min);
  const toMax = Math.abs(value - max);
  if (Math.min(toMin, toMax) > tolerance) return null;
  return toMin <= toMax ? 'min' : 'max';
}
