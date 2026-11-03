/**
 * The two frames a wagon's geometry is told in, and the one way between them: port of
 * `stock/ObjFrame.java` (roadmap R6; golden `fixtures/golden/obj_frame/`; the Python port
 * is `tools/floorgen.py`, `point_from_obj`, `box_from_obj` and back).
 *
 * The OBJ frame is the pack's, as Blender shows the model: X along the car, the front
 * towards −X, Y up, +Z the left side. The model frame is the engine's: +Z forward, X
 * across (+X the left side), Y up, the railhead at y = {@link RAILHEAD_Y}. From the one to
 * the other: `x = z_obj`, `y = y_obj + Y_LIFT`, `z = −x_obj`. A box keeps its min and
 * max on X and Y; along the car they trade places. Distances along the car (`length`,
 * `bogies`, `couplers`) and yaws are the same in both frames.
 */

/** Railhead height above the path spline (`ObjFrame.RAILHEAD_Y`). */
export const RAILHEAD_Y = 0.40625;
/** OBJ y where the wheel tread bottoms out (`ObjFrame.TREAD_BOTTOM_Y`). */
export const TREAD_BOTTOM_Y = -0.03;
/** How far the model frame lifts the OBJ: the wheel tread onto the railhead, 0.43625 (`ObjFrame.Y_LIFT`). */
export const Y_LIFT = RAILHEAD_Y - TREAD_BOTTOM_Y;

/** A point of the OBJ frame in the model frame: `[x, y, z]` (`ObjFrame.point`). */
export function point(xObj: number, yObj: number, zObj: number): [number, number, number] {
  return [zObj, yObj + Y_LIFT, -xObj];
}

/**
 * A box of the OBJ frame, given by its least and greatest corners, in the model frame:
 * `[minX, minY, minZ, maxX, maxY, maxZ]` (`ObjFrame.box`). The OBJ's x range turns round
 * into the model's z range: `minZ = −max.x_obj`.
 */
export function box(
  minObj: readonly number[],
  maxObj: readonly number[],
): [number, number, number, number, number, number] {
  const [minX = NaN, minY = NaN, minZ = NaN] = minObj;
  const [maxX = NaN, maxY = NaN, maxZ = NaN] = maxObj;
  return [minZ, minY + Y_LIFT, -maxX, maxZ, maxY + Y_LIFT, -minX];
}

/** A point of the model frame in the OBJ frame, where the author finds it in Blender: `[x, y, z]` (`ObjFrame.toObj`). */
export function toObj(x: number, y: number, z: number): [number, number, number] {
  return [-z, y - Y_LIFT, x];
}

/**
 * A box of the model frame back in the OBJ frame, as its least and greatest corners: the
 * model's (min x, min y, max z) is the OBJ's least corner. Java has no method for it (the
 * golden runner turns the two corners with `toObj`); the editor needs it to write markup
 * back.
 */
export function boxToObj(
  min: readonly number[],
  max: readonly number[],
): { min: [number, number, number]; max: [number, number, number] } {
  const [loX = NaN, loY = NaN, loZ = NaN] = min;
  const [hiX = NaN, hiY = NaN, hiZ = NaN] = max;
  return { min: toObj(loX, loY, hiZ), max: toObj(hiX, hiY, loZ) };
}
