/**
 * What the hinges tool shows of the open model (docs/proposals/editor.md §2.4, §3.9;
 * pack-capabilities §5): each cab control as the engine moves it (`ModelParts` control:
 * its hinge from its `…_ROT…` marker, `PivotAxis`; its swing `ROT_<deg>`; its slide
 * `TL_<f>_<axis>`), turned into the OBJ frame:
 *
 * - every hinge's marker point;
 * - for the control chosen: its axis as an arrow, the way a positive turn goes round it
 *   by the right-hand rule (a marker's vertex order flips it: an axis the wrong way round
 *   is seen at once); the arc a point of it travels from the control's travel's start
 *   (position 0) to its end (position 1), the arrow's head the way it goes; the slide of
 *   `TL` as an arrow; and the control at the end of its travel as a ghost of its box.
 *
 * Where the control stands is the engine's math (`ControlValue.value` → `ControlPose`,
 * ports/controlPose through preview/pose `movingMatrix`): the travel's ends are the values
 * of positions 0 and 1, `OFFSET`, `INVERT` and the reverser's centring taken in. Nothing
 * here is written to the pack. Pure: no DOM, no signals.
 */

import type { LoadedModel, OverlayShape, Vec3 } from '../../core/contracts';
import { controlValue } from '../../ports/controlPose';
import type { ModelControl } from '../../ports/modelParts';
import { boxToObj } from '../../ports/objFrame';
import type { ControlKind } from '../../ports/objectRole';
import { movingMatrix, objDirection, objPoint } from '../../preview/pose';
import { rig } from '../../preview/scene';

/** The tool's overlay layers, in drawing order. */
export const PIVOT_LAYERS = ['pivots.markers', 'pivots.ghost', 'pivots.travel', 'pivots.axis'] as const;

export type PivotLayer = (typeof PIVOT_LAYERS)[number];

/** The overlay style of a control at the end of its travel (view3d overlays). */
export const GHOST_STYLE = 'pivots.ghost';

/** The shortest an axis's arrow is drawn, blocks; a bigger control's is longer. */
const MIN_AXIS = 0.25;

/** A control as the tool shows it, OBJ frame. */
export interface PivotView {
  /** Its index in the model's controls (the engine's order). */
  readonly index: number;
  readonly key: string;
  readonly kind: ControlKind;
  /** The objects it is drawn as. */
  readonly objects: readonly string[];
  /** The hinge; null for a control with no `…_ROT…` marker. */
  readonly pivot: Vec3 | null;
  /** The hinge's axis, of unit length (+Y without a marker). */
  readonly axis: Vec3;
  /** The swing at full travel, degrees. */
  readonly degrees: number;
  /** The slide at full travel (`TL`). */
  readonly slide: Vec3;
  /** The animation value at the travel's start (position 0) and end (position 1). */
  readonly from: number;
  readonly to: number;
  /** Its box at rest: least and greatest corners. */
  readonly box: readonly [Vec3, Vec3];
  readonly offset: number;
  readonly invert: boolean;
}

/** What the tool shows of a model's controls. */
export interface PivotsPicture {
  readonly controls: readonly PivotView[];
  readonly layers: Readonly<Record<PivotLayer, OverlayShape[]>>;
}

/** A point moved by a column-major 4×4 matrix. */
export function moved(m: ArrayLike<number>, p: Vec3): Vec3 {
  const at = (i: number): number => m[i] as number;
  return [
    at(0) * p[0] + at(4) * p[1] + at(8) * p[2] + at(12),
    at(1) * p[0] + at(5) * p[1] + at(9) * p[2] + at(13),
    at(2) * p[0] + at(6) * p[1] + at(10) * p[2] + at(14),
  ];
}

/** The eight corners of a box. */
function corners([min, max]: readonly [Vec3, Vec3]): Vec3[] {
  const out: Vec3[] = [];
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) out.push([x, y, z]);
  return out;
}

/** The six faces of a box by its corners (as {@link corners} orders them), each a loop. */
const FACES: readonly (readonly number[])[] = [
  [0, 1, 3, 2],
  [4, 5, 7, 6],
  [0, 1, 5, 4],
  [2, 3, 7, 6],
  [0, 2, 6, 4],
  [1, 3, 7, 5],
];

function plus(a: Vec3, b: Vec3, scale = 1): Vec3 {
  return [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale];
}

function minus(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

/** How far a point is from the line through `at` along the unit `axis`. */
function offAxis(point: Vec3, at: Vec3, axis: Vec3): number {
  const d = minus(point, at);
  const along = d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2];
  return length(plus(d, axis, -along));
}

/** A control of the engine's reading as the tool shows it. */
export function pivotView(part: ModelControl, index: number, objects: readonly string[]): PivotView {
  const { min, max } = boxToObj(part.boxMin, part.boxMax);
  return {
    index,
    key: part.role.key,
    kind: part.role.kind,
    objects,
    pivot: part.pivot === null ? null : objPoint(part.pivot),
    axis: objDirection(part.axis),
    degrees: part.degrees,
    slide: objDirection(part.slide),
    from: controlValue(part.role, 0),
    to: controlValue(part.role, 1),
    box: [min, max],
    offset: part.role.offset,
    invert: part.role.invert,
  };
}

/** The controls of a model the engine moves, with the objects each is drawn as. */
export function pivotViews(model: LoadedModel): PivotView[] {
  return rig(model, null).controls.map((control, i) => pivotView(control.part, i, control.objects));
}

/** The shapes of the control chosen: its axis, its arc, its slide and its ghost at the end. */
function chosenShapes(part: ModelControl, view: PivotView, layers: Record<PivotLayer, OverlayShape[]>): void {
  const start = movingMatrix(part, view.from);
  const end = movingMatrix(part, view.to);
  const box = corners(view.box);
  const size = length(minus(view.box[1], view.box[0]));
  if (view.pivot !== null) {
    const half = Math.max(MIN_AXIS, size * 0.6) / 2;
    layers['pivots.axis'].push({ shape: 'arrow', from: plus(view.pivot, view.axis, -half), to: plus(view.pivot, view.axis, half), style: 'pivot' });
  }
  const sweep = (view.to - view.from) * view.degrees;
  if (view.pivot !== null && sweep !== 0) {
    // the corner furthest from the axis, where the travel is widest, at the travel's start
    const pivot = view.pivot;
    const far = box.reduce((best, c) => (offAxis(c, pivot, view.axis) > offAxis(best, pivot, view.axis) ? c : best));
    if (offAxis(far, pivot, view.axis) > 1.0e-6) {
      layers['pivots.travel'].push({ shape: 'arc', centre: plus(pivot, view.slide, view.from), axis: view.axis, from: moved(start, far), degrees: sweep, style: 'travel' });
    }
  }
  if (length(view.slide) > 0 && view.to !== view.from) {
    const middle: Vec3 = [(view.box[0][0] + view.box[1][0]) / 2, (view.box[0][1] + view.box[1][1]) / 2, (view.box[0][2] + view.box[1][2]) / 2];
    const at = moved(start, middle);
    layers['pivots.travel'].push({ shape: 'arrow', from: at, to: plus(at, view.slide, view.to - view.from), style: 'travel' });
  }
  const ghost = box.map((c) => moved(end, c));
  for (const face of FACES) layers['pivots.ghost'].push({ shape: 'polygon', points: face.map((i) => ghost[i] as Vec3), style: GHOST_STYLE });
}

function emptyLayers(): Record<PivotLayer, OverlayShape[]> {
  return Object.fromEntries(PIVOT_LAYERS.map((layer) => [layer, []])) as unknown as Record<PivotLayer, OverlayShape[]>;
}

/** The picture of a model's controls, `chosen` the control (an index of its controls) whose axis, travel and end are drawn. */
export function pivotsPicture(model: LoadedModel, chosen: number | null): PivotsPicture {
  const layers = emptyLayers();
  const controls = pivotViews(model);
  const parts = model.engine?.controls ?? [];
  for (const view of controls) {
    if (view.pivot !== null) layers['pivots.markers'].push({ shape: 'point', at: view.pivot, style: 'pivot' });
    const part = parts[view.index];
    if (view.index === chosen && part !== undefined) chosenShapes(part, view, layers);
  }
  return { controls, layers };
}

/** The control an object of the model is drawn as part of, or null. */
export function controlOfObject(controls: readonly PivotView[], object: string): number | null {
  return controls.find((view) => view.objects.includes(object))?.index ?? null;
}
