/**
 * Where the guides of the 3D view go, in the OBJ frame the view draws in (docs/proposals/
 * editor.md §3.8): the railhead and the rails, and, once the wagon type is known, its
 * bogie pivots, its ends, its coupler points and its collision hull. The numbers come from
 * the ports — the frames from ports/objFrame, the type's geometry from ports/wagonType —
 * so the view shows what the engine uses, not a copy of its rules.
 *
 * Pure: no three, no DOM.
 */

import type { Vec3, WagonFrame } from '../core/contracts';
import { boxToObj, RAILHEAD_Y, toObj } from '../ports/objFrame';
import type { WagonType } from '../ports/wagonType';

export type { WagonFrame } from '../core/contracts';

/** The railhead in the OBJ frame: the plane the wheel treads stand on (`ObjFrame.RAILHEAD_Y` taken back to the OBJ, −0.03). */
export const RAILHEAD_OBJ_Y = toObj(0, RAILHEAD_Y, 0)[1];

/**
 * How far the rails are from the track's centre line, blocks: the wheel line of
 * `path/SwitchThroat.WHEEL_LINE`, which no port carries yet. The rails run along X at
 * z = ±RAIL_Z on the railhead.
 */
export const RAIL_Z = 0.8125;

/** The guides' numbers of a type the port has read (core/contracts `WagonFrame`, what `ViewApi.setFrame` is told). */
export function wagonFrame(type: Pick<WagonType, 'length' | 'bogieOffsets' | 'couplerReach' | 'collidableHull'>): WagonFrame {
  return {
    length: type.length,
    bogies: [...type.bogieOffsets],
    couplerReach: [type.couplerReach(true), type.couplerReach(false)],
    hull: type.collidableHull(),
  };
}

/** A type's guides in the OBJ frame: x along the car, the front towards −X. */
export interface FrameGuides {
  /** x of each bogie pivot, front first. */
  readonly pivots: readonly number[];
  /** x of the front and the rear end (±length/2). */
  readonly ends: readonly [number, number];
  /** x of the front and the rear coupler point. */
  readonly couplers: readonly [number, number];
  /** The collision hull as its least and greatest corner. */
  readonly hull: { readonly min: Vec3; readonly max: Vec3 };
}

/** x in the OBJ frame of a place `z` blocks forward of the body's centre. */
function alongObj(z: number): number {
  return toObj(0, RAILHEAD_Y, z)[0];
}

/** Where a type's guides go in the OBJ frame. */
export function frameGuides(frame: WagonFrame): FrameGuides {
  const { hull } = frame;
  return {
    pivots: frame.bogies.map(alongObj),
    ends: [alongObj(frame.length / 2), alongObj(-frame.length / 2)],
    couplers: [alongObj(frame.couplerReach[0]), alongObj(-frame.couplerReach[1])],
    hull: boxToObj([hull.minX, hull.minY, hull.minZ], [hull.maxX, hull.maxY, hull.maxZ]),
  };
}
