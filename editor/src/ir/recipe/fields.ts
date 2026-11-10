/**
 * The fields of a type's override (editor.md §1.3, §2.6): each place under `type`, `model`,
 * `name`, `lights`, `floor` or `sway` of `<overrides_dir>/<id>.json` is in one of three
 * states — not set (the derived value counts), set to a value, or removed (`null`) — and
 * the commands that move it between them. The commands only edit the per-type file; the
 * recipe gets `overrides_dir` when it has none (with the first per-type file).
 *
 * - **Set** writes the value at its place. A place inside an object the file lacks gets
 *   the objects on the way; inside an array (`/type/bogies/1`, `/type/interior/0/min`) the
 *   whole array is written — the file's own, or else the derived one — since an override
 *   replaces an array whole. A place under something the file sets to a scalar or null
 *   replaces that with the objects on the way.
 * - **Equal to the derived value** (*decision of the agent*): a set to what the derived
 *   layer has there is a reset — the key leaves the file, so the file holds only the
 *   corrections and follows the converter if IR changes. `pin` writes it anyway.
 * - **Remove** writes `null`. Where the converter takes null as "not given" (the sections
 *   themselves, `type.doors`, `type.interior`) or can't take it at all (a name, a light's
 *   text) it would change nothing or break the type, so it is refused ({@link canRemove}).
 * - **Reset to derived** takes the key out of the file, and every object that is left
 *   empty by it; the file itself goes when nothing is left. An object holding only `_`
 *   comments is not empty: its comments stay (*decision of the agent*). `floor` is never
 *   removed by a reset of one of its options: `"floor": {}` turns the generator on for a
 *   car that is not a passenger car (./floor.ts decides).
 *
 * Comment keys (`_…`) are never a field: the pointers here name none, and an edit leaves
 * every comment where it is (the minimal edits of core/json/edit.ts).
 *
 * `type.doors` as an object is edited door by door in ./doors.ts.
 */

import type { Command, Op } from '../../core/contracts';
import { deepEqual, dumpBytes, formatPointer, isJsonObject, parsePointer, setIn } from '../../core/json';
import { isObject, type JsonObject } from './merge';
import { RecipeError, type RecipeWorkspace } from './workspace';

/** The top-level keys of a per-type file (tools/ir2rwat.py `OVERRIDE_KEYS`). */
export const OVERRIDE_SECTIONS = ['floor', 'lights', 'model', 'name', 'sway', 'type'] as const;

/** Where a field of the override stands. */
export type FieldState =
  /** The file does not decide it: the derived value counts. */
  | { state: 'derived' }
  /** The file sets it: at `at` itself, or an ancestor at `at` that replaces the whole (an array, a scalar). */
  | { state: 'set'; at: string; value: unknown }
  /** The file removes it: a null at `at`, the field's own place or an ancestor's. */
  | { state: 'removed'; at: string };

/** The segments of a field's pointer, checked: no comment keys, under one of the sections. */
function segmentsOf(pointer: string): string[] {
  const segments = parsePointer(pointer);
  const section = segments[0];
  if (section === undefined || !(OVERRIDE_SECTIONS as readonly string[]).includes(section)) {
    throw new RecipeError('bad-path', `${pointer} is no field of an override (${OVERRIDE_SECTIONS.join(', ')})`);
  }
  if (segments.some((segment) => segment.startsWith('_'))) throw new RecipeError('bad-path', `${pointer}: a key starting with _ is a comment, not a field`);
  return segments;
}

/** The value at the segments, or undefined where there is none (an array index too). */
function valueAt(value: unknown, segments: readonly string[]): unknown {
  let node = value;
  for (const segment of segments) {
    if (Array.isArray(node) && /^(?:0|[1-9][0-9]*)$/.test(segment)) node = node[Number(segment)];
    else if (isJsonObject(node) && Object.hasOwn(node, segment)) node = node[segment];
    else return undefined;
  }
  return node;
}

/**
 * The state of a field of the override (`/type/brakes/parking_kn`, `/floor/level`,
 * `/name/ru_ru`): what the per-type file (as it stands, comments and all) says of it.
 */
export function fieldState(override: unknown, pointer: string): FieldState {
  const segments = segmentsOf(pointer);
  let node = override;
  for (let i = 0; i < segments.length; i++) {
    if (!isJsonObject(node)) return { state: 'derived' };
    const segment = segments[i] as string;
    if (!Object.hasOwn(node, segment)) return { state: 'derived' };
    node = node[segment];
    const at = formatPointer(segments.slice(0, i + 1));
    if (node === null) return { state: 'removed', at };
    if (i < segments.length - 1 && !isJsonObject(node)) return { state: 'set', at, value: node };
  }
  return { state: 'set', at: pointer, value: node };
}

/**
 * True when the converter takes a null at the place as removing what the derived layer has
 * there: under `type` or `model`, below the section itself, and not `type.doors` or
 * `type.interior` (a null there is "not given", the derived doors and floor stay). A
 * name or a light's text can't be null: the converter would write null into a lang file.
 */
export function canRemove(pointer: string): boolean {
  const segments = segmentsOf(pointer);
  if (segments.length < 2 || (segments[0] !== 'type' && segments[0] !== 'model')) return false;
  return !(segments[0] === 'type' && segments.length === 2 && (segments[1] === 'doors' || segments[1] === 'interior'));
}

/** The objects on the way to a value: `["a", "b"]`, 1 → `{"b": 1}` under `a`. */
function nest(segments: readonly string[], value: unknown): unknown {
  let out = value;
  for (let i = segments.length - 1; i >= 0; i--) out = { [segments[i] as string]: out };
  return out;
}

/** The ops that set a place of a JSON file (the file's value `file`, undefined: no file): through the objects (and array elements) there are, creating the rest. */
function setOps(path: string, file: unknown, segments: readonly string[], value: unknown): Op[] {
  if (file === undefined) return [{ op: 'putFile', file: path, bytes: dumpBytes(nest(segments, value)) }];
  for (let i = 0; i < segments.length - 1; i++) {
    const child = valueAt(file, segments.slice(0, i + 1));
    const next = segments[i + 1] as string;
    const into = isJsonObject(child) || (Array.isArray(child) && /^(?:0|[1-9][0-9]*)$/.test(next) && Number(next) < child.length);
    if (!into) {
      return [{ op: 'set', file: path, at: formatPointer(segments.slice(0, i + 1)), value: nest(segments.slice(i + 1), value) }];
    }
  }
  return [{ op: 'set', file: path, at: formatPointer(segments), value }];
}

/**
 * The ops that take a place out of a file, with every object that it leaves empty (an
 * object with only comments is not empty), and the file when nothing is left. `keep`:
 * places never removed for being empty.
 */
function removeOps(path: string, file: JsonObject, segments: readonly string[], keep: readonly string[]): Op[] {
  let target = segments.length;
  while (target > 1) {
    const parent = valueAt(file, segments.slice(0, target - 1));
    const parentPointer = formatPointer(segments.slice(0, target - 1));
    if (!isJsonObject(parent) || Object.keys(parent).length !== 1 || keep.includes(parentPointer)) break;
    target--;
  }
  if (target === 1 && Object.keys(file).length === 1) return [{ op: 'deleteFile', file: path }];
  return [{ op: 'remove', file: path, at: formatPointer(segments.slice(0, target)) }];
}

/** The ops that give a recipe without `overrides_dir` one, for its first per-type file; refuses a folder outside the one opened. */
function folderOps(workspace: RecipeWorkspace): Op[] {
  if (workspace.overridesDir !== null) return [];
  const dir = workspace.recipe().overrides_dir;
  if (dir !== undefined) {
    throw new RecipeError('bad-path', `"overrides_dir" ${JSON.stringify(dir)} of ${workspace.recipePath} is no folder inside the one opened: its per-type files can't be written`);
  }
  return [{ op: 'set', file: workspace.recipePath, at: '/overrides_dir', value: workspace.defaultOverridesDir }];
}

/** The ops that put `value` at a place of a type's per-type file (the file and the recipe's `overrides_dir` created when missing). */
export function overrideSetOps(workspace: RecipeWorkspace, id: string, segments: readonly string[], value: unknown): Op[] {
  const file = workspace.override(id);
  const path = workspace.overridePath(id);
  if (file === undefined && workspace.has(path)) {
    throw new RecipeError('broken-file', `${path} is no JSON object: mend its text first, an edit would write over it`);
  }
  const prefix = file === undefined ? folderOps(workspace) : [];
  return [...prefix, ...setOps(path, file, segments, value)];
}

/** The ops that take a place out of a type's per-type file (and what it leaves empty); none when the file lacks it. */
export function overrideRemoveOps(workspace: RecipeWorkspace, id: string, segments: readonly string[], keep: readonly string[] = ['/floor']): Op[] {
  const file = workspace.override(id);
  if (file === undefined) return [];
  const parent = valueAt(file, segments.slice(0, -1));
  const last = segments[segments.length - 1] as string;
  const there = isJsonObject(parent) ? Object.hasOwn(parent, last) : Array.isArray(parent) && /^(?:0|[1-9][0-9]*)$/.test(last) && Number(last) < parent.length;
  if (!there) return [];
  return removeOps(workspace.overridePath(id), file, segments, keep);
}

/** Where an edit of the field lands: the field itself, or the array above it, written whole. */
function owner(override: unknown, base: unknown, segments: readonly string[]): number {
  for (let i = 1; i < segments.length; i++) {
    const prefix = segments.slice(0, i);
    const own = valueAt(override, prefix);
    const there = own === undefined ? valueAt(base, prefix) : own;
    if (Array.isArray(there)) return i;
    if (own !== undefined && !isObject(own)) return segments.length; // a scalar or null of the file: replaced by objects on the way
  }
  return segments.length;
}

export interface SetOptions {
  /**
   * The derived layer in the shape of an override (./layers.ts `TypeLayers.base`): what a
   * field is without the per-type file. Without it every set is written, and a place inside an
   * array the file lacks can't be set.
   */
  base?: unknown;
  /** Write the value even when it is what the derived layer has (no reset). */
  pin?: boolean;
  /** The command's label (i18n key) and its params; `recipe.cmd.set` by default. */
  label?: string;
  coalesceKey?: string;
}

/**
 * Sets a field of the type's override. An equal-to-derived value resets the field instead
 * (unless `pin`); a value the file already has there is an empty command.
 */
export function setField(workspace: RecipeWorkspace, id: string, pointer: string, value: unknown, options: SetOptions = {}): Command {
  const segments = segmentsOf(pointer);
  if (segments[0] === 'type' && segments[1] === 'doors' && segments.length > 2) {
    throw new RecipeError('bad-path', `${pointer}: a door is edited by its id (./doors.ts), not by its place`);
  }
  const command = (ops: Op[]): Command => ({
    label: options.label ?? 'recipe.cmd.set',
    labelParams: { type: id, field: pointer },
    ops,
    ...(options.coalesceKey === undefined ? {} : { coalesceKey: options.coalesceKey }),
  });
  const file = workspace.override(id);
  const at = owner(file, options.base, segments);
  let place = segments.slice(0, at);
  let next = value;
  if (at < segments.length) {
    const own = valueAt(file, place);
    const array = own === undefined ? valueAt(options.base, place) : own;
    try {
      next = setIn(array, segments.slice(at), value).root;
    } catch {
      throw new RecipeError('bad-path', `${pointer}: no such place in ${formatPointer(place)}`);
    }
  } else {
    place = segments;
  }
  const derived = valueAt(options.base, place);
  if (options.pin !== true && derived !== undefined && deepEqual(next, derived)) {
    return command(overrideRemoveOps(workspace, id, place));
  }
  if (file !== undefined && deepEqual(valueAt(file, place), next) && fieldState(file, formatPointer(place)).state === 'set') return command([]);
  return command(overrideSetOps(workspace, id, place, next));
}

/** Removes a field: `null` in the override, so the converter drops what it derived there. Refused where null means nothing or breaks the type ({@link canRemove}). */
export function removeField(workspace: RecipeWorkspace, id: string, pointer: string): Command {
  if (!canRemove(pointer)) throw new RecipeError('bad-path', `${pointer}: null there doesn't remove what the converter derives`);
  const segments = segmentsOf(pointer);
  // already removed, by its own null or an ancestor's: writing would bring the ancestor's other fields back
  const ops = fieldState(workspace.override(id), pointer).state === 'removed' ? [] : overrideSetOps(workspace, id, segments, null);
  return { label: 'recipe.cmd.remove', labelParams: { type: id, field: pointer }, ops };
}

/** Resets a field to the derived value: its key out of the per-type file, with what that leaves empty. A field the file doesn't name is an empty command. */
export function resetField(workspace: RecipeWorkspace, id: string, pointer: string): Command {
  const segments = segmentsOf(pointer);
  return { label: 'recipe.cmd.reset', labelParams: { type: id, field: pointer }, ops: overrideRemoveOps(workspace, id, segments) };
}
