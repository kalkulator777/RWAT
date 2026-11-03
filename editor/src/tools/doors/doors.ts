/**
 * The doors of a wagon type as its file writes them (`doors`, schema
 * `wagon_type.schema.json#/$defs/door`), and the commands that edit them. Everything is in
 * the OBJ frame, as the file has it (`x-frame: obj`): a door is its leaf's box, `min` and
 * `max` corners as a floor zone's (./../floor/zones.ts reads both), with an `id`, the
 * flags `connecting`, `inner` and `fixed` and a `group`.
 *
 * The order of the list is the door's index: the engine's open-door bits are keyed by it,
 * and the links of the checks and the selection name a door by it. Moving a door in the
 * list is safe: the engine keeps which doors stand open by their ids (since batch A), and the
 * model's `animations` and `sounds.doors` name doors by id too.
 *
 * A flag is written only while it is on (`"inner": true`), a group only while it has a
 * name: turned off or emptied, the key goes, as the example pack writes its doors.
 * Removing the last door removes `doors`. Pure: no DOM, no signals.
 */

import type { Command, JsonPointer, Link, LoadedModel, Op } from '../../core/contracts';
import { isJsonObject } from '../../core/json';
import { equalsIgnoreCase } from '../../ports/wagonType';
import { floatDecimal } from '../common/snap';
import { zoneJson, zoneOf, type ZoneBox } from '../floor/zones';

/** A door's box in the OBJ frame: its least and greatest corners (the shape a floor zone has). */
export type DoorBox = ZoneBox;

/** The flags of a door, in the order the inspector shows them. */
export const DOOR_FLAGS = ['connecting', 'inner', 'fixed'] as const;

export type DoorFlag = (typeof DOOR_FLAGS)[number];

/** One door of the file as the tool reads it; what cannot be read is null, so the indices stay the file's. */
export interface DoorEntry {
  /** The id; null when the file has none that is a string. */
  readonly id: string | null;
  /** The box; null when its corners are not three numbers each. */
  readonly box: DoorBox | null;
  readonly connecting: boolean;
  readonly inner: boolean;
  readonly fixed: boolean;
  /** The group's name as written; null when there is none (absent, `null` or not a string). */
  readonly group: string | null;
}

const DOORS: JsonPointer = '/doors';

/** The `doors` of a type's JSON as a list: the list, nothing when absent or not a list. */
function doorList(typeJson: unknown): unknown[] {
  if (!isJsonObject(typeJson)) return [];
  return Array.isArray(typeJson.doors) ? typeJson.doors : [];
}

/** One door of the file. */
export function doorOf(value: unknown): DoorEntry {
  const door = isJsonObject(value) ? value : {};
  return {
    id: typeof door.id === 'string' ? door.id : null,
    box: zoneOf(door),
    connecting: door.connecting === true,
    inner: door.inner === true,
    fixed: door.fixed === true,
    group: typeof door.group === 'string' ? door.group : null,
  };
}

/** The doors of a type's JSON in the file's order. */
export function doorsOf(typeJson: unknown): DoorEntry[] {
  return doorList(typeJson).map(doorOf);
}

/** A door's box as the file writes it. */
export function boxJson(box: DoorBox): { min: number[]; max: number[] } {
  return zoneJson(box);
}

/** The link of door `index` of wagon `wagon` (core/contracts `Link`). */
export function doorLink(wagon: string, index: number): Link {
  return { kind: 'door', type: wagon, index };
}

/** The indices of the wagon's doors in the selection, in its order. */
export function selectedDoors(selection: readonly Link[], wagon: string): number[] {
  return selection.flatMap((link) => (link.kind === 'door' && link.type === wagon ? [link.index] : []));
}

/** The objects of model `model` in the selection, in its order. */
export function selectedObjects(selection: readonly Link[], model: string): string[] {
  return selection.flatMap((link) => (link.kind === 'object' && link.model === model ? [link.name] : []));
}

/** True if a door of the type already has the id, case aside (the engine matches door ids so: animations, sounds, switches). */
export function idTaken(typeJson: unknown, id: string, except: number | null = null): boolean {
  return doorsOf(typeJson).some((door, i) => i !== except && door.id !== null && equalsIgnoreCase(door.id, id));
}

/** An id no door of the type has: `door_<n>`, n from the count of doors up. */
export function freshDoorId(typeJson: unknown): string {
  for (let n = doorList(typeJson).length; ; n++) {
    const id = `door_${n}`;
    if (!idTaken(typeJson, id)) return id;
  }
}

/**
 * The box around objects of the model, as the OBJ writes their coordinates (`1.45`, not
 * `1.4500000476837158`); null when none of them is in the model or has faces.
 */
export function boxOfObjects(model: LoadedModel, names: readonly string[]): DoorBox | null {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const name of names) {
    const object = model.objects.find((o) => o.name === name);
    if (object === undefined) continue;
    const [lo, hi] = object.bbox;
    if (![...lo, ...hi].every(Number.isFinite)) continue;
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a] as number, lo[a] as number);
      max[a] = Math.max(max[a] as number, hi[a] as number);
    }
  }
  if (!min.every(Number.isFinite)) return null;
  const [minX, minY, minZ] = min.map(floatDecimal) as [number, number, number];
  const [maxX, maxY, maxZ] = max.map(floatDecimal) as [number, number, number];
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

/** Adds a door with id `id` and box `box` at the end of the list (door `count`), the list made when the type has none. */
export function addDoor(file: string, typeJson: unknown, id: string, box: DoorBox, coalesceKey?: string): Command {
  const count = doorList(typeJson).length;
  const value = { id, ...boxJson(box) };
  const has = isJsonObject(typeJson) && Array.isArray(typeJson.doors);
  const ops: Op[] = has ? [{ op: 'insert', file, at: `${DOORS}/-`, value }] : [{ op: 'set', file, at: DOORS, value: [value] }];
  const command: Command = { label: 'tools.doors.cmd.add', labelParams: { index: count, id }, ops };
  if (coalesceKey !== undefined) command.coalesceKey = coalesceKey;
  return command;
}

function nothing(label: string, index: number): Command {
  return { label, labelParams: { index }, ops: [] };
}

/**
 * Puts door `index`'s box where `box` says, its corners written whole where they changed;
 * no op for a corner already so. `label` names the gesture in the journal.
 */
export function setDoorBox(file: string, typeJson: unknown, index: number, box: DoorBox, options: { label?: string; coalesceKey?: string } = {}): Command {
  const command = nothing(options.label ?? 'tools.doors.cmd.set', index);
  if (options.coalesceKey !== undefined) command.coalesceKey = options.coalesceKey;
  const before = doorList(typeJson)[index];
  if (!isJsonObject(before)) return command;
  const now = boxJson(box);
  for (const key of ['min', 'max'] as const) {
    if (JSON.stringify(before[key]) !== JSON.stringify(now[key])) command.ops.push({ op: 'set', file, at: `${DOORS}/${index}/${key}`, value: now[key] });
  }
  return command;
}

/** One number of door `index`'s box: `corner` min or max, `axis` 0 x, 1 y, 2 z. */
export function setDoorNumber(file: string, typeJson: unknown, index: number, corner: 'min' | 'max', axis: 0 | 1 | 2, value: number): Command {
  const box = doorsOf(typeJson)[index]?.box;
  if (box === undefined || box === null) return nothing('tools.doors.cmd.set', index);
  const key = (['X', 'Y', 'Z'] as const)[axis];
  return setDoorBox(file, typeJson, index, { ...box, [`${corner}${key}`]: value });
}

/** Door `index`'s id; an empty one is refused (no op): the schema asks for one, and the engine's `required` too. */
export function setDoorId(file: string, typeJson: unknown, index: number, id: string): Command {
  const command = nothing('tools.doors.cmd.id', index);
  const before = doorList(typeJson)[index];
  if (!isJsonObject(before) || id === '' || before.id === id) return command;
  command.labelParams = { index, id };
  command.ops.push({ op: 'set', file, at: `${DOORS}/${index}/id`, value: id });
  return command;
}

/** Turns a flag of door `index` on (`true` written) or off (the key removed). */
export function setDoorFlag(file: string, typeJson: unknown, index: number, flag: DoorFlag, on: boolean): Command {
  const command: Command = { label: on ? 'tools.doors.cmd.flagOn' : 'tools.doors.cmd.flagOff', labelParams: { index, flag }, ops: [] };
  const before = doorList(typeJson)[index];
  if (!isJsonObject(before)) return command;
  const at = `${DOORS}/${index}/${flag}`;
  if (on && before[flag] !== true) command.ops.push({ op: 'set', file, at, value: true });
  else if (!on && Object.hasOwn(before, flag)) command.ops.push({ op: 'remove', file, at });
  return command;
}

/** Door `index`'s group: a name, or none (`''`: the key removed, a `null` of old files with it). */
export function setDoorGroup(file: string, typeJson: unknown, index: number, group: string): Command {
  const command: Command = { label: 'tools.doors.cmd.group', labelParams: { index, group }, ops: [] };
  const before = doorList(typeJson)[index];
  if (!isJsonObject(before)) return command;
  const at = `${DOORS}/${index}/group`;
  if (group === '') {
    if (Object.hasOwn(before, 'group')) command.ops.push({ op: 'remove', file, at });
  } else if (before.group !== group) {
    command.ops.push({ op: 'set', file, at, value: group });
  }
  return command;
}

/** Removes door `index`; the last one takes `doors` with it. */
export function removeDoor(file: string, typeJson: unknown, index: number): Command {
  const doors = doorList(typeJson);
  const command = nothing('tools.doors.cmd.remove', index);
  if (index < 0 || index >= doors.length) return command;
  command.ops = doors.length === 1 ? [{ op: 'remove', file, at: DOORS }] : [{ op: 'remove', file, at: `${DOORS}/${index}` }];
  return command;
}

/** Moves door `from` to place `to` in the list: its index, and so its bit among the open doors, changes. */
export function moveDoorTo(file: string, typeJson: unknown, from: number, to: number): Command {
  const doors = doorList(typeJson);
  const command: Command = { label: 'tools.doors.cmd.order', labelParams: { from, to }, ops: [] };
  if (from === to || from < 0 || to < 0 || from >= doors.length || to >= doors.length) return command;
  command.ops = [
    { op: 'remove', file, at: `${DOORS}/${from}` },
    { op: 'insert', file, at: `${DOORS}/${to}`, value: doors[from] },
  ];
  return command;
}
