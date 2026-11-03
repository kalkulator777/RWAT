/**
 * ./riderWalk: the constants of `kinematics/RiderWalk.java` and its `facesDoor` and `along`.
 * The floor check and the cab finder use them, so the golden folders floor_check and
 * cab_area run them over whole types; the answers here are Java's own (asked of
 * `RiderWalk` in jshell), at the edges of the slack where the floating point decides.
 */

import { describe, expect, it } from 'vitest';
import {
  BRIDGE_REACH,
  DOOR_SPAN_INSET,
  DOOR_WALL_SLACK,
  GANGWAY_CLEARANCE,
  PLAYER_HALF_WIDTH,
  SEAT_REACH,
  SNEAK_FACTOR,
  WALK_SPEED,
  along,
  facesDoor,
} from './riderWalk';
import { Door } from './wagonType';

/** Model-frame doors: a side door on the +X wall, an end door at the rear, a side door narrower than a body. */
const side = new Door('side', 1.4, 1.8, 2.0, 1.46, 3.8, 3.0);
const end = new Door('end', -0.45, 1.8, -10.0, 0.45, 3.8, -9.95);
const narrow = new Door('narrow', 1.4, 1.8, 2.0, 1.46, 3.8, 2.5);

describe('riderWalk', () => {
  it('has the engine constants', () => {
    expect([WALK_SPEED, SNEAK_FACTOR, PLAYER_HALF_WIDTH, DOOR_SPAN_INSET, SEAT_REACH]).toEqual([0.12, 0.3, 0.3, 0.1, 2.5]);
    expect([BRIDGE_REACH, DOOR_WALL_SLACK, GANGWAY_CLEARANCE]).toEqual([0.6, 0.4, 0.05]);
  });

  it('faces a door where a body touches its inner face within the slack, to the bit as Java', () => {
    expect([1.1, 0.7, 0.69, 1.5, 1.51].map((wall) => facesDoor(wall, side))).toEqual([true, true, false, false, false]);
    expect([-9.65, -9.25, -9.24, -10.05, -10.06].map((wall) => facesDoor(wall, end))).toEqual([true, true, false, false, false]);
  });

  it('puts a body inside a door span, or in the middle of a narrow one', () => {
    expect([0.0, 2.5, 9.0].map((v) => along(v, side))).toEqual([2.3, 2.5, 2.7]);
    expect([-1.0, 0.1, 1.0].map((v) => along(v, end))).toEqual([-0.15000000000000002, 0.1, 0.15000000000000002]);
    expect([0.0, 5.0].map((v) => along(v, narrow))).toEqual([2.25, 2.25]);
  });
});
