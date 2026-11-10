/**
 * Where an edge, a corner or a point goes when a markup tool draws, moves or stretches it
 * (docs/proposals/editor.md §2.3, §3.9): to an edge of the tool's own shapes or the floor
 * zones', to a vertex of the model, to the grid of 1/16 block — in that order, each when it
 * is near enough (the grid always is). The zones' edges come first because zones that touch
 * join and a gap of any width between them is a wall: an edge a hair off its neighbour's
 * would cut the floor. Each axis snaps by itself (OBJ frame). The zones tool, the doors
 * tool and the chairs tool snap so.
 *
 * A vertex is taken as the OBJ writes it: the shortest decimal that reads back as the
 * same float (`1.15`, not `1.149999976158142`). Pure: no DOM, no signals.
 */

import type { LoadedModel } from '../../core/contracts';

/** The grid's step: 1/16 block, the floor generator's cell (`floorgen.CELL`). */
export const GRID = 0.0625;

/** How near, in screen pixels, an edge or a vertex has to be to catch the pointer. */
export const SNAP_PX = 8;

/** What the edges snap to; Alt held snaps to nothing. */
export interface Snapping {
  readonly grid: boolean;
  readonly vertices: boolean;
  readonly zones: boolean;
}

export const ALL_SNAPPING: Snapping = { grid: true, vertices: true, zones: true };

/** What a value snapped to. */
export type SnapKind = 'zone' | 'vertex' | 'grid' | 'free';

/** The rank of a kind: the lower wins when two are near. */
const RANK: Readonly<Record<SnapKind, number>> = { zone: 0, vertex: 1, grid: 2, free: 3 };

/** Where an axis may snap: other zones' edges and the model's vertices, each sorted. */
export interface SnapLines {
  readonly zones: readonly number[];
  readonly vertices: Float64Array;
}

/** Shortest decimal that reads back as the same float32: a coordinate as the OBJ writes it. */
export function floatDecimal(value: number): number {
  const target = Math.fround(value);
  for (let digits = 1; digits <= 9; digits++) {
    const text = Number(target.toPrecision(digits));
    if (Math.fround(text) === target) return text;
  }
  return target;
}

/** A sum of decimals without its binary noise (`-9.6 + 0.0625` is `-9.5375`, not `-9.537500000000001`): to 1e-9 block, twelve digits at most. */
export function clean(value: number): number {
  const rounded = Number(Number(value.toFixed(9)).toPrecision(12));
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** A free value, nothing near to snap to: to a thousandth of a block. */
export function free(value: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** The value of a sorted list nearest to `value`, or undefined for an empty list. */
export function nearest(sorted: ArrayLike<number>, value: number): number | undefined {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((sorted[mid] as number) < value) lo = mid + 1;
    else hi = mid;
  }
  const after = sorted[lo];
  const before = sorted[lo - 1];
  if (after === undefined) return before;
  if (before === undefined) return after;
  return value - before <= after - value ? before : after;
}

function unique(values: Iterable<number>): Float64Array {
  const sorted = Float64Array.from(values).sort();
  const out: number[] = [];
  for (const v of sorted) if (out.length === 0 || v !== out[out.length - 1]) out.push(v);
  return Float64Array.from(out);
}

const VERTEX_LINES = new WeakMap<LoadedModel, { xs: Float64Array; zs: Float64Array }>();
const Y_LINES = new WeakMap<LoadedModel, Float64Array>();

/**
 * The x and the z of every vertex of the model, sorted, as the OBJ writes them; made once
 * a model. The parts the engine does not draw count too: the view shows them as ghosts,
 * and the guides an author models for the floor (`GUIDE_FLOOR_…`, skipped) are what a
 * zone's edge is meant to sit on.
 */
export function vertexLines(model: LoadedModel | null): { xs: Float64Array; zs: Float64Array } {
  if (model === null) return { xs: new Float64Array(), zs: new Float64Array() };
  let lines = VERTEX_LINES.get(model);
  if (lines === undefined) {
    const xs = new Set<number>();
    const zs = new Set<number>();
    for (const part of model.parts) {
      const p = part.positions;
      for (let i = 0; i + 2 < p.length; i += 3) {
        xs.add(p[i] as number);
        zs.add(p[i + 2] as number);
      }
    }
    lines = { xs: unique([...xs].map(floatDecimal)), zs: unique([...zs].map(floatDecimal)) };
    VERTEX_LINES.set(model, lines);
  }
  return lines;
}

/** The y of every vertex of the model, sorted, as the OBJ writes them; made once a model (x and z: {@link vertexLines}). */
export function vertexYs(model: LoadedModel | null): Float64Array {
  if (model === null) return new Float64Array();
  let ys = Y_LINES.get(model);
  if (ys === undefined) {
    const seen = new Set<number>();
    for (const part of model.parts) {
      const p = part.positions;
      for (let i = 1; i < p.length; i += 3) seen.add(p[i] as number);
    }
    ys = unique([...seen].map(floatDecimal));
    Y_LINES.set(model, ys);
  }
  return ys;
}

/** A value and what it snapped to. */
export interface Snapped {
  readonly value: number;
  readonly kind: SnapKind;
}

/** Where `value` snaps on an axis, things within `tolerance` caught: a zone's edge, else a vertex, else the grid, else free. */
export function snapValue(value: number, tolerance: number, lines: SnapLines, snapping: Snapping): Snapped {
  if (snapping.zones) {
    const edge = nearest(lines.zones, value);
    if (edge !== undefined && Math.abs(edge - value) <= tolerance) return { value: edge, kind: 'zone' };
  }
  if (snapping.vertices) {
    const vertex = nearest(lines.vertices, value);
    if (vertex !== undefined && Math.abs(vertex - value) <= tolerance) return { value: vertex, kind: 'vertex' };
  }
  if (snapping.grid) return { value: clean(Math.round(value / GRID) * GRID), kind: 'grid' };
  return { value: free(value), kind: 'free' };
}

/**
 * How far a span [lo, hi] moved by `delta` goes once snapped: one of its two edges caught
 * by a zone's edge or a vertex (the better kind, then the nearer), else the move itself in
 * whole grid steps — so a zone off the grid keeps its place between the lines — else free.
 */
export function snapShift(lo: number, hi: number, delta: number, tolerance: number, lines: SnapLines, snapping: Snapping): Snapped {
  let best: Snapped | null = null;
  let bestOff = Number.POSITIVE_INFINITY;
  for (const edge of [lo + delta, hi + delta]) {
    const snapped = snapValue(edge, tolerance, lines, { ...snapping, grid: false });
    if (snapped.kind === 'free') continue;
    const off = Math.abs(snapped.value - edge);
    if (best === null || RANK[snapped.kind] < RANK[best.kind] || (snapped.kind === best.kind && off < bestOff)) {
      best = { value: delta + (snapped.value - edge), kind: snapped.kind };
      bestOff = off;
    }
  }
  if (best !== null) return best;
  if (snapping.grid) return { value: clean(Math.round(delta / GRID) * GRID), kind: 'grid' };
  return { value: free(delta), kind: 'free' };
}

/** The other zones' edges along an axis, sorted: `pick` reads a zone's two edges. */
export function zoneEdges<Z>(zones: readonly (Z | null)[], except: number | null, pick: (zone: Z) => readonly [number, number]): number[] {
  const edges: number[] = [];
  zones.forEach((zone, i) => {
    if (zone !== null && i !== except) edges.push(...pick(zone));
  });
  return [...new Set(edges)].sort((a, b) => a - b);
}
