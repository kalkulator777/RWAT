/**
 * Where a cab control or a door leaf moved by name stands and how it is moved by its
 * value (docs/proposals/editor.md §4.1): the animation value of a raw position, whether
 * the control shows, and its transform — a slide of `value × TL`, then a turn of
 * `value × ROT degrees` about the hinge — the way Immersive Railroading moves it.
 *
 * Ported from `convention/ControlValue.java` (`value`, `visible`) and
 * `convention/ControlPose.java` (`transform`). Golden: fixtures/golden/control_pose/.
 * Java reckons in `float`; so does the port (`Math.fround`) where it decides a value,
 * and the matrix is rounded to floats at the end. The transform is the same in any frame,
 * the hinge and the slide given in it.
 */

import type { Control } from './objectRole';

/** What the value of a control depends on: its kind, `OFFSET`, `INVERT` and `HIDE`. */
export type PoseControl = Pick<Control, 'kind' | 'offset' | 'invert' | 'hide'>;

/** A 3-vector. */
export type Vec3 = readonly [number, number, number];

const f = Math.fround;

/**
 * The animation value at a raw position 0…1 (IR `getValue`): `position + OFFSET`, mirrored
 * by `INVERT`, less ½ for the reverser and the combined handle (the model is drawn in
 * neutral). Rotation is this value × the hinge's degrees, slide this × the `TL` distance.
 *
 * Java: `ControlValue.value`.
 */
export function controlValue(control: PoseControl, position: number): number {
  const pos = f(f(position) + control.offset);
  const value = control.invert ? f(1 - pos) : pos;
  const centred = control.kind === 'REVERSER' || control.kind === 'THROTTLE_BRAKE';
  return centred ? f(value - 0.5) : value;
}

/**
 * False for a `HIDE` control at value 1 (IR: shown while `getValue != 1`).
 *
 * Java: `ControlValue.visible`.
 */
export function controlVisible(control: PoseControl, position: number): boolean {
  return !control.hide || controlValue(control, position) !== 1;
}

/**
 * The transform at `value` as 16 numbers, column by column (`Matrix4.elements` of
 * three.js, JOML's own layout): identity, then the slide, then — if there is a hinge and a
 * swing — the turn about it.
 *
 * @param slide   the slide at full travel
 * @param pivot   the hinge, or null for none (no turn)
 * @param axis    the hinge axis (unit)
 * @param degrees the swing at full travel
 *
 * Java: `ControlPose.transform`.
 */
export function controlTransform(value: number, slide: Vec3, pivot: Vec3 | null, axis: Vec3, degrees: number): number[] {
  const v = f(value);
  // translate(slide × value) · translate(pivot) · rotate(angle, axis) · translate(−pivot)
  // = the rotation R with the translation slide × value + pivot − R·pivot.
  const t: [number, number, number] = [f(slide[0] * v), f(slide[1] * v), f(slide[2] * v)];
  let r = [1, 0, 0, 0, 1, 0, 0, 0, 1]; // row by row
  if (pivot !== null && degrees !== 0) {
    const angle = f((f(v * f(degrees)) * Math.PI) / 180);
    r = rotation(angle, axis);
    for (let row = 0; row < 3; row++) {
      const turned = (r[row * 3] ?? 0) * pivot[0] + (r[row * 3 + 1] ?? 0) * pivot[1] + (r[row * 3 + 2] ?? 0) * pivot[2];
      t[row] = (t[row] ?? 0) + (pivot[row] ?? 0) - turned;
    }
  }
  const e = (i: number): number => f(r[i] ?? 0);
  return [e(0), e(3), e(6), 0, e(1), e(4), e(7), 0, e(2), e(5), e(8), 0, f(t[0]), f(t[1]), f(t[2]), 1];
}

/** The 3×3 turn by `angle` about the unit `axis`, row by row (the axis-angle matrix). */
function rotation(angle: number, axis: Vec3): number[] {
  const [x, y, z] = axis;
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  const c = 1 - cos;
  return [
    cos + x * x * c,
    x * y * c - z * sin,
    x * z * c + y * sin,
    y * x * c + z * sin,
    cos + y * y * c,
    y * z * c - x * sin,
    z * x * c - y * sin,
    z * y * c + x * sin,
    cos + z * z * c,
  ];
}

/** A column-by-column matrix as rows (the file's layout of the golden `transform`). */
export function rowMajor(columns: readonly number[]): number[] {
  const rows: number[] = [];
  for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++) rows.push(columns[column * 4 + row] ?? 0);
  return rows;
}
