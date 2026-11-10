/**
 * The geometry of the view's overlays (core/contracts `OverlayShape`), as plain numbers in
 * the OBJ frame: the points of an arc and a circle, the edges of a box, the corners of a
 * flat rectangle, the plane of a polygon, and where a ray meets a shape, for picking the
 * shapes that carry a link. ./overlays.ts turns these into three.js lines and fills.
 *
 * Pure: no three, no DOM.
 */

import type { Link, OverlayShape, Vec3 } from '../core/contracts';

/** A ray in the OBJ frame; `direction` need not be of unit length (distances are then in its units). */
export interface Ray {
  readonly origin: Vec3;
  readonly direction: Vec3;
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a: Vec3, k: number): Vec3 {
  return [a[0] * k, a[1] * k, a[2] * k];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

/** The vector of unit length along `a`; a zero vector stays zero. */
export function normalize(a: Vec3): Vec3 {
  const n = length(a);
  return n === 0 ? [0, 0, 0] : scale(a, 1 / n);
}

/** `v` turned by `degrees` around the unit `axis`, right-hand rule (Rodrigues' formula). */
export function rotate(v: Vec3, axis: Vec3, degrees: number): Vec3 {
  const k = normalize(axis);
  const angle = (degrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return add(add(scale(v, cos), scale(cross(k, v), sin)), scale(k, dot(k, v) * (1 - cos)));
}

/**
 * The points of an arc around `axis` through `centre`, starting at `from` and sweeping
 * `degrees` by the right-hand rule: the first point is `from`, the last is `from` turned
 * by the whole sweep. At least one segment, and one more for every `step` degrees.
 */
export function arcPoints(centre: Vec3, axis: Vec3, from: Vec3, degrees: number, step = 7.5): Vec3[] {
  const arm = sub(from, centre);
  const segments = Math.max(1, Math.ceil(Math.abs(degrees) / step));
  const points: Vec3[] = [];
  for (let i = 0; i <= segments; i++) points.push(add(centre, rotate(arm, axis, (degrees * i) / segments)));
  return points;
}

/**
 * Which way an arc runs at its end: the tangent of the sweep at the last point, of unit
 * length (zero for an arc of no radius or no sweep).
 */
export function arcEndTangent(centre: Vec3, axis: Vec3, from: Vec3, degrees: number): Vec3 {
  if (degrees === 0) return [0, 0, 0];
  const end = rotate(sub(from, centre), axis, degrees);
  const tangent = cross(normalize(axis), end);
  return normalize(degrees > 0 ? tangent : scale(tangent, -1));
}

/** The points of a horizontal circle, counter-clockwise seen from above, not closed (draw it as a loop). */
export function circlePoints(centre: Vec3, radius: number, segments = 64): Vec3[] {
  const points: Vec3[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (2 * Math.PI * i) / segments;
    points.push([centre[0] + radius * Math.cos(angle), centre[1], centre[2] - radius * Math.sin(angle)]);
  }
  return points;
}

/** The least and greatest corner of a box given by any two opposite corners. */
export function ordered(a: Vec3, b: Vec3): [Vec3, Vec3] {
  return [
    [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
    [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
  ];
}

/** The twelve edges of a box, as pairs of corners. */
export function boxEdges(a: Vec3, b: Vec3): [Vec3, Vec3][] {
  const [min, max] = ordered(a, b);
  const corner = (i: number): Vec3 => [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]];
  const edges: [Vec3, Vec3][] = [];
  for (let i = 0; i < 8; i++) {
    for (const bit of [1, 2, 4]) {
      if ((i & bit) === 0) edges.push([corner(i), corner(i | bit)]);
    }
  }
  return edges;
}

/** The four corners of a flat rectangle at y = `a[1]`, in order around it. */
export function rectCorners(a: Vec3, b: Vec3): Vec3[] {
  const y = a[1];
  const [min, max] = ordered(a, b);
  return [
    [min[0], y, min[2]],
    [max[0], y, min[2]],
    [max[0], y, max[2]],
    [min[0], y, max[2]],
  ];
}

/** How far along the ray it enters the box (0 if it starts inside), or null if it misses (slab test). */
export function rayBox(ray: Ray, a: Vec3, b: Vec3): number | null {
  const [min, max] = ordered(a, b);
  let near = 0;
  let far = Infinity;
  for (let i = 0; i < 3; i++) {
    const o = ray.origin[i] as number;
    const d = ray.direction[i] as number;
    const lo = min[i] as number;
    const hi = max[i] as number;
    if (d === 0) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    near = Math.max(near, t1);
    far = Math.min(far, t2);
    if (near > far) return null;
  }
  return near;
}

/** How far along the ray it meets the horizontal plane at `y`, or null if it runs along it or away from it. */
function rayPlaneY(ray: Ray, y: number): number | null {
  const d = ray.direction[1];
  if (d === 0) return null;
  const t = (y - ray.origin[1]) / d;
  return t >= 0 ? t : null;
}

/** How far along the ray it meets a flat rectangle at y = `a[1]`, or null. */
export function rayRect(ray: Ray, a: Vec3, b: Vec3): number | null {
  const t = rayPlaneY(ray, a[1]);
  if (t === null) return null;
  const [min, max] = ordered(a, b);
  const x = ray.origin[0] + ray.direction[0] * t;
  const z = ray.origin[2] + ray.direction[2] * t;
  return x >= min[0] && x <= max[0] && z >= min[2] && z <= max[2] ? t : null;
}

/** How far along the ray it meets the disc of a horizontal circle, or null. */
export function rayDisc(ray: Ray, centre: Vec3, radius: number): number | null {
  const t = rayPlaneY(ray, centre[1]);
  if (t === null) return null;
  const x = ray.origin[0] + ray.direction[0] * t - centre[0];
  const z = ray.origin[2] + ray.direction[2] * t - centre[2];
  return x * x + z * z <= radius * radius ? t : null;
}

/**
 * The normal of a polygon's plane by Newell's method (any winding, a corner or two out of
 * line), of unit length; zero for points that span no plane.
 */
export function polygonNormal(points: readonly Vec3[]): Vec3 {
  let n: Vec3 = [0, 0, 0];
  for (let i = 0; i < points.length; i++) {
    const a = points[i] as Vec3;
    const b = points[(i + 1) % points.length] as Vec3;
    n = add(n, [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]);
  }
  return normalize(n);
}

/** The two axes a polygon is drawn flat on: those its normal leans least along (x and z for a floor). */
export function polygonAxes(normal: Vec3): [number, number] {
  const n = normal.map(Math.abs);
  const drop = n[0]! >= n[1]! && n[0]! >= n[2]! ? 0 : n[1]! >= n[2]! ? 1 : 2;
  return drop === 0 ? [1, 2] : drop === 1 ? [0, 2] : [0, 1];
}

/** True if the 2D point is inside the polygon (even-odd rule). */
function inside2(x: number, y: number, polygon: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** How far along the ray it meets a flat polygon inside its outline, or null (a polygon of no plane is never met). */
export function rayPolygon(ray: Ray, points: readonly Vec3[]): number | null {
  if (points.length < 3) return null;
  const normal = polygonNormal(points);
  const facing = dot(normal, ray.direction);
  if (length(normal) === 0 || facing === 0) return null;
  const t = dot(normal, sub(points[0] as Vec3, ray.origin)) / facing;
  if (t < 0) return null;
  const hit = add(ray.origin, scale(ray.direction, t));
  const [u, v] = polygonAxes(normal);
  return inside2(hit[u]!, hit[v]!, points.map((p) => [p[u]!, p[v]!] as const)) ? t : null;
}

/** How near a point the ray must pass to click it, blocks: a dot is a few pixels, a little more is forgiven. */
export const POINT_PICK_RADIUS = 0.1;

/** How far along the ray it passes nearest to a point within `radius` of it, or null. */
export function rayPoint(ray: Ray, at: Vec3, radius = POINT_PICK_RADIUS): number | null {
  const d2 = dot(ray.direction, ray.direction);
  if (d2 === 0) return null;
  const t = dot(sub(at, ray.origin), ray.direction) / d2;
  if (t < 0) return null;
  const nearest = add(ray.origin, scale(ray.direction, t));
  return length(sub(at, nearest)) <= radius ? t : null;
}

/**
 * How far along the ray it meets a shape that can be clicked: a box, a rectangle, a
 * polygon, the disc of a circle, a point. Arrows and arcs are lines, too thin to click: null.
 */
export function rayShape(ray: Ray, shape: OverlayShape): number | null {
  switch (shape.shape) {
    case 'box':
      return rayBox(ray, shape.min, shape.max);
    case 'rect':
      return rayRect(ray, shape.min, shape.max);
    case 'circle':
      return rayDisc(ray, shape.centre, shape.radius);
    case 'polygon':
      return rayPolygon(ray, shape.points);
    case 'point':
      return rayPoint(ray, shape.at);
    default:
      return null;
  }
}

/** The nearest shape with a link that the ray meets, over all the given lists, with its distance; null if none. */
export function pickShape(ray: Ray, lists: Iterable<readonly OverlayShape[]>): { link: Link; distance: number } | null {
  let best: { link: Link; distance: number } | null = null;
  for (const shapes of lists) {
    for (const shape of shapes) {
      if (shape.link === undefined) continue;
      const distance = rayShape(ray, shape);
      if (distance !== null && (best === null || distance < best.distance)) best = { link: shape.link, distance };
    }
  }
  return best;
}

/** True if two links name the same thing. */
export function sameLink(a: Link, b: Link): boolean {
  switch (a.kind) {
    case 'file':
      return b.kind === 'file' && a.file === b.file;
    case 'field':
      return b.kind === 'field' && a.file === b.file && a.at === b.at;
    case 'object':
      return b.kind === 'object' && a.model === b.model && a.name === b.name;
    default:
      return (b.kind === 'zone' || b.kind === 'door' || b.kind === 'seat') && b.kind === a.kind && b.type === a.type && b.index === a.index;
  }
}
