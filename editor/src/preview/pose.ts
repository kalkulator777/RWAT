/**
 * The transforms the preview hands the view (`ViewApi.setTransform`: a column-major 4×4
 * in the OBJ frame): a control or door leaf moved by its value, a piece of an animated
 * door at its door's progress.
 *
 * The engine moves them in its model frame (`StockModel.Control.transform`, `IrAnim`
 * frames turned by `IrAnim.toModelSpace`). The view works in the OBJ frame (editor.md
 * §3.8), and a turn about a hinge or a frame relative to the rest pose is the same motion
 * in either frame, so the hinge, the axis and the slide are only turned into the OBJ frame
 * (ports/objFrame) and the engine's own math runs there: ports/controlPose
 * `controlTransform` and ports/anim `frameAt`.
 */

import type { Vec3 } from '../core/contracts';
import { frameAt } from '../ports/anim';
import { controlTransform } from '../ports/controlPose';
import type { ModelControl } from '../ports/modelParts';
import { toObj } from '../ports/objFrame';

/** A point of the model frame in the OBJ frame (`ObjFrame.toObj`). */
export function objPoint(model: Vec3): Vec3 {
  return toObj(model[0], model[1], model[2]);
}

/**
 * A direction of the model frame in the OBJ frame: the turn of {@link objPoint} without
 * the lift (model `(x, y, z)` is OBJ `(−z, y, x)`). A proper rotation, so a turn keeps its
 * sense about an axis turned with it.
 */
export function objDirection(model: Vec3): Vec3 {
  return [-model[2] + 0, model[1], model[0]];
}

/**
 * Where a control or a door leaf stands at animation value `value`, OBJ frame: a slide of
 * `value × slide`, then a turn of `value × degrees` about the hinge (`ControlPose.transform`).
 * A control's value is `ControlValue.value` of its position (ports/controlPose
 * `controlValue`); a leaf's is its door's progress as it is.
 */
export function movingMatrix(part: ModelControl, value: number): Float32Array {
  const pivot = part.pivot === null ? null : objPoint(part.pivot);
  return Float32Array.from(controlTransform(value, objDirection(part.slide), pivot, objDirection(part.axis), part.degrees));
}

/**
 * Where a piece of an animated door stands at its door's progress: its track's frame there
 * (`IrAnim.frameAt`, row by row in the file) as a column-major matrix.
 */
export function animMatrix(frames: readonly ArrayLike<number>[], progress: number): Float32Array {
  return columnMajor(frameAt(frames, progress));
}

/** A 4×4 written row by row, written column by column (the transpose of its layout). */
export function columnMajor(rows: ArrayLike<number>): Float32Array {
  const out = new Float32Array(16);
  for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++) out[column * 4 + row] = rows[row * 4 + column]!;
  return out;
}
