/**
 * The floor tool while it is on (docs/proposals/editor.md §2.3, §3.9): the view goes to the
 * top, the tool takes its presses (./gesture.ts), draws its layers (./analysis.ts) again
 * after every edit, and, asked to, takes a zone's floor height from the next click on the
 * model (./height.ts). Its state — the doors' state the floor is drawn with, what edges
 * snap to, the zone waiting for its height — lives here, read by the inspector's section
 * (./FloorInspector.tsx).
 *
 * The layers are worked out at once after an edit while that is quick; once it takes long
 * (a big type: ports' work of tens of milliseconds) they follow a moment after the last of
 * a run of edits instead, so a drag stays smooth.
 */

import { batch, effect, signal, type ReadonlySignal, type Signal } from '@preact/signals';
import type { Command, Link, PickHit } from '../../core/contracts';
import type { ToolContext, ToolSession, ToolSubject } from '../registry';
import { FLOOR_LAYERS, floorPicture, type DoorState, type FloorPicture } from './analysis';
import { FloorDragger } from './gesture';
import { floorUnder, vertexYNear } from './height';
import { ALL_SNAPPING, type Snapping } from './snap';
import { addZone, moveZoneTo, removeZone, selectedZones, setZoneHeight, setZoneNumber, zoneLink, zoneOver, zonesOf, type ZoneBox } from './zones';

/**
 * When the floor is drawn again: once a picture took longer than `slowMs`, the next is
 * drawn `settleMs` after the last of a run of edits. The tool reads it when turned on; the
 * unit tests, whose instrumented runs are slow, draw at once (`slowMs` infinite).
 */
export const FLOOR_TIMING = { slowMs: 30, settleMs: 120 };

/** What the floor tool holds while it is on; its section of the inspector reads and drives it. */
export interface FloorTool {
  readonly subject: ReadonlySignal<ToolSubject | null>;
  /** The editor's selection (the selected zones are links in it). */
  readonly selection: ReadonlySignal<readonly Link[]>;
  /** The picture drawn now. */
  readonly picture: ReadonlySignal<FloorPicture | null>;
  readonly doorState: Signal<DoorState>;
  readonly snapping: Signal<Snapping>;
  /** The zone whose floor the next click on the model sets, or null. */
  readonly pickingHeight: Signal<number | null>;
  /** The selected zone (the last of the selection's), or null. */
  selected(): number | null;
  select(index: number | null, toggle?: boolean): void;
  /** Selects what a finding points at (zones, a door, a chair). */
  show(links: readonly Link[]): void;
  dispatch(command: Command): boolean;
  /** Adds a zone (from the keyboard): a block's square in the middle of the selected zone (or the first), on its floor; with no zone, at the car's middle. */
  add(): void;
  remove(index: number): void;
  /** Moves zone `index` to place `to` in the list. */
  reorder(index: number, to: number): void;
  setNumber(index: number, corner: 'min' | 'max', axis: 0 | 1 | 2, value: number): void;
  setHeight(index: number, y: number): void;
}

/** The floor of a new zone drawn from (x, z): the zone under it or the nearest zone's, else the model's floor around it, else 0. */
export function heightFor(subject: ToolSubject, x: number, z: number): number {
  let nearest: ZoneBox | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const zone of zonesOf(subject.typeJson)) {
    if (zone === null) continue;
    const d = Math.hypot(Math.max(zone.minX - x, 0, x - zone.maxX), Math.max(zone.minZ - z, 0, z - zone.maxZ));
    if (d < distance) {
      nearest = zone;
      distance = d;
    }
  }
  if (nearest !== null) return nearest.minY;
  const model = subject.model;
  return (model === null ? null : floorUnder(model, { minX: x - 1, minZ: z - 1, maxX: x + 1, maxZ: z + 1 })) ?? 0;
}

/** Turns the floor tool on: returns its state and what turns it off (the session's `dispose`). */
export function startFloor(context: ToolContext, options: { settleMs?: number; slowMs?: number } = {}): Pick<ToolSession, 'dispose'> & { tool: FloorTool } {
  const settle = options.settleMs ?? FLOOR_TIMING.settleMs;
  const slow = options.slowMs ?? FLOOR_TIMING.slowMs;
  const subject = (): ToolSubject => context.subject.peek() as ToolSubject;
  const doorState = signal<DoorState>('closed');
  const snapping = signal<Snapping>(ALL_SNAPPING);
  const pickingHeight = signal<number | null>(null);
  const picture = signal<FloorPicture | null>(null);

  const selected = (): number | null => {
    const now = context.subject.peek();
    if (now === null) return null;
    const zones = selectedZones(context.selection.peek(), now.wagon);
    const last = zones.at(-1);
    return last === undefined || last >= zonesOf(now.typeJson).length ? null : last;
  };

  const select = (index: number | null, toggle = false): void => {
    const wagon = subject().wagon;
    const others = context.selection.peek().filter((link) => link.kind !== 'zone' || link.type !== wagon);
    if (index === null) {
      context.selection.value = toggle ? context.selection.peek() : others;
      return;
    }
    const link = zoneLink(wagon, index);
    const chosen = selectedZones(context.selection.peek(), wagon);
    if (!toggle) context.selection.value = [link];
    else if (chosen.includes(index)) context.selection.value = context.selection.peek().filter((l) => !(l.kind === 'zone' && l.type === wagon && l.index === index));
    else context.selection.value = [...context.selection.peek(), link];
  };

  const dispatch = (command: Command): boolean => command.ops.length === 0 || context.dispatch(command);

  const tool: FloorTool = {
    subject: context.subject,
    selection: context.selection,
    picture,
    doorState,
    snapping,
    pickingHeight,
    selected,
    select,
    show(links) {
      if (links.length > 0) context.selection.value = [...links];
    },
    dispatch,
    add() {
      const now = subject();
      const zones = zonesOf(now.typeJson);
      const base = zones[selected() ?? 0] ?? zones.find((zone) => zone !== null) ?? null;
      const x = base === null ? 0 : (base.minX + base.maxX) / 2;
      const z = base === null ? 0 : (base.minZ + base.maxZ) / 2;
      const y = base?.minY ?? heightFor(now, x, z);
      const index = zones.length;
      if (dispatch(addZone(now.typeFile, now.typeJson, zoneOver({ minX: x - 0.5, minZ: z - 0.5, maxX: x + 0.5, maxZ: z + 0.5 }, y)))) select(index);
    },
    remove(index) {
      const now = subject();
      if (!dispatch(removeZone(now.typeFile, now.typeJson, index))) return;
      const left = zonesOf(subject().typeJson).length;
      select(left === 0 ? null : Math.min(index, left - 1));
    },
    reorder(index, to) {
      const now = subject();
      if (dispatch(moveZoneTo(now.typeFile, now.typeJson, index, to))) select(to);
    },
    setNumber(index, corner, axis, value) {
      const now = subject();
      dispatch(setZoneNumber(now.typeFile, now.typeJson, index, corner, axis, value));
    },
    setHeight(index, y) {
      const now = subject();
      dispatch(setZoneHeight(now.typeFile, now.typeJson, index, y));
    },
  };

  // the layers: drawn again after each edit, at once while that is quick
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cost = 0;
  const draw = (): void => {
    timer = undefined;
    const now = context.subject.peek();
    if (now === null) return;
    const began = performance.now();
    const next = floorPicture(now.wagon, now.typeJson, now.type, doorState.peek(), context.previewDoors.peek());
    batch(() => {
      for (const layer of FLOOR_LAYERS) context.view.overlay(layer, next.layers[layer]);
      picture.value = next;
    });
    cost = performance.now() - began;
  };
  const stopDrawing = effect(() => {
    void context.subject.value;
    void doorState.value;
    void context.previewDoors.value;
    clearTimeout(timer);
    if (cost < slow || picture.peek() === null) draw();
    else timer = setTimeout(draw, settle);
  });

  // a zone's height from a click on the model
  const stopPicking = context.view.onPick((hit: PickHit) => {
    const index = pickingHeight.peek();
    if (index === null || hit.object === undefined || hit.point === undefined) return;
    const model = subject().model;
    const y = model === null ? null : vertexYNear(model, hit.object, hit.point);
    pickingHeight.value = null;
    if (y !== null) tool.setHeight(index, y);
    select(index);
  });

  const dragger = new FloorDragger({
    subject,
    selected,
    select,
    dispatch,
    snapping: () => snapping.peek(),
    heightFor: (x, z) => heightFor(subject(), x, z),
    picking: () => pickingHeight.peek() !== null,
  });
  context.view.setDragger(dragger);
  context.view.setCamera('top');

  return {
    tool,
    dispose() {
      stopDrawing();
      stopPicking();
      clearTimeout(timer);
      dragger.dispose();
      context.view.setDragger(null);
      for (const layer of FLOOR_LAYERS) context.view.overlay(layer, []);
    },
  };
}
