/**
 * The doors tool while it is on (docs/proposals/editor.md §2.3, §3.9): the view goes to the
 * top, the tool takes its presses in the views from the top, the side and the front
 * (./gesture.ts), draws its layers (./analysis.ts) again after every edit and when the
 * model has been read, and makes a door of the objects selected (by the inspector's button,
 * or a double click on an object in the view). Its state — what edges snap to — lives
 * here, read by the inspector's section (./DoorsInspector.tsx).
 *
 * The layers are drawn at once after each edit: the doors' rules are a few boxes' worth,
 * and the floor region the bridges are measured on is one region a picture.
 */

import { batch, effect, signal, type ReadonlySignal, type Signal } from '@preact/signals';
import type { Command, Link, PickHit } from '../../core/contracts';
import { ALL_SNAPPING, type Snapping } from '../floor/snap';
import { zonesOf } from '../floor/zones';
import type { ToolContext, ToolSession, ToolSubject } from '../registry';
import { DOORS_LAYERS, doorsPicture, type DoorsPicture } from './analysis';
import {
  addDoor,
  boxOfObjects,
  doorLink,
  doorsOf,
  freshDoorId,
  moveDoorTo,
  removeDoor,
  selectedDoors,
  selectedObjects,
  setDoorFlag,
  setDoorGroup,
  setDoorId,
  setDoorNumber,
  type DoorBox,
  type DoorFlag,
} from './doors';
import { DoorsDragger } from './gesture';

/** What the doors tool holds while it is on; its section of the inspector reads and drives it. */
export interface DoorsTool {
  readonly subject: ReadonlySignal<ToolSubject | null>;
  /** The editor's selection (the selected doors and objects are links in it). */
  readonly selection: ReadonlySignal<readonly Link[]>;
  /** The picture drawn now. */
  readonly picture: ReadonlySignal<DoorsPicture | null>;
  readonly snapping: Signal<Snapping>;
  /** The selected door (the last of the selection's), or null. */
  selected(): number | null;
  select(index: number | null, toggle?: boolean): void;
  /** The objects of the open model in the selection: what «Дверь по выделенному» takes. */
  objects(): string[];
  dispatch(command: Command): boolean;
  /** Makes a door of the box around the selected objects (none selected: nothing); the new door is selected. */
  fromSelection(): boolean;
  /** Makes a door of the box around `objects`; the new door is selected. */
  fromObjects(objects: readonly string[]): boolean;
  /** Adds a door (from the keyboard): a block's door in the left side wall at the middle of the floor's first zone, else of the car. */
  add(): void;
  remove(index: number): void;
  /** Moves door `index` to place `to` in the list. */
  reorder(index: number, to: number): void;
  setNumber(index: number, corner: 'min' | 'max', axis: 0 | 1 | 2, value: number): void;
  /** Sets door `index`'s id; false for an empty one, which is refused. */
  setId(index: number, id: string): boolean;
  setFlag(index: number, flag: DoorFlag, on: boolean): void;
  setGroup(index: number, group: string): void;
}

/** The leaf a door added from the keyboard has: a block wide, two high, a sixteenth thick. */
const NEW_DOOR = { width: 1, height: 2, thickness: 0.0625 };

/** Turns the doors tool on: returns its state and what turns it off (the session's `dispose`). */
export function startDoors(context: ToolContext): Pick<ToolSession, 'dispose'> & { tool: DoorsTool } {
  const subject = (): ToolSubject => context.subject.peek() as ToolSubject;
  const snapping = signal<Snapping>(ALL_SNAPPING);
  const picture = signal<DoorsPicture | null>(null);

  const selected = (): number | null => {
    const now = context.subject.peek();
    if (now === null) return null;
    const last = selectedDoors(context.selection.peek(), now.wagon).at(-1);
    return last === undefined || last >= doorsOf(now.typeJson).length ? null : last;
  };

  const select = (index: number | null, toggle = false): void => {
    const wagon = subject().wagon;
    const mine = (link: Link): boolean => link.kind === 'door' && link.type === wagon;
    if (index === null) {
      if (!toggle) context.selection.value = context.selection.peek().filter((link) => !mine(link));
      return;
    }
    const link = doorLink(wagon, index);
    if (!toggle) context.selection.value = [link];
    else if (selectedDoors(context.selection.peek(), wagon).includes(index)) context.selection.value = context.selection.peek().filter((l) => !(mine(l) && l.kind === 'door' && l.index === index));
    else context.selection.value = [...context.selection.peek(), link];
  };

  const dispatch = (command: Command): boolean => command.ops.length === 0 || context.dispatch(command);

  /** Adds a door with a fresh id and selects it. */
  const create = (box: DoorBox | null): boolean => {
    if (box === null) return false;
    const now = subject();
    const index = doorsOf(now.typeJson).length;
    if (!dispatch(addDoor(now.typeFile, now.typeJson, freshDoorId(now.typeJson), box))) return false;
    select(index);
    return true;
  };

  const objects = (): string[] => {
    const model = subject().model;
    return model === null ? [] : selectedObjects(context.selection.peek(), model.id);
  };

  const tool: DoorsTool = {
    subject: context.subject,
    selection: context.selection,
    picture,
    snapping,
    selected,
    select,
    objects,
    dispatch,
    fromSelection() {
      return tool.fromObjects(objects());
    },
    fromObjects(names) {
      const model = subject().model;
      return model !== null && names.length > 0 && create(boxOfObjects(model, names));
    },
    add() {
      const now = subject();
      const zone = zonesOf(now.typeJson).find((z) => z !== null) ?? null;
      const x = zone === null ? 0 : (zone.minX + zone.maxX) / 2;
      const y = zone?.minY ?? 0;
      const z = zone?.maxZ ?? 1.4;
      create({ minX: x - NEW_DOOR.width / 2, minY: y, minZ: z, maxX: x + NEW_DOOR.width / 2, maxY: y + NEW_DOOR.height, maxZ: z + NEW_DOOR.thickness });
    },
    remove(index) {
      const now = subject();
      if (!dispatch(removeDoor(now.typeFile, now.typeJson, index))) return;
      const left = doorsOf(subject().typeJson).length;
      select(left === 0 ? null : Math.min(index, left - 1));
    },
    reorder(index, to) {
      const now = subject();
      if (dispatch(moveDoorTo(now.typeFile, now.typeJson, index, to))) select(to);
    },
    setNumber(index, corner, axis, value) {
      const now = subject();
      dispatch(setDoorNumber(now.typeFile, now.typeJson, index, corner, axis, value));
    },
    setId(index, id) {
      if (id === '') return false;
      const now = subject();
      return dispatch(setDoorId(now.typeFile, now.typeJson, index, id));
    },
    setFlag(index, flag, on) {
      const now = subject();
      dispatch(setDoorFlag(now.typeFile, now.typeJson, index, flag, on));
    },
    setGroup(index, group) {
      const now = subject();
      dispatch(setDoorGroup(now.typeFile, now.typeJson, index, group));
    },
  };

  // the layers: drawn again after each edit and once the model is read
  const stopDrawing = effect(() => {
    const now = context.subject.value;
    if (now === null) return;
    const next = doorsPicture(now.wagon, now.typeJson, now.type, now.model);
    batch(() => {
      for (const layer of DOORS_LAYERS) context.view.overlay(layer, next.layers[layer]);
      picture.value = next;
    });
  });

  // a double click on an object of the model: its door if it moves with one, else a door made of it
  const stopPicking = context.view.onPick((hit: PickHit) => {
    if (!hit.double || hit.object === undefined) return;
    const model = subject().model;
    if (model === null || !selectedObjects(context.selection.peek(), model.id).includes(hit.object)) return;
    const mover = picture.peek()?.movers.find((m) => m.door >= 0 && m.objects.includes(hit.object as string));
    if (mover !== undefined) select(mover.door);
    else tool.fromObjects([hit.object]);
  });

  const dragger = new DoorsDragger({ subject, selected, select, dispatch, snapping: () => snapping.peek() });
  context.view.setDragger(dragger);
  context.view.setCamera('top');

  return {
    tool,
    dispose() {
      stopDrawing();
      stopPicking();
      dragger.dispose();
      context.view.setDragger(null);
      for (const layer of DOORS_LAYERS) context.view.overlay(layer, []);
    },
  };
}
