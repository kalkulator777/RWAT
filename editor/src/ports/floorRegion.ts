/**
 * Where a rider's centre may stand on a floor of boxes: port of `stock/FloorRegion.java`
 * (SPEC §9.8; golden `fixtures/golden/floor_region/`; the Python port is
 * `tools/floorgen.py`, `Region`).
 *
 * The union of the floor zones, shrunk by the player's half-width: a body fits wherever
 * its square (`2·margin` across, axis-aligned in the model frame) lies inside the union.
 * Zones that touch join with no overlap, a gap of any width between them is a wall. The
 * union is cut into strips along Z at every zone edge, each keeping the X intervals the
 * floor covers there; where a centre fits is kept as pieces: slabs along Z between the
 * strip edges ± the margin (plus the edges themselves), each with the X intervals a
 * centre may take. Pieces are closed boxes in the X–Z plane, in Z order.
 *
 * A region may have cuts ({@link Cut}): open boxes no centre stands in, a shut door between
 * zones (SPEC §9.1). Only a cut that takes something out is kept.
 *
 * Everything is in the model frame (+Z forward, X across), in `double`, with the engine's
 * tolerances, so pieces and answers match Java's.
 */

const EPS = 1.0e-9;
/** The thinnest a cut is across the wall: a door box thinner than this still parts the floor. */
const MIN_CUT = 0.01;

/** A box of floor as the region reads it: `WagonType.Interior.Zone` (model frame). */
export interface ZoneBox {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

/** A door as a cut reads it: `WagonType.Door` (model frame). */
export interface DoorBox extends ZoneBox {
  /** The wall normal: 0 = X (a side door), 2 = Z (an end door). */
  axis(): number;
  spanMin(): number;
  spanMax(): number;
}

/** `Math.clamp(value, min, max)` of Java for an ordered range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(value, min));
}

/** `Double.compare`: −0 before 0 (NaN does not occur here). */
export function compareDoubles(a: number, b: number): number {
  if (a < b) return -1;
  if (a > b) return 1;
  const negA = Object.is(a, -0);
  const negB = Object.is(b, -0);
  return negA === negB ? 0 : negA ? -1 : 1;
}

/** One box of the region: centres with x in [minX, maxX] and z in [minZ, maxZ] fit (`FloorRegion.Piece`). */
export class Piece {
  constructor(
    readonly minX: number,
    readonly minZ: number,
    readonly maxX: number,
    readonly maxZ: number,
  ) {}

  /** True if (x, z) lies in this box (closed). */
  holds(x: number, z: number): boolean {
    return x >= this.minX - EPS && x <= this.maxX + EPS && z >= this.minZ - EPS && z <= this.maxZ + EPS;
  }

  /** The point of this box nearest to (x, z): `[x, z]`. */
  clamp(x: number, z: number): [number, number] {
    return [clamp(x, this.minX, this.maxX), clamp(z, this.minZ, this.maxZ)];
  }

  /** True if this box and the box [minX..maxX] × [minZ..maxZ] share a point. */
  touches(minX: number, minZ: number, maxX: number, maxZ: number): boolean {
    return (
      Math.min(this.maxX, maxX) >= Math.max(this.minX, minX) - EPS &&
      Math.min(this.maxZ, maxZ) >= Math.max(this.minZ, minZ) - EPS
    );
  }
}

/** Narrows `t` to where p + t·d lies strictly inside (lo, hi); false if nowhere. */
function clip(p: number, d: number, lo: number, hi: number, t: [number, number]): boolean {
  if (!(hi > lo)) return false;
  if (Math.abs(d) < EPS) return p > lo && p < hi;
  const a = (lo - p) / d;
  const b = (hi - p) / d;
  t[0] = Math.max(t[0], Math.min(a, b));
  t[1] = Math.min(t[1], Math.max(a, b));
  return t[0] < t[1];
}

/** A box of the X–Z plane no centre stands in: open, its faces are still floor (`FloorRegion.Cut`). */
export class Cut {
  constructor(
    readonly minX: number,
    readonly minZ: number,
    readonly maxX: number,
    readonly maxZ: number,
  ) {}

  /**
   * Where shut door `door` stands across the floor (SPEC §9.1): the door's box across the
   * wall (at least {@link MIN_CUT} thick), its span grown by `margin` along it.
   */
  static shut(door: DoorBox, margin: number): Cut {
    const side = door.axis() === 0;
    let lo = side ? door.minX : door.minZ;
    let hi = side ? door.maxX : door.maxZ;
    if (hi - lo < MIN_CUT) {
      const mid = (lo + hi) * 0.5;
      lo = mid - MIN_CUT * 0.5;
      hi = mid + MIN_CUT * 0.5;
    }
    const alongLo = door.spanMin() - margin;
    const alongHi = door.spanMax() + margin;
    return side ? new Cut(lo, alongLo, hi, alongHi) : new Cut(alongLo, lo, alongHi, hi);
  }

  /** True if a piece of the region reaches inside this box. */
  bites(p: Piece): boolean {
    return p.maxX > this.minX + EPS && p.minX < this.maxX - EPS && p.maxZ > this.minZ + EPS && p.minZ < this.maxZ - EPS;
  }

  /** True if the straight line from (x0, z0) to (x1, z1) passes inside this box (along a face doesn't). */
  crossed(x0: number, z0: number, x1: number, z1: number): boolean {
    const t: [number, number] = [0.0, 1.0];
    return clip(x0, x1 - x0, this.minX + EPS, this.maxX - EPS, t) && clip(z0, z1 - z0, this.minZ + EPS, this.maxZ - EPS, t);
  }
}

/** The region of a floor where a body `2·margin` across fits (`FloorRegion`). */
export class FloorRegion {
  /** `pieces[i].maxZ`, non-decreasing: for range lookups. */
  private readonly pieceMaxZ: number[];

  private constructor(
    /** The half-width this region was shrunk by. */
    readonly margin: number,
    /** Strip edges along Z; strip k runs from stripZ[k] to stripZ[k + 1]. */
    private readonly stripZ: readonly number[],
    /** Per strip, the X intervals the floor covers, flat [a0, b0, a1, b1, …], sorted, disjoint. */
    private readonly stripX: readonly (readonly number[])[],
    /** Every box of the region, in Z order; empty if a player fits nowhere. */
    readonly pieces: readonly Piece[],
    /** The cuts taken out of this region (each takes something out), empty if none. */
    readonly cuts: readonly Cut[],
  ) {
    this.pieceMaxZ = pieces.map((p) => p.maxZ);
  }

  /**
   * The region of the union of `zones` where a body `2·margin` across fits, with `cuts`
   * taken out of where centres stand (`FloorRegion.of`); a cut no centre would stand in
   * anyway is dropped. Throws a RangeError unless `margin` is positive.
   */
  static of(zones: readonly ZoneBox[], margin: number, cuts: readonly Cut[] = []): FloorRegion {
    if (!(margin > EPS)) throw new RangeError(`margin must be positive: ${margin}`);
    const edges: number[] = [];
    for (const zone of zones) edges.push(zone.minZ, zone.maxZ);
    const stripZ = unique(edges);
    const stripX: number[][] = [];
    for (let k = 0; k + 1 < stripZ.length; k++) {
      const lo = stripZ[k] as number;
      const hi = stripZ[k + 1] as number;
      const spans: [number, number][] = [];
      for (const zone of zones) {
        if (zone.minZ <= lo + EPS && zone.maxZ >= hi - EPS && zone.maxX >= zone.minX) spans.push([zone.minX, zone.maxX]);
      }
      stripX.push(merge(spans));
    }
    const whole = new FloorRegion(margin, stripZ, stripX, [], []).buildPieces();
    const biting = cuts.filter((cut) => whole.some((p) => cut.bites(p)));
    if (biting.length === 0) return new FloorRegion(margin, stripZ, stripX, whole, []);
    const bare = new FloorRegion(margin, stripZ, stripX, [], biting);
    return new FloorRegion(margin, stripZ, stripX, bare.buildPieces(), biting);
  }

  /** True if walking straight from centre (x0, z0) to (x1, z1) passes through a cut. */
  throughCut(x0: number, z0: number, x1: number, z1: number): boolean {
    return this.cuts.some((cut) => cut.crossed(x0, z0, x1, z1));
  }

  /** True if a rider centred at (x, z) fits on the floor. */
  fits(x: number, z: number): boolean {
    for (let i = this.firstPieceReaching(z - EPS); i < this.pieces.length; i++) {
      const p = this.pieces[i] as Piece;
      if (p.minZ > z + EPS) break;
      if (p.holds(x, z)) return true;
    }
    return false;
  }

  /** The point of the region nearest (x, z) as `[x, z]`, or null if a player fits nowhere. */
  nearest(x: number, z: number): [number, number] | null {
    let best: [number, number] | null = null;
    let bestDist = Number.MAX_VALUE;
    for (const p of this.pieces) {
      const c = p.clamp(x, z);
      const d = Math.hypot(c[0] - x, c[1] - z);
      if (d < bestDist - EPS) {
        best = c;
        bestDist = d;
      }
    }
    return best;
  }

  /** The index of the first piece whose box reaches `z` or beyond along Z. */
  firstPieceReaching(z: number): number {
    let lo = 0;
    let hi = this.pieceMaxZ.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((this.pieceMaxZ[mid] as number) < z) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /**
   * How far a centre at (x, z) can go along one axis without leaving the region: the
   * furthest X (`axis` 0) or Z (`axis` 2) in direction `dir` (±1) it can slide to in a
   * straight line. NaN if (x, z) doesn't fit.
   *
   * The engine's rule step for step (`FloorRegion.reach`): passes over the pieces in
   * order, each moving the point to the end of every piece on the line that holds it,
   * until a pass moves nothing. A pass here visits only the pieces it can move the point
   * by — the same pieces in the same order, so the same answer to the last bit — where
   * Java visits them all: the pieces are in Z order (their `minZ` and `maxZ` never fall),
   * so the ones whose Z span holds z (`axis` 0) or the point (`axis` 2) within EPS are a
   * run of them, found by halving and left at the first piece past it. Along Z this keeps
   * the floor check off a quadratic walk: walking towards −Z a pass moves the point by
   * one piece, and a pass over every piece of MVP's long cars took most of its time.
   */
  reach(x: number, z: number, axis: number, dir: number): number {
    if (!this.fits(x, z)) return NaN;
    const pieces = this.pieces;
    const along = axis !== 0;
    let at = along ? z : x;
    let grew = true;
    while (grew) {
      grew = false;
      // the pieces before the run: their Z span ends short of it, a pass skips them unmoved
      for (let i = this.firstPieceNotBefore(along ? at : z); i < pieces.length; i++) {
        const p = pieces[i] as Piece;
        if (along) {
          // past the run: every piece after begins beyond the point, which only a piece holding it moves
          if (at < p.minZ - EPS) break;
          if (!(x >= p.minX - EPS && x <= p.maxX + EPS) || at > p.maxZ + EPS) continue;
          const end = dir > 0 ? p.maxZ : p.minZ;
          if (dir * (end - at) > EPS) {
            at = end;
            grew = true;
          }
        } else {
          if (z < p.minZ - EPS) break;
          if (at < p.minX - EPS || at > p.maxX + EPS) continue;
          const end = dir > 0 ? p.maxX : p.minX;
          if (dir * (end - at) > EPS) {
            at = end;
            grew = true;
          }
        }
      }
    }
    return at;
  }

  /**
   * The index of the first piece whose Z span does not end short of `z` by more than EPS:
   * the first for which `z > maxZ + EPS` (the test of {@link reach}) is false.
   */
  private firstPieceNotBefore(z: number): number {
    let lo = 0;
    let hi = this.pieceMaxZ.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (z > (this.pieceMaxZ[mid] as number) + EPS) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Pairs of piece indices that touch — one walks from one into the other — for the connectivity check. */
  links(): [number, number][] {
    const links: [number, number][] = [];
    for (let i = 0; i < this.pieces.length; i++) {
      const a = this.pieces[i] as Piece;
      for (let j = i + 1; j < this.pieces.length; j++) {
        const b = this.pieces[j] as Piece;
        if (b.minZ > a.maxZ + EPS) break;
        if (a.touches(b.minX, b.minZ, b.maxX, b.maxZ)) links.push([i, j]);
      }
    }
    return links;
  }

  // --- building ---

  private buildPieces(): Piece[] {
    const out: Piece[] = [];
    const stripZ = this.stripZ;
    if (stripZ.length < 2) return out;
    const margin = this.margin;
    const lo = (stripZ[0] as number) + margin;
    const hi = (stripZ[stripZ.length - 1] as number) - margin;
    if (hi < lo - EPS) return out; // the whole floor is shallower than a player
    // slab edges: the strip edges ± the margin, the ends, the cuts' edges
    const edges: number[] = [];
    for (const z of stripZ) edges.push(z - margin, z + margin);
    edges.push(lo, Math.max(lo, hi));
    for (const cut of this.cuts) edges.push(cut.minZ, cut.maxZ);
    const top = Math.max(lo, hi);
    const breaks = unique(edges).filter((v) => v >= lo - EPS && v <= top + EPS);
    for (let i = 0; i < breaks.length; i++) {
      const at = breaks[i] as number;
      addSlab(out, at, at, this.slice(at));
      const next = breaks[i + 1];
      if (next !== undefined && next - at > EPS) addSlab(out, at, next, this.slice((at + next) * 0.5));
    }
    return out;
  }

  /**
   * The X intervals a centre at `z` may take: the intervals every strip under the body
   * covers, each shrunk by the margin, intersected — less the cuts `z` is inside of.
   */
  private slice(z: number): number[] {
    const stripZ = this.stripZ;
    const bodyLo = z - this.margin;
    const bodyHi = z + this.margin;
    if (bodyLo < (stripZ[0] as number) - EPS || bodyHi > (stripZ[stripZ.length - 1] as number) + EPS) return [];
    let fit: number[] | null = null;
    for (let k = 0; k < this.stripX.length; k++) {
      if ((stripZ[k] as number) < bodyHi - EPS && (stripZ[k + 1] as number) > bodyLo + EPS) {
        const shrunk = shrink(this.stripX[k] as readonly number[], this.margin);
        fit = fit === null ? shrunk : intersect(fit, shrunk);
        if (fit.length === 0) break;
      }
    }
    if (fit === null) return [];
    for (const cut of this.cuts) {
      if (z > cut.minZ + EPS && z < cut.maxZ - EPS) fit = without(fit, cut.minX, cut.maxX);
    }
    return fit;
  }
}

function addSlab(out: Piece[], z0: number, z1: number, xs: readonly number[]): void {
  for (let i = 0; i + 1 < xs.length; i += 2) out.push(new Piece(xs[i] as number, z0, xs[i + 1] as number, z1));
}

/** Intervals less the open interval (a, b): what reaches into it is cut back to its ends. */
function without(xs: readonly number[], a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const lo = xs[i] as number;
    const hi = xs[i + 1] as number;
    if (hi <= a + EPS || lo >= b - EPS) {
      out.push(lo, hi);
      continue;
    }
    if (lo <= a + EPS) out.push(lo, Math.max(lo, a));
    if (hi >= b - EPS) out.push(Math.min(hi, b), hi);
  }
  return out;
}

/** Intervals pulled in by `m` at both ends; one narrower than 2m but within EPS becomes its midpoint. */
function shrink(xs: readonly number[], m: number): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) {
    let a = (xs[i] as number) + m;
    let b = (xs[i + 1] as number) - m;
    if (b >= a - 2 * EPS) {
      if (b < a) a = b = (a + b) * 0.5;
      out.push(a, b);
    }
  }
  return out;
}

function intersect(a: readonly number[], b: readonly number[]): number[] {
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i + 1 < a.length && j + 1 < b.length) {
    const lo = Math.max(a[i] as number, b[j] as number);
    const hi = Math.min(a[i + 1] as number, b[j + 1] as number);
    if (hi >= lo - EPS) out.push(lo, Math.max(lo, hi));
    if ((a[i + 1] as number) < (b[j + 1] as number)) i += 2;
    else j += 2;
  }
  return out;
}

/** Spans merged where they overlap or touch, flat and sorted (a stable sort by start, as `List.sort`). */
function merge(spans: [number, number][]): number[] {
  spans.sort((p, q) => compareDoubles(p[0], q[0]));
  const out: number[] = [];
  for (const [lo, hi] of spans) {
    const n = out.length;
    if (n > 0 && lo <= (out[n - 1] as number) + EPS) out[n - 1] = Math.max(out[n - 1] as number, hi);
    else out.push(lo, hi);
  }
  return out;
}

/** Sorted values (as `Arrays.sort`: −0 before 0) with near-duplicates (within EPS) dropped. */
function unique(values: readonly number[]): number[] {
  const sorted = [...values].sort(compareDoubles);
  const out: number[] = [];
  for (const v of sorted) {
    if (out.length === 0 || v - (out[out.length - 1] as number) > EPS) out.push(v);
  }
  return out;
}
