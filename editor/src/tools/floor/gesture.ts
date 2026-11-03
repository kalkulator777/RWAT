/**
 * The floor tool's gestures in the view from the top (docs/proposals/editor.md §2.3, §3.9):
 * a drag on the floor draws a zone, a drag inside a zone moves it, a drag on its edge or
 * corner stretches it; a click on a zone selects it (Shift: adds it or takes it out), and
 * Shift drags a new zone even over others. Edges snap ({@link snapValue}); Alt held snaps
 * to nothing. Each drag is one journal entry: its commands share a key and merge until the
 * button is released.
 *
 * Only the top view's presses are taken: from elsewhere the camera turns as usual and a
 * click picks (the floor's height is clicked from the side or in perspective); so, from
 * the top too, while a zone waits for its height.
 */

import type { Command } from '../../core/contracts';
import type { ViewDragger, ViewPointer } from '../../view3d/state';
import { clean, SNAP_PX, snapShift, snapValue, vertexLines, zoneEdges, type SnapLines, type Snapping } from './snap';
import { addZone, setZone, zoneOver, zonesOf, type PlanRect, type ZoneBox } from './zones';
import type { ToolSubject } from '../registry';

/** How near an edge, in screen pixels, a press grabs it. */
export const GRAB_PX = 6;

/** What the floor tool asks of the session while a gesture goes on. */
export interface FloorEditing {
  /** The open wagon as it stands. */
  subject(): ToolSubject;
  /** The zone that is selected (the last of the selection's), or null. */
  selected(): number | null;
  /** Selects a zone (null: none); `toggle` adds it or takes it out of the selection. */
  select(index: number | null, toggle?: boolean): void;
  dispatch(command: Command): boolean;
  snapping(): Snapping;
  /** The floor's height for a zone drawn from a point of the plan. */
  heightFor(x: number, z: number): number;
  /** True while a zone waits for its height from a click on the model: the clicks are the view's then. */
  picking(): boolean;
}

/** What a press grabbed. */
export type Grab =
  | { readonly kind: 'draw' }
  | { readonly kind: 'move'; readonly index: number }
  /** An edge (one axis) or a corner (both): which end of x and of z moves. */
  | { readonly kind: 'stretch'; readonly index: number; readonly x: 'min' | 'max' | null; readonly z: 'min' | 'max' | null };

/** Where a ray meets the level y = `height`, as a point of the plan; null for a ray along the level. */
export function planPoint(at: ViewPointer, height: number): [number, number] | null {
  const dy = at.direction[1];
  if (Math.abs(dy) < 1e-6) return null;
  const t = (height - at.origin[1]) / dy;
  return [at.origin[0] + t * at.direction[0], at.origin[2] + t * at.direction[2]];
}

function nearEnd(value: number, min: number, max: number, tolerance: number): 'min' | 'max' | null {
  const toMin = Math.abs(value - min);
  const toMax = Math.abs(value - max);
  if (Math.min(toMin, toMax) > tolerance) return null;
  return toMin <= toMax ? 'min' : 'max';
}

/** What a press at (x, z) grabs of one zone: an edge or a corner within `tolerance`, its inside, or nothing. */
function grabOf(zone: ZoneBox, index: number, x: number, z: number, tolerance: number): Grab | null {
  const alongX = z >= zone.minZ - tolerance && z <= zone.maxZ + tolerance;
  const alongZ = x >= zone.minX - tolerance && x <= zone.maxX + tolerance;
  const ex = alongX ? nearEnd(x, zone.minX, zone.maxX, tolerance) : null;
  const ez = alongZ ? nearEnd(z, zone.minZ, zone.maxZ, tolerance) : null;
  if (ex !== null || ez !== null) return { kind: 'stretch', index, x: ex, z: ez };
  if (x > zone.minX && x < zone.maxX && z > zone.minZ && z < zone.maxZ) return { kind: 'move', index };
  return null;
}

/**
 * What a press at (x, z) of the plan grabs: the selected zone first, then the others from
 * the last (drawn on top) to the first; the floor (a new zone) where none is near, or always
 * with `draw`.
 */
export function grabAt(zones: readonly (ZoneBox | null)[], selected: number | null, x: number, z: number, tolerance: number, draw = false): Grab {
  if (draw) return { kind: 'draw' };
  const order = zones.map((_, i) => zones.length - 1 - i);
  if (selected !== null && selected < zones.length) order.unshift(selected);
  for (const i of order) {
    const zone = zones[i];
    if (zone === undefined || zone === null) continue;
    const grab = grabOf(zone, i, x, z, tolerance);
    if (grab !== null) return grab;
  }
  return { kind: 'draw' };
}

/** The cursor over a grab, as the top view shows the plan: +x to the right, +z down. */
export function cursorOf(grab: Grab): string {
  if (grab.kind === 'draw') return 'crosshair';
  if (grab.kind === 'move') return 'move';
  if (grab.x !== null && grab.z !== null) return (grab.x === 'max') === (grab.z === 'max') ? 'nwse-resize' : 'nesw-resize';
  return grab.x !== null ? 'ew-resize' : 'ns-resize';
}

/** One gesture under way. */
interface Gesture {
  readonly grab: Grab;
  /** What is under the press, Shift aside: what a click selects. */
  readonly under: Grab;
  /** The level the pointer's ray is met at: the zone's floor, or the new zone's. */
  readonly height: number;
  readonly start: [number, number];
  /** The zone as it was when pressed (move, stretch). */
  readonly zone: ZoneBox | null;
  /** The journal's key of this drag's commands. */
  readonly key: string;
  /** The zone the drag works on: the drawn one once it is made. */
  index: number | null;
  /** A command was refused (a generated pack): the drag does nothing more. */
  refused: boolean;
}

let serial = 0;

/** The floor tool's {@link ViewDragger}. */
export class FloorDragger implements ViewDragger {
  private gesture: Gesture | null = null;
  private disposed = false;

  constructor(private readonly editing: FloorEditing) {}

  /** Takes no more presses (the tool is off): a drag under way ends where it is. */
  dispose(): void {
    this.disposed = true;
    this.gesture = null;
  }

  private zones(): (ZoneBox | null)[] {
    return zonesOf(this.editing.subject().typeJson);
  }

  /** The level presses are met at: the selected zone's floor, else the first zone's, else 0 (from the top any level gives the same plan). */
  private level(zones: readonly (ZoneBox | null)[]): number {
    const selected = this.editing.selected();
    const zone = (selected === null ? undefined : zones[selected]) ?? zones.find((z) => z !== null);
    return zone?.minY ?? 0;
  }

  /** What a press would grab (and, Shift aside, what is under it), where on the plan. */
  private grabFor(at: ViewPointer): { grab: Grab; under: Grab; point: [number, number] } | null {
    if (this.disposed || at.view !== 'top') return null;
    const zones = this.zones();
    const point = planPoint(at, this.level(zones));
    if (point === null) return null;
    const under = grabAt(zones, this.editing.selected(), point[0], point[1], at.pixel * GRAB_PX);
    return { grab: at.shift ? { kind: 'draw' } : under, under, point };
  }

  press(at: ViewPointer): boolean {
    const found = this.grabFor(at);
    if (found === null || this.editing.picking()) return false;
    const { grab, point } = found;
    const zone = grab.kind === 'draw' ? null : (this.zones()[grab.index] ?? null);
    const height = zone?.minY ?? this.editing.heightFor(point[0], point[1]);
    this.gesture = {
      grab,
      under: found.under,
      height,
      start: planPoint(at, height) ?? point,
      zone,
      key: `floor:${++serial}`,
      index: grab.kind === 'draw' ? null : grab.index,
      refused: false,
    };
    return true;
  }

  /** Where the edges go for the pointer at `at`: the zone the drag makes of it, or null for nothing yet (a drawn zone of no size). */
  private target(gesture: Gesture, at: ViewPointer): ZoneBox | null {
    const point = planPoint(at, gesture.height);
    if (point === null) return null;
    const zones = this.zones();
    const except = gesture.index;
    const options: Snapping = at.alt ? { grid: false, vertices: false, zones: false } : this.editing.snapping();
    const vertices = vertexLines(this.editing.subject().model);
    const xs: SnapLines = { zones: zoneEdges(zones, except, (z) => [z.minX, z.maxX]), vertices: vertices.xs };
    const zs: SnapLines = { zones: zoneEdges(zones, except, (z) => [z.minZ, z.maxZ]), vertices: vertices.zs };
    const tolerance = Math.max(0, at.pixel * SNAP_PX);
    const { grab, zone } = gesture;
    if (grab.kind === 'draw') {
      const a = [snapValue(gesture.start[0], tolerance, xs, options).value, snapValue(gesture.start[1], tolerance, zs, options).value];
      const b = [snapValue(point[0], tolerance, xs, options).value, snapValue(point[1], tolerance, zs, options).value];
      const plan: PlanRect = { minX: a[0] as number, minZ: a[1] as number, maxX: b[0] as number, maxZ: b[1] as number };
      if (plan.minX === plan.maxX || plan.minZ === plan.maxZ) return null;
      return zoneOver(plan, gesture.height);
    }
    if (zone === null) return null;
    if (grab.kind === 'move') {
      const dx = snapShift(zone.minX, zone.maxX, point[0] - gesture.start[0], tolerance, xs, options).value;
      const dz = snapShift(zone.minZ, zone.maxZ, point[1] - gesture.start[1], tolerance, zs, options).value;
      return { ...zone, minX: clean(zone.minX + dx), maxX: clean(zone.maxX + dx), minZ: clean(zone.minZ + dz), maxZ: clean(zone.maxZ + dz) };
    }
    let { minX, maxX, minZ, maxZ } = zone;
    if (grab.x !== null) {
      const moved = snapValue(point[0], tolerance, xs, options).value;
      const fixed = grab.x === 'min' ? zone.maxX : zone.minX;
      minX = Math.min(moved, fixed);
      maxX = Math.max(moved, fixed);
    }
    if (grab.z !== null) {
      const moved = snapValue(point[1], tolerance, zs, options).value;
      const fixed = grab.z === 'min' ? zone.maxZ : zone.minZ;
      minZ = Math.min(moved, fixed);
      maxZ = Math.max(moved, fixed);
    }
    return { ...zone, minX, maxX, minZ, maxZ };
  }

  drag(at: ViewPointer): void {
    const gesture = this.gesture;
    if (gesture === null || gesture.refused || this.disposed) return;
    const zone = this.target(gesture, at);
    if (zone === null) return;
    const subject = this.editing.subject();
    if (gesture.grab.kind === 'draw' && gesture.index === null) {
      const index = this.zones().length;
      if (!this.editing.dispatch(addZone(subject.typeFile, subject.typeJson, zone, gesture.key))) {
        gesture.refused = true;
        return;
      }
      gesture.index = index;
      this.editing.select(index);
      return;
    }
    if (gesture.index === null) return;
    const label = gesture.grab.kind === 'draw' ? 'tools.floor.cmd.add' : gesture.grab.kind === 'move' ? 'tools.floor.cmd.move' : 'tools.floor.cmd.resize';
    const command = setZone(subject.typeFile, subject.typeJson, gesture.index, zone, { label, coalesceKey: gesture.key });
    if (command.ops.length > 0 && !this.editing.dispatch(command)) gesture.refused = true;
  }

  release(at: ViewPointer): void {
    this.drag(at);
    const gesture = this.gesture;
    this.gesture = null;
    if (gesture !== null && gesture.index !== null && !gesture.refused) this.editing.select(gesture.index);
  }

  click(at: ViewPointer): boolean {
    const gesture = this.gesture;
    this.gesture = null;
    if (gesture === null || gesture.under.kind === 'draw') return false;
    this.editing.select(gesture.under.index, at.shift);
    return true;
  }

  cancel(): void {
    this.gesture = null;
  }

  hover(at: ViewPointer | null): string | null {
    if (at === null || this.gesture !== null) return null;
    const found = this.grabFor(at);
    return found === null ? null : cursorOf(found.under);
  }
}
