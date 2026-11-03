/**
 * What the floor check and the cab finder take from the rider's walk: port of the
 * constants of `kinematics/RiderWalk.java` and its `facesDoor` and `along` (golden
 * through `fixtures/golden/floor_check/` and `cab_area/`). The walk itself (`step`,
 * `exitDoor`, `gangwayArrival`) is not ported in v1 (docs/proposals/editor.md §4.2).
 */

import { clamp } from './floorRegion';

/** A door as these rules read it: `WagonType.Door` (model frame). */
export interface DoorFaces {
  outward(): number;
  innerFace(): number;
  spanMin(): number;
  spanMax(): number;
}

/** Interior walking speed, blocks/tick. */
export const WALK_SPEED = 0.12;
/** Crouched walk as a share of {@link WALK_SPEED}. */
export const SNEAK_FACTOR = 0.3;
/** Player half-width kept off the walls when clamping: the margin of the floor region. */
export const PLAYER_HALF_WIDTH = 0.3;
/** How far inside a door's edges the rider's centre must be to walk out through it. */
export const DOOR_SPAN_INSET = 0.1;
/** How far a door bridge reaches past each face of an open door between zones. */
export const BRIDGE_REACH = 0.6;
/** How far a hull door's inner face may sit from where the floor ends in front of it and still be the way out there. */
export const DOOR_WALL_SLACK = 0.4;
/** How far a walking rider may stand from a driver's chair and still sit down in it (feet to chair, horizontally). */
export const SEAT_REACH = 2.5;
/** Gap left between a rider arriving through a gangway door and its inner face. */
export const GANGWAY_CLEARANCE = 0.05;

/**
 * True if a floor whose centres reach `wall` (along the door's axis, towards it) ends at
 * the door: a body there touches its inner face within {@link DOOR_WALL_SLACK} (`RiderWalk.facesDoor`).
 */
export function facesDoor(wall: number, door: DoorFaces): boolean {
  const out = door.outward();
  const gap = out * (door.innerFace() - (wall + out * PLAYER_HALF_WIDTH));
  return gap >= -DOOR_WALL_SLACK && gap <= DOOR_WALL_SLACK;
}

/** A body-width point along a door's span: clamped inside it, or its middle if too narrow (`RiderWalk.along`). */
export function along(value: number, door: DoorFaces): number {
  const lo = door.spanMin() + PLAYER_HALF_WIDTH;
  const hi = door.spanMax() - PLAYER_HALF_WIDTH;
  return lo > hi ? (door.spanMin() + door.spanMax()) * 0.5 : clamp(value, lo, hi);
}
