/**
 * Checks a type's walkable floor, doors and driver's chairs the way the rider's walk will
 * use them: port of `kinematics/FloorCheck.java` and `kinematics/FloorFinding.java`
 * (SPEC §9.6, §9.8; golden `fixtures/golden/floor_check/`; the Python port of the ways out
 * is `tools/floorgen.py`, `Region.door_seeds`).
 *
 * Each thing found is a {@link FloorFinding} of core/contracts: a stable code, the zone,
 * door or chair it is about, the numbers and names its line is made of, and the line
 * itself, word for word the engine's (built from the code, index and params alone, as
 * {@link findingText} does). Places and sizes in the params and the line are in the OBJ
 * frame, where the author measured them.
 */

import type { FloorFinding, FloorSubject, ProblemParam } from '../core/contracts';
import { Cut, type FloorRegion, type Piece } from './floorRegion';
import { toObj } from './objFrame';
import { BRIDGE_REACH, DOOR_SPAN_INSET, DOOR_WALL_SLACK, PLAYER_HALF_WIDTH, SEAT_REACH, facesDoor } from './riderWalk';
import { type Door, type WagonType, javaDoubleToString } from './wagonType';

const M = PLAYER_HALF_WIDTH;
/** Thicker than this, a door box is more than its leaf. */
const MAX_DOOR_THICKNESS = 0.6;
/** The cushion top above the floor by it a sitting player fits. */
export const MIN_SEAT_HEIGHT = 0.2;
/** The highest a chair's cushion may be above the floor by it. */
export const MAX_SEAT_HEIGHT = 1.5;
/** Step along a door's span when looking for a place to walk out through it. */
const SPAN_STEP = 0.05;

/** The kinds of thing the floor check finds (`FloorFinding.Code`), each with what it is about, in Java's order. */
export const FLOOR_CODES = {
  SEATS_WITHOUT_INTERIOR: 'cab',
  FLOOR_TOO_NARROW: 'floor',
  ZONE_TOO_NARROW: 'zone',
  DOOR_TOO_THICK: 'door',
  DOOR_TOO_NARROW: 'door',
  GANGWAY_NOT_IN_END_WALL: 'door',
  INNER_DOOR_NO_FLOOR: 'door',
  INNER_DOOR_FLOOR_THROUGH: 'door',
  INNER_DOOR_FLOOR_ROUND: 'door',
  DOOR_NOT_AT_FLOOR_END: 'door',
  ZONES_UNREACHABLE: 'zone',
  CAB_WITHOUT_SEAT: 'cab',
  SEAT_NOT_SITTABLE: 'seat',
} as const satisfies Record<string, FloorSubject>;

export type FloorCode = keyof typeof FLOOR_CODES;

/**
 * `String.format(Locale.ROOT, "%.<n>f", x)` of Java: half up from the shortest decimal
 * digits of the double (`1.005` → `1.01`, where `toFixed` gives `1.00`), the sign kept on
 * a zero (`-0.00`), `NaN` and the infinities by name.
 */
// The editor's javaNumbers port (agent A2.1) owns this rule as formatFixed; this copy keeps
// the floor check standing on its own until the two meet in one module.
function fixed(x: number, n: number): string {
  if (Number.isNaN(x)) return 'NaN';
  if (!Number.isFinite(x)) return x > 0 ? 'Infinity' : '-Infinity';
  const sign = x < 0 || Object.is(x, -0) ? '-' : '';
  const [mantissa = '0', exponentText = '0'] = Math.abs(x).toExponential().split('e');
  const digits = mantissa.replace('.', '');
  // the value is digits × 10^shift; scaled by 10^n it is digits × 10^(shift + n)
  const shift = Number(exponentText) - (digits.length - 1) + n;
  let scaled: bigint;
  if (shift >= 0) {
    scaled = BigInt(digits) * 10n ** BigInt(shift);
  } else {
    const unit = 10n ** BigInt(-shift);
    const whole = BigInt(digits);
    scaled = whole / unit + ((whole % unit) * 2n >= unit ? 1n : 0n);
  }
  const text = scaled.toString().padStart(n + 1, '0');
  return n === 0 ? `${sign}${text}` : `${sign}${text.slice(0, -n)}.${text.slice(-n)}`;
}

function number(params: Readonly<Record<string, ProblemParam>>, name: string): number {
  return params[name] as number;
}

/**
 * The line the type registry logs and `/rwat packs` shows, in English, made of the code,
 * the index and the params alone (`FloorFinding.text`): `%.2f` and `%.1f` as Java writes
 * them, the doorway slack as `Double.toString` (`0.4`), zone lists as `[1, 2]`.
 */
export function findingText(code: FloorCode, index: number, params: Readonly<Record<string, ProblemParam>>): string {
  const door = `door ${index} '${String(params.id)}'`;
  const f2 = (name: string): string => fixed(number(params, name), 2);
  const f1 = (name: string): string => fixed(number(params, name), 1);
  switch (code) {
    case 'SEATS_WITHOUT_INTERIOR':
      return 'cab.seats without an interior: a chair needs a floor to walk to it';
    case 'FLOOR_TOO_NARROW':
      return `a player fits nowhere on the floor: every part of it is narrower than ${f1('player_width')}`;
    case 'ZONE_TOO_NARROW':
      return (
        `zone ${index} holds no place a player fits (${f2('size_x')} x ${f2('size_z')}):` +
        ` widen it to ${f1('player_width')} or join it to a wider zone`
      );
    case 'DOOR_TOO_THICK':
      return `${door} is ${f2('thickness')} thick: is the box the door leaf?`;
    case 'DOOR_TOO_NARROW':
      return `${door} is too narrow to walk through`;
    case 'GANGWAY_NOT_IN_END_WALL':
      return `${door} is a gangway (connecting) door but not in an end wall`;
    case 'INNER_DOOR_NO_FLOOR':
      return `${door} (inner) touches no floor`;
    case 'INNER_DOOR_FLOOR_THROUGH':
      return (
        `${door} (inner): the floor runs through its doorway — the zones on its two sides touch or overlap in it,` +
        ' and a player stands half in the shut leaf: part them (any gap is wall; open, the door bridges it)'
      );
    case 'INNER_DOOR_FLOOR_ROUND':
      return (
        `${door} (inner): its two sides are one floor without it — the floor runs round it or through the wall` +
        ' beside it, so shut it is no wall'
      );
    case 'DOOR_NOT_AT_FLOOR_END':
      return (
        `${door} isn't where the floor ends: nobody can walk through it (a player must fit in front of it, inside` +
        ` its span, with the floor ending within ${javaDoubleToString(number(params, 'slack'))} of its inner face)`
      );
    case 'ZONES_UNREACHABLE':
      return (
        `floor zones [${(params.zones as number[]).join(', ')}] can't be walked to from zone 0 or a way in: join` +
        ' them (zones that touch join), put an inner door between them, or a door out of them'
      );
    case 'CAB_WITHOUT_SEAT':
      return 'a walkable cab needs a driver\'s chair (cab.seats): in a cab with a floor the keys drive only from a chair';
    case 'SEAT_NOT_SITTABLE':
      return (
        `cab.seats[${index}] (${f2('x')}, ${f2('y')}, ${f2('z')}): the nearest place to stand is ${f2('reach')}` +
        ` off (sitting reaches ${f1('sit_reach')}), its floor ${f2('height')} below the cushion` +
        ` (${f1('min_height')}..${f1('max_height')}; the seat is the top of the cushion)`
      );
  }
}

/** A finding with its params given in the line's order (`FloorFinding.of`). */
function finding(code: FloorCode, index: number, params: Record<string, ProblemParam> = {}): FloorFinding {
  return { code, subject: FLOOR_CODES[code], index, params, text: findingText(code, index, params) };
}

/** What's wrong with this type's floor, one line each, as the type registry logs it (`FloorCheck.problems`). */
export function problems(type: WagonType): string[] {
  return findings(type).map((f) => f.text);
}

/**
 * What's wrong with this type's floor, one finding each, in the engine's order
 * (`FloorCheck.findings`); empty if nothing.
 */
export function findings(type: WagonType): FloorFinding[] {
  const out: FloorFinding[] = [];
  const interior = type.interior;
  const seats = type.cab?.seats ?? [];
  if (interior === null) {
    if (seats.length > 0) out.push(finding('SEATS_WITHOUT_INTERIOR', -1));
    return out;
  }
  const zones = interior.zones;
  const doors = type.doors;
  const region = interior.region(M);
  const pieces = region.pieces;
  if (pieces.length === 0) out.push(finding('FLOOR_TOO_NARROW', -1, { player_width: 2 * M }));
  // the floor with every door between zones shut: its pieces are the parts walked
  const shut = interior.region(M, doors, 0);
  const parts = shut.pieces;
  // each zone's parts of the region: where a centre can stand inside it
  const inZone: number[][] = [];
  zones.forEach((z, i) => {
    const mine: number[] = [];
    parts.forEach((part, p) => {
      if (part.touches(z.minX, z.minZ, z.maxX, z.maxZ)) mine.push(p);
    });
    inZone.push(mine);
    const fits = pieces.some((piece) => piece.touches(z.minX, z.minZ, z.maxX, z.maxZ));
    if (!fits && pieces.length > 0) {
      // x along the car by z across, as the OBJ frame has them
      out.push(finding('ZONE_TOO_NARROW', i, { size_x: z.maxZ - z.minZ, size_z: z.maxX - z.minX, player_width: 2 * M }));
    }
  });
  // joined: by the floor alone (every door between zones shut), then by open doors too
  const alone = parts.map((_, i) => i);
  for (const [a, b] of shut.links()) union(alone, a, b);
  const parent = [...alone];
  const waysIn: number[] = []; // the floor pieces outside and gangway doors open onto
  doors.forEach((door, d) => {
    const id = door.id;
    const thick = door.axis() === 0 ? door.maxX - door.minX : door.maxZ - door.minZ;
    if (thick > MAX_DOOR_THICKNESS) out.push(finding('DOOR_TOO_THICK', d, { id, thickness: thick }));
    if (door.spanMax() - door.spanMin() - 2 * DOOR_SPAN_INSET <= 0.0) out.push(finding('DOOR_TOO_NARROW', d, { id }));
    if (door.connecting && door.axis() !== 2) out.push(finding('GANGWAY_NOT_IN_END_WALL', d, { id }));
    if (door.inner) {
      const [bMinX, bMinZ, bMaxX, bMaxZ] = bridge(door);
      const cut = Cut.shut(door, M);
      let first = -1;
      const before: number[] = []; // the parts its bridge reaches on each side
      const behind: number[] = [];
      parts.forEach((part, p) => {
        if (!part.touches(bMinX, bMinZ, bMaxX, bMaxZ)) return;
        if (first < 0) first = p;
        else union(parent, first, p);
        // no part reaches into the cut: each ends at or begins past it
        const end = door.axis() === 0 ? part.maxX : part.maxZ;
        if (end <= (door.axis() === 0 ? cut.minX : cut.minZ) + 1.0e-6) before.push(p);
        else behind.push(p);
      });
      if (first < 0) out.push(finding('INNER_DOOR_NO_FLOOR', d, { id }));
      if (door.fixed) return; // never shut
      if (pieces.some((piece) => cut.bites(piece))) out.push(finding('INNER_DOOR_FLOOR_THROUGH', d, { id }));
      const round = before.some((p) => behind.some((q) => find(alone, p) === find(alone, q)));
      if (round) out.push(finding('INNER_DOOR_FLOOR_ROUND', d, { id }));
    } else {
      const from = walkablePieces(door, shut);
      if (from.length === 0) out.push(finding('DOOR_NOT_AT_FLOOR_END', d, { id, slack: DOOR_WALL_SLACK }));
      waysIn.push(...from);
    }
  });
  const zone0 = inZone[0];
  if (zone0 !== undefined && zone0.length > 0) {
    // reached: zone 0's part of the floor, and every part a way in opens onto
    const reachedParts = new Set<number>([find(parent, zone0[0] as number)]);
    for (const p of waysIn) reachedParts.add(find(parent, p));
    const cut: number[] = [];
    for (let i = 1; i < zones.length; i++) {
      const mine = inZone[i] as number[];
      const reached = mine.some((p) => reachedParts.has(find(parent, p)));
      if (mine.length > 0 && !reached) cut.push(i);
    }
    if (cut.length > 0) out.push(finding('ZONES_UNREACHABLE', -1, { zones: cut }));
  }
  if (type.cab !== null && seats.length === 0) out.push(finding('CAB_WITHOUT_SEAT', -1));
  // a chair needs floor to sit down from: a place to stand within reach, the cushion above the floor there
  seats.forEach((seat, i) => {
    let reach = Number.POSITIVE_INFINITY;
    let floor = NaN;
    for (const piece of pieces) {
      const c = piece.clamp(seat.x, seat.z);
      const d = Math.hypot(c[0] - seat.x, c[1] - seat.z);
      if (d < reach) {
        reach = d;
        floor = interior.floorAt(c[0], c[1], M);
      }
    }
    const height = seat.y - floor;
    if (!(reach <= SEAT_REACH) || !(height >= MIN_SEAT_HEIGHT && height <= MAX_SEAT_HEIGHT)) {
      const [x, y, z] = toObj(seat.x, seat.y, seat.z);
      out.push(
        finding('SEAT_NOT_SITTABLE', i, {
          x,
          y,
          z,
          reach,
          sit_reach: SEAT_REACH,
          height,
          min_height: MIN_SEAT_HEIGHT,
          max_height: MAX_SEAT_HEIGHT,
        }),
      );
    }
  });
  return out;
}

/** True if a rider can walk out through a hull or gangway door: {@link walkablePieces} finds a piece. */
export function walkableThrough(door: Door, region: FloorRegion): boolean {
  return walkablePieces(door, region).length > 0;
}

/**
 * Every piece of the region a rider walks out through `door` from, in order; empty if none
 * (`FloorCheck.walkablePieces`): somewhere inside its span (inset) a player fits, and
 * walking straight at the door from there the floor ends at its inner face.
 */
export function walkablePieces(door: Door, region: FloorRegion): number[] {
  const side = door.axis() === 0;
  const out = door.outward();
  const lo = door.spanMin() + DOOR_SPAN_INSET;
  const hi = door.spanMax() - DOOR_SPAN_INSET;
  const found: number[] = [];
  region.pieces.forEach((p: Piece, i) => {
    const pLo = Math.max(lo, side ? p.minZ : p.minX);
    const pHi = Math.min(hi, side ? p.maxZ : p.maxX);
    if (pHi < pLo) return;
    const across = side ? (out > 0 ? p.maxX : p.minX) : out > 0 ? p.maxZ : p.minZ;
    for (let along = pLo; ; along = Math.min(pHi, along + SPAN_STEP)) {
      const wall = side ? region.reach(across, along, 0, out) : region.reach(along, across, 2, out);
      if (!Number.isNaN(wall) && facesDoor(wall, door)) {
        found.push(i);
        break;
      }
      if (along >= pHi) break;
    }
  });
  return found;
}

/** Where a rider's centre may be in an open inner door, as the walk bridges it: `[minX, minZ, maxX, maxZ]` (`FloorCheck.bridge`). */
export function bridge(door: Door): [number, number, number, number] {
  const lo = door.spanMin() + DOOR_SPAN_INSET;
  const hi = door.spanMax() - DOOR_SPAN_INSET;
  return door.axis() === 0
    ? [door.minX - BRIDGE_REACH, lo, door.maxX + BRIDGE_REACH, hi]
    : [lo, door.minZ - BRIDGE_REACH, hi, door.maxZ + BRIDGE_REACH];
}

/** The root of `i` in a union-find forest, halving the path (`FloorCheck.find`). */
export function find(parent: number[], i: number): number {
  let at = i;
  while (parent[at] !== at) {
    parent[at] = parent[parent[at] as number] as number;
    at = parent[at] as number;
  }
  return at;
}

/** Joins the sets of `a` and `b` (`FloorCheck.union`). */
export function union(parent: number[], a: number, b: number): void {
  parent[find(parent, a)] = find(parent, b);
}
