/**
 * The port of `convention/PivotAxis.java`: a control's hinge from its `…_ROT…` marker,
 * exactly as Immersive Railroading gets it (UniversalModCore `ModelGroup`). Golden:
 * fixtures/golden/pivot_axis/ — from the corners in file order (`corners.json`) and from
 * the text of an OBJ and the marker's name (`obj_text.json`: the corners ./obj.ts keeps
 * of every face of every part of that object, in order).
 *
 * Step by step:
 * 1. the points: the corners in file order, each position once, where it first comes
 *    (0 and −0 are one position);
 * 2. the hinge: the centre of their bounding box;
 * 3. end A: the point furthest from the centre; end B: the point furthest from A — a
 *    tie goes to the earlier point;
 * 4. the near end: B if `|B|² < |A|²`, else A; the other is the far end;
 * 5. the axis: from the centroid of the points nearer the near end to the centroid of
 *    those nearer the far end (a point as near to both is in neither), unit length;
 *    +Z if a half is empty or the two centroids meet.
 *
 * The corners are floats, as the OBJ loader reads them (each is `Math.fround`ed here);
 * the rest is double, as in the engine. A marker symmetric about its centre (a box) gets
 * the sign of its axis from the order of its vertices. Pure.
 */

import type { Vec3 } from '../core/contracts';

/** A marker's hinge (`PivotAxis.of`): the pivot and the unit axis the part turns about, OBJ frame. */
export interface Hinge {
  centre: Vec3;
  axis: Vec3;
}

/**
 * `PivotAxis.points`: the distinct points of a marker — each position once, where it
 * first comes in `corners` (the corners of its faces in file order), as floats.
 */
export function points(corners: readonly ArrayLike<number>[]): Vec3[] {
  const seen = new Set<string>();
  const out: Vec3[] = [];
  for (const c of corners) {
    const p: Vec3 = [Math.fround(c[0]!), Math.fround(c[1]!), Math.fround(c[2]!)];
    // the key: −0 is 0 (a template literal writes both "0"), NaN is NaN
    const key = `${p[0]},${p[1]},${p[2]}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(p);
    }
  }
  return out;
}

/**
 * `PivotAxis.of`: the hinge of a marker from the corners of its faces in file order.
 *
 * @param corners at least one; each `[x, y, z]` (more values are not read)
 * @throws RangeError with no corner
 */
export function of(corners: readonly ArrayLike<number>[]): Hinge {
  const pts = points(corners);
  const first = pts[0];
  if (first === undefined) throw new RangeError('a hinge marker has no corner');
  const min: Vec3 = [first[0], first[1], first[2]];
  const max: Vec3 = [first[0], first[1], first[2]];
  for (const p of pts) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, p[i]!);
      max[i] = Math.max(max[i]!, p[i]!);
    }
  }
  const centre: Vec3 = [(max[0] + min[0]) * 0.5, (max[1] + min[1]) * 0.5, (max[2] + min[2]) * 0.5];

  let endA = first; // furthest from the centre (the earlier point wins a tie)
  for (const p of pts) if (dist2(endA, centre) < dist2(p, centre)) endA = p;
  let endB = first; // furthest from that
  for (const p of pts) if (dist2(endB, endA) < dist2(p, endA)) endB = p;
  const bNearer = len2(endB) < len2(endA);
  const nearEnd = bNearer ? endB : endA;
  const farEnd = bNearer ? endA : endB;

  const nearSum: Vec3 = [0, 0, 0];
  const farSum: Vec3 = [0, 0, 0];
  let nearCount = 0;
  let farCount = 0;
  for (const p of pts) {
    const toNear = dist2(p, nearEnd);
    const toFar = dist2(p, farEnd);
    if (toNear < toFar) {
      for (let i = 0; i < 3; i++) nearSum[i]! += p[i]!;
      nearCount++;
    } else if (toNear > toFar) {
      for (let i = 0; i < 3; i++) farSum[i]! += p[i]!;
      farCount++;
    }
  }
  let axis: Vec3 = [0, 0, 1];
  if (nearCount > 0 && farCount > 0) {
    const x = farSum[0] / farCount - nearSum[0] / nearCount;
    const y = farSum[1] / farCount - nearSum[1] / nearCount;
    const z = farSum[2] / farCount - nearSum[2] / nearCount;
    const len = Math.sqrt(x * x + y * y + z * z);
    if (len > 1.0e-9) axis = [x / len, y / len, z / len];
  }
  return { centre, axis };
}

function dist2(a: Vec3, b: Vec3): number {
  const x = a[0] - b[0];
  const y = a[1] - b[1];
  const z = a[2] - b[2];
  return x * x + y * y + z * z;
}

function len2(a: Vec3): number {
  return a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
}
