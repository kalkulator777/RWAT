/**
 * The doors tool's gestures in the views from the top, the side and the front
 * (docs/proposals/editor.md §3.9): a door's box is three-dimensional, and each of those
 * views shows two of its axes — the top x and z, the side x and y, the front z and y. A
 * drag inside a door's outline moves the box along the two, a drag on its edge or corner
 * stretches it; a click on a door selects it (Shift: adds it or takes it out). A press
 * away from every door is the view's: the camera, and a click that picks an object of the
 * model (for «Дверь по выделенному»). From the perspective view the tool takes nothing.
 *
 * Edges snap as the floor's do (../floor/snap.ts): to the other doors' and the floor
 * zones' edges, to the model's vertices, to the grid of 1/16 — the floor zones' edges are
 * their `min.y` along y, where a door's foot belongs. Alt held snaps to nothing. Each drag
 * is one journal entry: its commands share a key and merge until the button is released.
 */

import type { Command, LoadedModel } from '../../core/contracts';
import type { ViewDragger, ViewPointer } from '../../view3d/state';
import { clean, floatDecimal, SNAP_PX, snapShift, snapValue, vertexLines, zoneEdges, type SnapLines, type Snapping } from '../floor/snap';
import { zonesOf } from '../floor/zones';
import type { ToolSubject } from '../registry';
import { doorsOf, setDoorBox, type DoorBox } from './doors';

/** How near an edge, in screen pixels, a press grabs it. */
export const GRAB_PX = 6;

/** An axis of the OBJ frame: 0 x, 1 y, 2 z. */
export type Axis = 0 | 1 | 2;

/** A view the tool works in: its two axes on the screen (`u` to the right, `v` up or down) and the one it looks along. */
export interface ViewPlane {
  readonly u: Axis;
  readonly v: Axis;
  readonly n: Axis;
  /** True when +v runs down the screen (the top view: +z, the left side, at the bottom). */
  readonly vDown: boolean;
}

/** The views the tool takes presses from (view3d/cameras: the top as Blender's 7, the side as 1 from +Z, the front as 3 from −X). */
export const PLANES: Readonly<Record<'top' | 'side' | 'front', ViewPlane>> = {
  top: { u: 0, v: 2, n: 1, vDown: true },
  side: { u: 0, v: 1, n: 2, vDown: false },
  front: { u: 2, v: 1, n: 0, vDown: false },
};

/** The plane of a view the tool works in, or null for one it does not (the perspective). */
export function planeOf(view: ViewPointer['view']): ViewPlane | null {
  return view === 'top' || view === 'side' || view === 'front' ? PLANES[view] : null;
}

const MIN = ['minX', 'minY', 'minZ'] as const;
const MAX = ['maxX', 'maxY', 'maxZ'] as const;

/** A box's least and greatest value along an axis. */
export function span(box: DoorBox, axis: Axis): [number, number] {
  return [box[MIN[axis]], box[MAX[axis]]];
}

/** The box with its range along `axis` set to [lo, hi]. */
export function withSpan(box: DoorBox, axis: Axis, lo: number, hi: number): DoorBox {
  return { ...box, [MIN[axis]]: lo, [MAX[axis]]: hi };
}

/** What a press grabbed of a door. */
export type DoorGrab =
  | { readonly kind: 'move'; readonly index: number }
  /** An edge (one axis of the view) or a corner (both): which end of u and of v moves. */
  | { readonly kind: 'stretch'; readonly index: number; readonly u: 'min' | 'max' | null; readonly v: 'min' | 'max' | null };

/** Where a ray meets the plane of a view through `level` on its axis: the point's u and v; null for a ray along the plane. */
export function planePoint(at: ViewPointer, plane: ViewPlane, level: number): [number, number] | null {
  const d = at.direction[plane.n];
  if (Math.abs(d) < 1e-6) return null;
  const t = (level - at.origin[plane.n]) / d;
  return [at.origin[plane.u] + t * at.direction[plane.u], at.origin[plane.v] + t * at.direction[plane.v]];
}

function nearEnd(value: number, min: number, max: number, tolerance: number): 'min' | 'max' | null {
  const toMin = Math.abs(value - min);
  const toMax = Math.abs(value - max);
  if (Math.min(toMin, toMax) > tolerance) return null;
  return toMin <= toMax ? 'min' : 'max';
}

/**
 * What a press at (u, v) grabs of one door's outline in a view: an edge or a corner within
 * `tolerance`, its inside, or nothing. A side no wider than three tolerances (a door seen
 * edge-on: its leaf's thickness) has no edges to grab, only an inside, grown by the
 * tolerance so that it is found at all.
 */
export function grabOfDoor(box: DoorBox, index: number, plane: ViewPlane, u: number, v: number, tolerance: number): DoorGrab | null {
  const [u0, u1] = span(box, plane.u);
  const [v0, v1] = span(box, plane.v);
  if (u < u0 - tolerance || u > u1 + tolerance || v < v0 - tolerance || v > v1 + tolerance) return null;
  const eu = u1 - u0 > 3 * tolerance ? nearEnd(u, u0, u1, tolerance) : null;
  const ev = v1 - v0 > 3 * tolerance ? nearEnd(v, v0, v1, tolerance) : null;
  // within the outline and off its edges: inside
  return eu !== null || ev !== null ? { kind: 'stretch', index, u: eu, v: ev } : { kind: 'move', index };
}

/** What a press at (u, v) of a view grabs: the selected door first, then the others from the last (drawn on top) to the first; null for none. */
export function grabAt(boxes: readonly (DoorBox | null)[], selected: number | null, plane: ViewPlane, u: number, v: number, tolerance: number): DoorGrab | null {
  const order = boxes.map((_, i) => boxes.length - 1 - i);
  if (selected !== null && selected < boxes.length) order.unshift(selected);
  for (const i of order) {
    const box = boxes[i];
    if (box === undefined || box === null) continue;
    const grab = grabOfDoor(box, i, plane, u, v, tolerance);
    if (grab !== null) return grab;
  }
  return null;
}

/** The cursor over a grab, as the view shows its plane: u to the right, v down (top) or up (side, front). */
export function cursorOf(grab: DoorGrab, plane: ViewPlane): string {
  if (grab.kind === 'move') return 'move';
  if (grab.u !== null && grab.v !== null) return ((grab.u === 'max') === (grab.v === 'max')) === plane.vDown ? 'nwse-resize' : 'nesw-resize';
  return grab.u !== null ? 'ew-resize' : 'ns-resize';
}

const Y_LINES = new WeakMap<LoadedModel, Float64Array>();

/** The y of every vertex of the model, sorted, as the OBJ writes them; made once a model (x and z: ../floor/snap `vertexLines`). */
export function vertexYs(model: LoadedModel | null): Float64Array {
  if (model === null) return new Float64Array();
  let ys = Y_LINES.get(model);
  if (ys === undefined) {
    const seen = new Set<number>();
    for (const part of model.parts) {
      const p = part.positions;
      for (let i = 1; i < p.length; i += 3) seen.add(p[i] as number);
    }
    ys = Float64Array.from(new Set([...seen].map(floatDecimal))).sort();
    Y_LINES.set(model, ys);
  }
  return ys;
}

/**
 * Where an axis's edges may snap for door `except`: the other doors' edges and the floor
 * zones' (along y the zones' floors only: the engine reads no zone's top), and the model's
 * vertices.
 */
export function snapLines(subject: ToolSubject, axis: Axis, except: number | null): SnapLines {
  const doors = doorsOf(subject.typeJson).map((door) => door.box);
  const zones = zonesOf(subject.typeJson);
  const edges = [
    ...zoneEdges(doors, except, (box) => span(box, axis)),
    ...zoneEdges(zones, null, (zone) => (axis === 1 ? [zone.minY, zone.minY] : span(zone, axis))),
  ];
  const vertices = vertexLines(subject.model);
  return {
    zones: [...new Set(edges)].sort((a, b) => a - b),
    vertices: axis === 0 ? vertices.xs : axis === 2 ? vertices.zs : vertexYs(subject.model),
  };
}

/** What the doors tool asks of the session while a gesture goes on. */
export interface DoorsEditing {
  /** The open wagon as it stands. */
  subject(): ToolSubject;
  /** The door that is selected (the last of the selection's), or null. */
  selected(): number | null;
  /** Selects a door (null: none); `toggle` adds it or takes it out of the selection. */
  select(index: number | null, toggle?: boolean): void;
  dispatch(command: Command): boolean;
  snapping(): Snapping;
}

/** One gesture under way. */
interface Gesture {
  readonly grab: DoorGrab;
  readonly plane: ViewPlane;
  /** The level along the view's axis the pointer's ray is met at: the door's middle. */
  readonly level: number;
  readonly start: [number, number];
  /** The box as it was when pressed. */
  readonly box: DoorBox;
  /** The journal's key of this drag's commands. */
  readonly key: string;
  /** A command was refused (a generated pack): the drag does nothing more. */
  refused: boolean;
}

let serial = 0;

const NO_SNAPPING: Snapping = { grid: false, vertices: false, zones: false };

/** The doors tool's {@link ViewDragger}. */
export class DoorsDragger implements ViewDragger {
  private gesture: Gesture | null = null;
  private disposed = false;

  constructor(private readonly editing: DoorsEditing) {}

  /** Takes no more presses (the tool is off): a drag under way ends where it is. */
  dispose(): void {
    this.disposed = true;
    this.gesture = null;
  }

  private boxes(): (DoorBox | null)[] {
    return doorsOf(this.editing.subject().typeJson).map((door) => door.box);
  }

  /** What a press would grab, where on the view's plane; null when the press is not the tool's. */
  private grabFor(at: ViewPointer): { grab: DoorGrab; plane: ViewPlane; point: [number, number]; level: number } | null {
    const plane = this.disposed ? null : planeOf(at.view);
    if (plane === null) return null;
    const boxes = this.boxes();
    const selected = this.editing.selected();
    const reference = (selected === null ? undefined : boxes[selected]) ?? boxes.find((box) => box !== null) ?? null;
    const [lo, hi] = reference === null ? [0, 0] : span(reference, plane.n);
    const level = (lo + hi) / 2;
    const point = planePoint(at, plane, level);
    if (point === null) return null;
    const grab = grabAt(boxes, selected, plane, point[0], point[1], at.pixel * GRAB_PX);
    return grab === null ? null : { grab, plane, point, level };
  }

  press(at: ViewPointer): boolean {
    const found = this.grabFor(at);
    if (found === null) return false;
    const box = this.boxes()[found.grab.index];
    if (box === undefined || box === null) return false;
    this.gesture = { grab: found.grab, plane: found.plane, level: found.level, start: found.point, box, key: `doors:${++serial}`, refused: false };
    return true;
  }

  /** The box the drag makes of the pointer at `at`; null for none (a ray along the plane). */
  private target(gesture: Gesture, at: ViewPointer): DoorBox | null {
    const point = planePoint(at, gesture.plane, gesture.level);
    if (point === null) return null;
    const subject = this.editing.subject();
    const options = at.alt ? NO_SNAPPING : this.editing.snapping();
    const tolerance = Math.max(0, at.pixel * SNAP_PX);
    const { grab, plane, box } = gesture;
    const axes = [plane.u, plane.v] as const;
    let next = box;
    axes.forEach((axis, k) => {
      const lines = snapLines(subject, axis, grab.index);
      const [lo, hi] = span(box, axis);
      const pointer = point[k] as number;
      if (grab.kind === 'move') {
        const delta = snapShift(lo, hi, pointer - (gesture.start[k] as number), tolerance, lines, options).value;
        next = withSpan(next, axis, clean(lo + delta), clean(hi + delta));
        return;
      }
      const end = k === 0 ? grab.u : grab.v;
      if (end === null) return;
      const moved = snapValue(pointer, tolerance, lines, options).value;
      const fixed = end === 'min' ? hi : lo;
      next = withSpan(next, axis, Math.min(moved, fixed), Math.max(moved, fixed));
    });
    return next;
  }

  drag(at: ViewPointer): void {
    const gesture = this.gesture;
    if (gesture === null || gesture.refused || this.disposed) return;
    const box = this.target(gesture, at);
    if (box === null) return;
    const subject = this.editing.subject();
    const label = gesture.grab.kind === 'move' ? 'tools.doors.cmd.move' : 'tools.doors.cmd.resize';
    const command = setDoorBox(subject.typeFile, subject.typeJson, gesture.grab.index, box, { label, coalesceKey: gesture.key });
    if (command.ops.length > 0 && !this.editing.dispatch(command)) gesture.refused = true;
  }

  release(at: ViewPointer): void {
    this.drag(at);
    const gesture = this.gesture;
    this.gesture = null;
    if (gesture !== null && !gesture.refused) this.editing.select(gesture.grab.index);
  }

  click(at: ViewPointer): boolean {
    const gesture = this.gesture;
    this.gesture = null;
    if (gesture === null) return false;
    this.editing.select(gesture.grab.index, at.shift);
    return true;
  }

  cancel(): void {
    this.gesture = null;
  }

  hover(at: ViewPointer | null): string | null {
    if (at === null || this.gesture !== null) return null;
    const found = this.grabFor(at);
    return found === null ? null : cursorOf(found.grab, found.plane);
  }
}
