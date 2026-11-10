/**
 * A type's doors in its override (editor.md §2.6, step 4; tools/ir2rwat.py `door_plan`,
 * `edit_doors`): `type.doors` as an object edits the doors the model carries by id —
 * `{"<id>": {...}}` changes or adds one door, `{"<id>": null}` removes a derived one — and
 * as a list replaces them all.
 *
 * - An edit of one door writes the object form, by id, only the fields that differ from
 *   the derived door; a field set back to the derived value leaves the file, and so does
 *   an edit (and the object) left empty. A file that has the list form keeps it: the door
 *   is edited in its list.
 * - Ids are matched in any case, as the converter matches them; a key already in the file
 *   is kept as written. An id starting with `_` would be a comment: refused.
 * - A door the model hasn't: added under its id (object form) or at the end of the list.
 * - Removing a derived door writes its null; removing an added door takes its key out.
 * - The two forms convert into each other without changing the doors the type gets
 *   ({@link doorsAsList}, {@link doorsAsObject}); comments go along: those of a door with
 *   the door, those of the doors object to `type` next to it. A list whose order the
 *   object form can't give (derived doors out of their order, a new door before a
 *   derived one) is refused rather than changed.
 */

import type { Command, Op } from '../../core/contracts';
import { deepEqual, formatPointer, isJsonObject } from '../../core/json';
import { overrideRemoveOps, overrideSetOps } from './fields';
import { editDoors, isObject, type JsonObject, MergeError, withoutComments } from './merge';
import { RecipeError, type RecipeWorkspace } from './workspace';

/** How the per-type file gives the doors. */
export type DoorForm = 'none' | 'object' | 'list';

/** One door as the doors list of a form shows it. */
export interface DoorRow {
  id: string;
  /** The door the type gets; null for a derived door the override removes. */
  door: JsonObject | null;
  /** `derived` as the model has it, `edited` by the override, `added` by it, `removed` by it, `listed` in the override's list. */
  origin: 'derived' | 'edited' | 'added' | 'removed' | 'listed';
}

function doorsValue(file: JsonObject | undefined): unknown {
  const type = file?.type;
  return isJsonObject(type) ? type.doors : undefined;
}

/** The form of the doors in a per-type file (a null is as none: the converter keeps the derived doors). */
export function doorForm(file: JsonObject | undefined): DoorForm {
  const doors = doorsValue(file);
  return Array.isArray(doors) ? 'list' : isJsonObject(doors) ? 'object' : 'none';
}

const lower = (id: unknown): string => String(id).toLowerCase();

function checkId(id: string): void {
  if (id === '' || id.startsWith('_')) throw new RecipeError('bad-door', `${JSON.stringify(id)} can't be a door's id here: a key starting with _ is a comment`);
}

/** The key of the object form naming the door (any case), as written; undefined when none does. */
function keyOf(edits: JsonObject, id: string): string | undefined {
  return Object.keys(edits).find((key) => !key.startsWith('_') && lower(key) === lower(id));
}

/** The comment keys of an object. */
function comments(value: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key.startsWith('_')));
}

/** The doors of the override as rows: the derived ones edited or removed and the added ones (object form), or the list's. */
export function doorRows(derived: readonly JsonObject[], file: JsonObject | undefined): DoorRow[] {
  const doors = withoutComments(doorsValue(file));
  if (Array.isArray(doors)) {
    const rows: DoorRow[] = doors.filter(isObject).map((door) => ({ id: String(door.id), door, origin: 'listed' }));
    for (const door of derived) if (!rows.some((row) => lower(row.id) === lower(door.id))) rows.push({ id: String(door.id), door: null, origin: 'removed' });
    return rows;
  }
  const edits = isObject(doors) ? doors : {};
  const final = editDoors(derived, edits, () => undefined);
  const rows: DoorRow[] = [];
  for (const door of derived) {
    const key = keyOf(edits, String(door.id));
    if (key !== undefined && edits[key] === null) rows.push({ id: String(door.id), door: null, origin: 'removed' });
    else rows.push({ id: String(door.id), door: null, origin: key === undefined ? 'derived' : 'edited' });
  }
  let next = 0;
  for (const row of rows) if (row.door === null && row.origin !== 'removed') row.door = final[next++] ?? null;
  for (const door of final.slice(next)) rows.push({ id: String(door.id), door, origin: 'added' });
  return rows;
}

/** The edit that makes a door of what the model has: the fields that differ, null for those it drops (`id` only when it differs). */
function editFor(derived: JsonObject | undefined, door: JsonObject): JsonObject {
  const edit: JsonObject = {};
  for (const [key, value] of Object.entries(door)) {
    if (key.startsWith('_')) edit[key] = value;
    else if (key === 'id') {
      if (derived === undefined || value !== derived.id) edit.id = value;
    } else if (derived === undefined || !deepEqual(value, derived[key])) edit[key] = value;
  }
  if (derived !== undefined) for (const key of Object.keys(derived)) if (key !== 'id' && !Object.hasOwn(door, key)) edit[key] = null;
  if (derived === undefined) delete edit.id;
  return edit;
}

function command(label: string, typeId: string, door: string, ops: Op[]): Command {
  return { label, labelParams: { type: typeId, door }, ops };
}

/**
 * Sets one field of a door (`inner`, `min`, `connecting`…; null drops it). The derived doors
 * are what the model carries (Derived.doors).
 */
export function setDoorField(workspace: RecipeWorkspace, typeId: string, doorId: string, field: string, value: unknown, derived: readonly JsonObject[]): Command {
  checkId(doorId);
  if (field.startsWith('_')) throw new RecipeError('bad-door', `${field} is a comment, not a field of a door`);
  const file = workspace.override(typeId);
  const doors = doorsValue(file);
  const label = 'recipe.cmd.door';
  if (Array.isArray(doors)) {
    const index = doors.findIndex((door) => isJsonObject(door) && lower(door.id) === lower(doorId));
    if (index < 0) throw new RecipeError('bad-door', `no door ${doorId} in the list of ${typeId}`);
    const segments = ['type', 'doors', String(index), field];
    if (value === null) return command(label, typeId, doorId, overrideRemoveOps(workspace, typeId, segments, [formatPointer(segments.slice(0, 3))]));
    return command(label, typeId, doorId, deepEqual((doors[index] as JsonObject)[field], value) ? [] : overrideSetOps(workspace, typeId, segments, value));
  }
  const edits = isJsonObject(doors) ? doors : {};
  const base = derived.find((door) => lower(door.id) === lower(doorId));
  const key = keyOf(edits, doorId) ?? (base === undefined ? doorId : String(base.id));
  const edit = edits[key];
  const same = base !== undefined && (value === null ? !Object.hasOwn(base, field) : deepEqual(base[field], value));
  if (base === undefined && edit === undefined) throw new RecipeError('bad-door', `no door ${doorId} of ${typeId}: add it first`);
  if (edit === null) {
    // a removed door comes back with the change (or as derived, when the change is none)
    const ops = same ? overrideRemoveOps(workspace, typeId, ['type', 'doors', key]) : overrideSetOps(workspace, typeId, ['type', 'doors', key], { [field]: value });
    return command(label, typeId, doorId, ops);
  }
  const segments = ['type', 'doors', key, field];
  if (same || (value === null && base === undefined)) return command(label, typeId, doorId, overrideRemoveOps(workspace, typeId, segments));
  if (isJsonObject(edit) && Object.hasOwn(edit, field) && deepEqual(edit[field], value)) return command(label, typeId, doorId, []);
  return command(label, typeId, doorId, overrideSetOps(workspace, typeId, segments, value));
}

/** Adds a door the model hasn't (`id`, `min`, `max`, flags), after the others. */
export function addDoor(workspace: RecipeWorkspace, typeId: string, door: JsonObject, derived: readonly JsonObject[]): Command {
  const id = door.id;
  if (typeof id !== 'string') throw new RecipeError('bad-door', 'a door needs its id');
  checkId(id);
  const file = workspace.override(typeId);
  const doors = doorsValue(file);
  const label = 'recipe.cmd.addDoor';
  if (Array.isArray(doors)) {
    if (doors.some((other) => isJsonObject(other) && lower(other.id) === lower(id))) throw new RecipeError('bad-door', `${typeId} has a door ${id} already`);
    return command(label, typeId, id, [{ op: 'insert', file: workspace.overridePath(typeId), at: '/type/doors/-', value: door }]);
  }
  const edits = isJsonObject(doors) ? doors : {};
  const base = derived.find((other) => lower(other.id) === lower(id));
  const key = keyOf(edits, id);
  if (key !== undefined ? edits[key] !== null : base !== undefined) throw new RecipeError('bad-door', `${typeId} has a door ${id} already`);
  return command(label, typeId, id, overrideSetOps(workspace, typeId, ['type', 'doors', key ?? id], editFor(base, door)));
}

/** Removes a door: a derived one by its null, an added one by taking its key (or element) out. */
export function removeDoor(workspace: RecipeWorkspace, typeId: string, doorId: string, derived: readonly JsonObject[]): Command {
  checkId(doorId);
  const file = workspace.override(typeId);
  const doors = doorsValue(file);
  const label = 'recipe.cmd.removeDoor';
  if (Array.isArray(doors)) {
    const index = doors.findIndex((door) => isJsonObject(door) && lower(door.id) === lower(doorId));
    if (index < 0) return command(label, typeId, doorId, []);
    return command(label, typeId, doorId, overrideRemoveOps(workspace, typeId, ['type', 'doors', String(index)], ['/type/doors']));
  }
  const edits = isJsonObject(doors) ? doors : {};
  const key = keyOf(edits, doorId);
  const base = derived.find((door) => lower(door.id) === lower(doorId));
  if (base === undefined) return command(label, typeId, doorId, key === undefined ? [] : overrideRemoveOps(workspace, typeId, ['type', 'doors', key]));
  if (key !== undefined && edits[key] === null) return command(label, typeId, doorId, []);
  return command(label, typeId, doorId, overrideSetOps(workspace, typeId, ['type', 'doors', key ?? String(base.id)], null));
}

/** Gives a door back as the model has it (object form): its key out of the file. */
export function resetDoor(workspace: RecipeWorkspace, typeId: string, doorId: string): Command {
  const doors = doorsValue(workspace.override(typeId));
  const key = isJsonObject(doors) ? keyOf(doors, doorId) : undefined;
  return command('recipe.cmd.resetDoor', typeId, doorId, key === undefined ? [] : overrideRemoveOps(workspace, typeId, ['type', 'doors', key]));
}

/** The doors of the object form written as a list: the doors the type gets, a door's comments with it, the object's own comments to `type`. */
export function doorsAsList(workspace: RecipeWorkspace, typeId: string, derived: readonly JsonObject[]): Command {
  const file = workspace.override(typeId);
  const doors = doorsValue(file);
  const label = 'recipe.cmd.doorsAsList';
  if (Array.isArray(doors)) return command(label, typeId, '', []);
  const edits = isJsonObject(doors) ? doors : {};
  let final: JsonObject[];
  try {
    final = editDoors(derived, withoutComments(edits) as JsonObject, () => undefined);
  } catch (error) {
    if (error instanceof MergeError) throw new RecipeError('bad-door', error.message);
    throw error;
  }
  const list = final.map((door) => {
    const key = keyOf(edits, String(door.id)) ?? Object.keys(edits).find((k) => isJsonObject(edits[k]) && (edits[k] as JsonObject).id === door.id);
    const edit = key === undefined ? undefined : edits[key];
    return isJsonObject(edit) ? { ...door, ...comments(edit) } : door;
  });
  const type = file?.type;
  const notes = comments(edits);
  const taken = Object.keys(notes).filter((key) => isJsonObject(type) && Object.hasOwn(type, key));
  if (taken.length > 0) throw new RecipeError('not-lossless', `the doors' comments ${taken.join(', ')} have no place next to them in type`);
  const ops = overrideSetOps(workspace, typeId, ['type', 'doors'], list);
  for (const [key, value] of Object.entries(notes)) ops.push(...overrideSetOps(workspace, typeId, ['type', key], value).filter((op) => op.op === 'set'));
  return command(label, typeId, '', ops);
}

/** The doors of the list form written as edits by id; refused when the object form can't give the same doors in the same order. */
export function doorsAsObject(workspace: RecipeWorkspace, typeId: string, derived: readonly JsonObject[]): Command {
  const file = workspace.override(typeId);
  const doors = doorsValue(file);
  const label = 'recipe.cmd.doorsAsObject';
  if (!Array.isArray(doors)) return command(label, typeId, '', []);
  const list = doors.filter(isJsonObject);
  if (list.length !== doors.length) throw new RecipeError('not-lossless', 'the list has an entry that is no door');
  const edits: JsonObject = {};
  const seen = new Set<string>();
  for (const door of list) {
    if (typeof door.id !== 'string') throw new RecipeError('not-lossless', 'a door of the list has no id');
    checkId(door.id);
    if (seen.has(lower(door.id))) throw new RecipeError('not-lossless', `the list has the door ${door.id} twice`);
    seen.add(lower(door.id));
  }
  for (const base of derived) {
    const door = list.find((other) => lower(other.id) === lower(base.id));
    if (door === undefined) edits[String(base.id)] = null;
    else {
      const edit = editFor(base, door);
      if (Object.keys(edit).length > 0) edits[String(base.id)] = edit;
    }
  }
  for (const door of list) if (!derived.some((base) => lower(base.id) === lower(door.id))) edits[door.id as string] = editFor(undefined, door);
  const back = editDoors(derived, withoutComments(edits) as JsonObject, () => undefined);
  if (!deepEqual(back, withoutComments(list))) throw new RecipeError('not-lossless', `the list's order of the doors of ${typeId} can't be given by edits by id`);
  const ops = Object.keys(edits).length === 0 ? overrideRemoveOps(workspace, typeId, ['type', 'doors']) : overrideSetOps(workspace, typeId, ['type', 'doors'], edits);
  return command(label, typeId, '', ops);
}
