/**
 * The chairs tool's gestures in the view (docs/proposals/editor.md §2.3, §3.9): a press on
 * a place's disc selects it (Shift: adds it or takes it out) and a drag moves it over the
 * plan, at its cushion's height — snapping to a cushion's middle (taking its height; of
 * cushions one over another, the one nearest that height), else
 * each axis to a vertex of the model or to the grid of 1/16 block; a press on the head of
 * the selected place's arrow turns it round its dial, by 15° (Alt held: by 1°, and the
 * move snaps to nothing). Each drag is one journal entry: its commands share a key and
 * merge until the button is released.
 *
 * A press anywhere else is the view's: the camera turns, and a click on the model is a
 * pick, which places a chair (./session.ts). The plan is met from any view that looks down
 * on it; from the side or the front a drag moves nothing.
 */

import type { Command, Vec3, ViewDragger, ViewPointer } from '../../core/contracts';
import { rayPoint } from '../../view3d/overlayGeometry';
import { planPoint } from '../floor/gesture';
import { clean, free, SNAP_PX, snapValue, vertexLines } from '../floor/snap';
import type { ToolSubject } from '../registry';
import { DIAL_RADIUS, DISC_RADIUS, type PlaceView } from './analysis';
import { spotsOf } from './cushion';
import { facing, normalYaw, samePlace, yawOf, type Place, type PlaceRef } from './places';

/** How near a place's disc or its arrow's head, in screen pixels, a press grabs it (beyond the disc itself). */
export const GRAB_PX = 8;
/** The steps a yaw is turned by on the dial; Alt held, by {@link FINE_STEP}. */
export const YAW_STEP = 15;
export const FINE_STEP = 1;

/** What a moved place snaps to; Alt held snaps to nothing. */
export interface SeatSnapping {
  /** The middles of the model's cushions (their height too). */
  readonly cushions: boolean;
  readonly vertices: boolean;
  /** The grid of 1/16 block. */
  readonly grid: boolean;
}

export const ALL_SEAT_SNAPPING: SeatSnapping = { cushions: true, vertices: true, grid: true };

/** What the gestures ask of the session. */
export interface SeatEditing {
  subject(): ToolSubject;
  /** Every place as drawn now. */
  places(): readonly PlaceView[];
  /** The place selected last, or null. */
  selected(): PlaceRef | null;
  select(ref: PlaceRef | null, toggle?: boolean): void;
  dispatch(command: Command): boolean;
  snapping(): SeatSnapping;
}

/** What a press grabbed: a place to move, or the selected place's dial handle to turn it. */
export interface Grab {
  readonly kind: 'move' | 'turn';
  readonly ref: PlaceRef;
  readonly place: Place;
}

/** Where a ray passes a point, in blocks off it; infinite for a point behind the eye. */
function off(at: ViewPointer, point: Vec3): number {
  const t = rayPoint(at, point, Number.POSITIVE_INFINITY);
  if (t === null) return Number.POSITIVE_INFINITY;
  const p: Vec3 = [at.origin[0] + at.direction[0] * t, at.origin[1] + at.direction[1] * t, at.origin[2] + at.direction[2] * t];
  return Math.hypot(p[0] - point[0], p[1] - point[1], p[2] - point[2]);
}

/**
 * What a press grabs: the selected place's dial handle first, then its disc (two places
 * may stand at one point), then the place whose disc is nearest.
 */
export function grabAt(places: readonly PlaceView[], selected: PlaceRef | null, at: ViewPointer): Grab | null {
  const tolerance = at.pixel * GRAB_PX;
  const reach = Math.max(tolerance, DISC_RADIUS);
  const chosen = places.find((view) => samePlace(view.ref, selected) && view.place !== null);
  if (chosen?.place) {
    const handle: Vec3 = facingPoint(chosen.place);
    if (off(at, handle) <= Math.max(tolerance, DISC_RADIUS / 2)) return { kind: 'turn', ref: chosen.ref, place: chosen.place };
    if (off(at, chosen.place.at) <= reach) return { kind: 'move', ref: chosen.ref, place: chosen.place };
  }
  let best: Grab | null = null;
  let bestOff = reach;
  for (const view of places) {
    if (view.place === null) continue;
    const d = off(at, view.place.at);
    if (d <= bestOff) {
      best = { kind: 'move', ref: view.ref, place: view.place };
      bestOff = d;
    }
  }
  return best;
}

/** The head of a place's arrow: its dial's handle. */
export function facingPoint(place: Place): Vec3 {
  const d = facing(place.yaw);
  return [place.at[0] + d[0] * DIAL_RADIUS, place.at[1], place.at[2] + d[2] * DIAL_RADIUS];
}

/** The yaw a dial dragged to plan point (x, z) turns a place at `at` to: in steps of `step`, (−180, 180]. */
export function dialYaw(at: Vec3, x: number, z: number, step: number): number {
  const yaw = yawOf(x - at[0], z - at[2]);
  return normalYaw(Math.round(yaw / step) * step);
}

/**
 * Where a place moved to plan point (x, z) goes: onto a cushion's middle within `tolerance`
 * on the plan (and its height) — of those, the one nearest the place's height, as cushions
 * at many heights lie one over another seen from the top —, else each axis to a vertex,
 * else to the grid; free with nothing on.
 */
export function movedTo(place: Place, x: number, z: number, tolerance: number, spots: readonly Vec3[], lines: { xs: Float64Array; zs: Float64Array }, snapping: SeatSnapping): Vec3 {
  if (snapping.cushions) {
    let best: Vec3 | null = null;
    let bestRise = Number.POSITIVE_INFINITY;
    let bestOff = Number.POSITIVE_INFINITY;
    for (const spot of spots) {
      const d = Math.hypot(spot[0] - x, spot[2] - z);
      if (d > tolerance) continue;
      const rise = Math.abs(spot[1] - place.at[1]);
      if (rise < bestRise || (rise === bestRise && d < bestOff)) {
        best = spot;
        bestRise = rise;
        bestOff = d;
      }
    }
    if (best !== null) return [best[0], best[1], best[2]];
  }
  const options = { zones: false, vertices: snapping.vertices, grid: snapping.grid };
  const sx = snapValue(x, tolerance, { zones: [], vertices: lines.xs }, options).value;
  const sz = snapValue(z, tolerance, { zones: [], vertices: lines.zs }, options).value;
  return [clean(sx), place.at[1], clean(sz)];
}

let serial = 0;

/** One gesture under way. */
interface Gesture {
  readonly grab: Grab;
  readonly key: string;
  refused: boolean;
}

/** The chairs tool's {@link ViewDragger}. */
export class SeatDragger implements ViewDragger {
  private gesture: Gesture | null = null;
  private disposed = false;

  constructor(private readonly editing: SeatEditing) {}

  /** Takes no more presses (the tool is off): a drag under way ends where it is. */
  dispose(): void {
    this.disposed = true;
    this.gesture = null;
  }

  private grabFor(at: ViewPointer): Grab | null {
    if (this.disposed) return null;
    return grabAt(this.editing.places(), this.editing.selected(), at);
  }

  press(at: ViewPointer): boolean {
    const grab = this.grabFor(at);
    if (grab === null) return false;
    this.gesture = { grab, key: `seats:${++serial}`, refused: false };
    return true;
  }

  /** The place the pointer at `at` makes of the grabbed one, or null for none (a ray along its level). */
  private target(gesture: Gesture, at: ViewPointer): Place | null {
    const { place } = gesture.grab;
    const point = planPoint(at, place.at[1]);
    if (point === null) return null;
    if (gesture.grab.kind === 'turn') return { at: place.at, yaw: dialYaw(place.at, point[0], point[1], at.alt ? FINE_STEP : YAW_STEP) };
    const model = this.editing.subject().model;
    if (at.alt) return { at: [free(point[0]), place.at[1], free(point[1])], yaw: place.yaw };
    const snapping = this.editing.snapping();
    const tolerance = Math.max(0, at.pixel * SNAP_PX);
    const spots = snapping.cushions ? spotsOf(model) : [];
    return { at: movedTo(place, point[0], point[1], tolerance, spots, vertexLines(model), snapping), yaw: place.yaw };
  }

  drag(at: ViewPointer): void {
    const gesture = this.gesture;
    if (gesture === null || gesture.refused || this.disposed) return;
    const place = this.target(gesture, at);
    if (place === null) return;
    const subject = this.editing.subject();
    const { ref } = gesture.grab;
    const label = gesture.grab.kind === 'turn' ? 'tools.seats.cmd.turn' : 'tools.seats.cmd.move';
    const command = ref.kind.set(subject.typeFile, subject.typeJson, ref.index, place, { label, coalesceKey: gesture.key });
    if (command.ops.length > 0 && !this.editing.dispatch(command)) gesture.refused = true;
  }

  release(at: ViewPointer): void {
    this.drag(at);
    const gesture = this.gesture;
    this.gesture = null;
    if (gesture !== null) this.editing.select(gesture.grab.ref);
  }

  click(at: ViewPointer): boolean {
    const gesture = this.gesture;
    this.gesture = null;
    if (gesture === null) return false;
    if (gesture.grab.kind === 'turn') this.editing.select(gesture.grab.ref);
    else this.editing.select(gesture.grab.ref, at.shift);
    return true;
  }

  cancel(): void {
    this.gesture = null;
  }

  hover(at: ViewPointer | null): string | null {
    if (at === null || this.gesture !== null) return null;
    const grab = this.grabFor(at);
    if (grab === null) return null;
    return grab.kind === 'turn' ? 'grab' : 'move';
  }
}
