/**
 * A type's `floor` in its override (editor.md §2.6, step 4; tools/ir2rwat.py `prepare`,
 * tools/floorgen.py `FloorConfig`): the options of the floor generator, or `false` — the
 * generator off. What the converter does with it:
 *
 * - `floor: false` — no generator: the floor is IR's passenger area (a passenger car), or
 *   none;
 * - a passenger car without `floor` (or with null) — the generator runs with its defaults;
 * - any type with a `floor` object, `{}` too — the generator runs with those options (so
 *   `"floor": {}` turns it on for a locomotive or a freight car, and is no "nothing" there);
 * - the zones it gives become `type.interior` — unless the override has its own
 *   `type.interior`: a floor drawn by hand wins over the generated one (the generator still
 *   runs: its doors are the type's doors).
 *
 * The options themselves are checked by the schema (recipe_override `#/$defs/floor`) and,
 * for good, by `FloorConfig` when the bridge runs the generator.
 */

import type { Command } from '../../core/contracts';
import { overrideRemoveOps, overrideSetOps, setField, type SetOptions } from './fields';
import { floorRuns, isObject, type JsonObject, withoutComments } from './merge';
import { RecipeError, type RecipeWorkspace } from './workspace';

/** The generator's options (tools/floorgen.py `OPTIONS`). */
export const FLOOR_OPTIONS = ['level', 'add', 'remove', 'ignore', 'clearance', 'slab', 'cell', 'step_down'] as const;
export type FloorOption = (typeof FLOOR_OPTIONS)[number];

/** What the converter does about a type's floor. */
export interface FloorStatus {
  /** `default`: no `floor` (or null); `off`: `floor: false`; `options`: a `floor` object. */
  mode: 'default' | 'off' | 'options';
  /** True when the generator runs. */
  runs: boolean;
  /** The options the generator gets, comments dropped; null when it doesn't run. */
  options: JsonObject | null;
  /** True when the override has its own `type.interior`: the generated zones are not used. */
  handInterior: boolean;
}

/** The floor of a type: `override` is what the converter reads (merge.ts `effectiveOverride`: the inline override under the file). */
export function floorStatus(category: string, override: JsonObject): FloorStatus {
  const floor = override.floor;
  const mode = floor === false ? 'off' : floor === undefined || floor === null ? 'default' : 'options';
  const runs = floorRuns(category, override);
  const type = override.type;
  const handInterior = isObject(type) && type.interior !== undefined && type.interior !== null;
  return { mode, runs, options: runs ? (isObject(floor) ? (withoutComments(floor) as JsonObject) : {}) : null, handInterior };
}

function checkOption(option: string): asserts option is FloorOption {
  if (!(FLOOR_OPTIONS as readonly string[]).includes(option)) {
    throw new RecipeError('bad-path', `"floor".${option} is no option of the floor generator (${FLOOR_OPTIONS.join(', ')})`);
  }
}

/** Sets an option of the generator; a `floor: false` gives way to the options (the generator on). */
export function setFloorOption(workspace: RecipeWorkspace, id: string, option: string, value: unknown, options: SetOptions = {}): Command {
  checkOption(option);
  return setField(workspace, id, `/floor/${option}`, value, { label: 'recipe.cmd.floorOption', ...options });
}

/**
 * Takes an option out (the generator's default counts). The `floor` object left empty goes
 * too only for a passenger car — elsewhere `{}` is what keeps the generator on.
 */
export function resetFloorOption(workspace: RecipeWorkspace, id: string, option: string, category: string): Command {
  checkOption(option);
  const keep = category === 'passenger' ? [] : ['/floor'];
  return { label: 'recipe.cmd.floorReset', labelParams: { type: id, field: `/floor/${option}` }, ops: overrideRemoveOps(workspace, id, ['floor', option], keep) };
}

/** `floor: false`: the generator off (the options, if any, are gone). */
export function turnFloorOff(workspace: RecipeWorkspace, id: string): Command {
  const ops = workspace.override(id)?.floor === false ? [] : overrideSetOps(workspace, id, ['floor'], false);
  return { label: 'recipe.cmd.floorOff', labelParams: { type: id }, ops };
}

/**
 * The generator on: options it has stay; else `floor: {}` — or, for a passenger car, whose
 * generator runs without the key, the key taken out.
 */
export function turnFloorOn(workspace: RecipeWorkspace, id: string, category: string): Command {
  const floor = workspace.override(id)?.floor;
  if (isObject(floor)) return { label: 'recipe.cmd.floorOn', labelParams: { type: id }, ops: [] };
  if (category === 'passenger') return floorAsDerived(workspace, id, 'recipe.cmd.floorOn');
  return { label: 'recipe.cmd.floorOn', labelParams: { type: id }, ops: overrideSetOps(workspace, id, ['floor'], {}) };
}

/** No `floor` key: what the converter does by the type's category. */
export function floorAsDerived(workspace: RecipeWorkspace, id: string, label = 'recipe.cmd.floorDefault'): Command {
  return { label, labelParams: { type: id }, ops: overrideRemoveOps(workspace, id, ['floor'], []) };
}
