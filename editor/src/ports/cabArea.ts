/**
 * Which part of a car's floor is a driver's cab, and which doors lead into one: port of
 * `kinematics/CabArea.java` (SPEC §9.2, the driver's key; golden `fixtures/golden/cab_area/`).
 *
 * A cab is a piece of walkable floor a driver's chair stands at, together with every
 * piece one walks to from there without passing a door — the pieces of the floor region
 * that touch, with every door between zones shut, as the floor check joins them. A door
 * leads into a cab if the floor it opens onto from inside is a cab's; a doorway without a
 * leaf (`fixed`) never does. A door of a cab door's group wants the key too.
 *
 * A chair belongs to the cab of a chair listed before it if that cab's floor is within
 * sitting reach; otherwise the floor nearest to it is its cab. All in the model frame.
 */

import { bridge, find, union, walkablePieces } from './floorCheck';
import type { FloorRegion, Piece } from './floorRegion';
import { PLAYER_HALF_WIDTH, SEAT_REACH } from './riderWalk';
import type { Door, Seat, WagonType } from './wagonType';

const M = PLAYER_HALF_WIDTH;

function distance(piece: Piece, x: number, z: number): number {
  const c = piece.clamp(x, z);
  return Math.hypot(c[0] - x, c[1] - z);
}

function nearestPiece(pieces: readonly Piece[], x: number, z: number): number {
  let best = -1;
  let bestDist = Number.MAX_VALUE;
  pieces.forEach((piece, p) => {
    const d = distance(piece, x, z);
    if (d < bestDist) {
      best = p;
      bestDist = d;
    }
  });
  return best;
}

/** The cabs of one type (`CabArea`): made by {@link cabArea}, {@link NO_CAB_AREA} for a car without a walkable cab. */
export class CabArea {
  constructor(
    /** The floor at the player's half-width with every door between zones shut, or null without a walkable cab. */
    readonly region: FloorRegion | null,
    /** Per piece of the region, the cab it is part of, −1 if none: what the floor tool shades. */
    readonly cabOfPiece: readonly number[],
    private readonly cabOfChairs: readonly number[],
    private readonly chairs: readonly Seat[],
    /** The doors that want the driver's key ({@link cabDoor}), as open-door bits. */
    readonly cabDoors: number,
  ) {}

  /** How many cabs the car has (0 without a walkable one). */
  cabs(): number {
    let count = 0;
    for (const cab of this.cabOfChairs) count = Math.max(count, cab + 1);
    return count;
  }

  /** The cab a rider whose feet are at (x, z) stands in, −1 if none — the saloon, a walkway, an open door between floors. */
  cabAt(x: number, z: number): number {
    if (this.region === null) return -1;
    const pieces = this.region.pieces;
    for (let i = this.region.firstPieceReaching(z - 1.0e-6); i < pieces.length; i++) {
      const piece = pieces[i] as Piece;
      if (piece.minZ > z + 1.0e-6) break;
      const cab = this.cabOfPiece[i] as number;
      if (cab >= 0 && piece.holds(x, z)) return cab;
    }
    return -1;
  }

  /** The cab driver's chair `chair` stands in, −1 if none. */
  cabOfChair(chair: number): number {
    return this.cabOfChairs[chair] ?? -1;
  }

  /** The chair of cab `cab` nearest to (x, z) — the desk a rider standing there works — or −1 if the cab has none. */
  nearestChair(cab: number, x: number, z: number): number {
    let best = -1;
    let bestDist = Number.MAX_VALUE;
    this.cabOfChairs.forEach((owner, c) => {
      if (owner !== cab || cab < 0) return;
      const chair = this.chairs[c] as Seat;
      const d = Math.hypot(chair.x - x, chair.z - z);
      if (d < bestDist) {
        best = c;
        bestDist = d;
      }
    });
    return best;
  }

  /** True if door `index` of the type's list wants the driver's key: it leads into a cab, or opens with such a door. */
  cabDoor(index: number): boolean {
    return index >= 0 && index < 32 && ((this.cabDoors >> index) & 1) !== 0;
  }
}

/** A car without a walkable cab: no part of it is one (`CabArea.NONE`). */
export const NO_CAB_AREA = new CabArea(null, [], [], [], 0);

const CACHE = new WeakMap<WagonType, CabArea>();

/** The cabs of `type` (made once per type); {@link NO_CAB_AREA} for a car without a walkable one (`CabArea.of`). */
export function cabArea(type: WagonType | null): CabArea {
  if (type === null || type.cab === null || type.interior === null || type.cab.seats.length === 0) return NO_CAB_AREA;
  let area = CACHE.get(type);
  if (area === undefined) {
    area = build(type, type.interior.region(M, type.doors, 0), type.cab.seats);
    CACHE.set(type, area);
  }
  return area;
}

function build(type: WagonType, region: FloorRegion, chairs: readonly Seat[]): CabArea {
  const pieces = region.pieces;
  const parent = pieces.map((_, i) => i);
  for (const [a, b] of region.links()) union(parent, a, b);
  // each chair's cab: the floor where one stands to sit down in it, and all it joins
  const roots: number[] = [];
  const cabOfChair = chairs.map((chair) => {
    let piece = -1;
    let reach = SEAT_REACH;
    pieces.forEach((candidate, p) => {
      // the floor of a cab found already, within sitting reach
      const d = distance(candidate, chair.x, chair.z);
      if (d <= reach && roots.includes(find(parent, p))) {
        piece = p;
        reach = d;
      }
    });
    if (piece < 0) piece = nearestPiece(pieces, chair.x, chair.z);
    if (piece < 0) return -1;
    const root = find(parent, piece);
    if (!roots.includes(root)) roots.push(root);
    return roots.indexOf(root);
  });
  const cabOfPiece = pieces.map((_, p) => roots.indexOf(find(parent, p)));
  const bridgeIntoCab = ([minX, minZ, maxX, maxZ]: readonly [number, number, number, number]): boolean =>
    pieces.some((piece, p) => (cabOfPiece[p] as number) >= 0 && piece.touches(minX, minZ, maxX, maxZ));
  let cabDoors = 0;
  const doors = type.doors;
  for (let d = 0; d < doors.length && d < 32; d++) {
    const door = doors[d] as Door;
    if (door.fixed) continue;
    const intoCab = door.inner
      ? bridgeIntoCab(bridge(door))
      : walkablePieces(door, region).some((piece) => (cabOfPiece[piece] as number) >= 0);
    if (intoCab) cabDoors |= 1 << d;
  }
  // a door of a cab door's group opens with it: it wants the key as well
  let grouped = 0;
  for (let d = 0; d < doors.length && d < 32; d++) {
    for (let e = 0; e < doors.length && e < 32; e++) {
      const door = doors[d] as Door;
      if (((cabDoors >> e) & 1) !== 0 && !door.fixed && door.groupedWith(doors[e] as Door)) grouped |= 1 << d;
    }
  }
  return new CabArea(region, cabOfPiece, cabOfChair, chairs, cabDoors | grouped);
}

/**
 * The passengers' side doors of `type` on one side of the model, as open-door bits
 * (`CabArea.passengerSideDoors`): doors in a side wall to outside, with a leaf, facing
 * `modelSide` (+1 = the model's +X), not wanting the key; on a car with a cab only the
 * doors of a group count.
 */
export function passengerSideDoors(type: WagonType, modelSide: number): number {
  const area = cabArea(type);
  const cab = type.cab !== null;
  let bits = 0;
  for (let d = 0; d < type.doors.length && d < 32; d++) {
    const door = type.doors[d] as Door;
    const sideDoorOut = door.axis() === 0 && door.external() && !door.fixed && door.outward() === modelSide;
    if (sideDoorOut && !area.cabDoor(d) && (!cab || door.group !== null)) bits |= 1 << d;
  }
  return bits;
}

/** Which side of a car's model is the driver's left, +1 = the model's +X (`CabArea.leftSide`); `facing` +1 = +s. */
export function leftSide(flipped: boolean, facing: number): number {
  return (flipped ? -1 : 1) * (facing < 0 ? -1 : 1);
}

/** Which way along the path a driver at `chair` looks, +1 = +s (`CabArea.facing`); null: a cab seat without a walkable interior. */
export function facing(flipped: boolean, chair: Seat | null): number {
  const back = chair !== null && chair.facesBack();
  return (flipped ? -1 : 1) * (back ? -1 : 1);
}
