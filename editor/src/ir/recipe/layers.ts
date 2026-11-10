/**
 * The three layers of a converted type side by side (editor.md §2.6, step 3): the derived
 * one (the converter's, with the recipe's inline override, which the per-type file sits
 * on), the per-type file, and the result. A form reads a field's state from the file
 * (./fields.ts), its grey "derived" value from {@link TypeLayers.base} and what the pack
 * gets from {@link TypeLayers.result}.
 */

import { parsePointer } from '../../core/json';
import { type Derived, effectiveOverride, isObject, type JsonObject, mergeOverride, type MergeResult } from './merge';
import { fieldState, type FieldState } from './fields';
import type { RecipeWorkspace } from './workspace';

export interface TypeLayers {
  /** The type's id and the recipe's namespace. */
  id: string;
  namespace: string;
  /** What the pack gets without the per-type file (the derived layer and the recipe's inline override). */
  derived: MergeResult;
  /**
   * The same in the shape of an override, for comparing a field with it: `type` and
   * `model` as written, `name` by language (`en_us` the IR name), and the inline
   * override's `lights`, `floor` and `sway`.
   */
  base: JsonObject;
  /** The per-type file as it stands (comments and all), or undefined. */
  override: JsonObject | undefined;
  /** The override the converter reads: the inline one under the file, comments dropped. */
  effective: JsonObject;
  /** What the pack gets. */
  result: MergeResult;
}

/**
 * The layers of a type of the recipe: `derived` is what the bridge says the converter
 * derives, `floor` the zones the floor generator gives for the type's current `floor`
 * options (the bridge's `plan` with the override; null: none).
 */
export function typeLayers(workspace: RecipeWorkspace, id: string, derived: Derived, floor: unknown): TypeLayers {
  const namespaceValue = workspace.recipe().namespace;
  const namespace = typeof namespaceValue === 'string' ? namespaceValue : '';
  const inline = workspace.inline(id);
  const override = workspace.override(id);
  const below = mergeOverride({ derived, floor, inline, namespace, id });
  const result = mergeOverride({ derived, floor, inline, override, namespace, id });
  const lower = effectiveOverride(inline, undefined);
  const base: JsonObject = { name: { en_us: derived.name, ...(isObject(lower.name) ? lower.name : {}) }, type: below.type, model: below.model };
  for (const key of ['lights', 'floor', 'sway'] as const) if (lower[key] !== undefined) base[key] = lower[key];
  return { id, namespace, derived: below, base, override, effective: effectiveOverride(inline, override), result };
}

/** A field as a form shows it: its state in the file, the derived value and the value the pack gets. */
export interface FieldView {
  state: FieldState;
  /** The value without the per-type file; undefined where there is none. */
  derived: unknown;
  /** The value the pack gets; undefined where it has none. */
  value: unknown;
}

function valueAt(value: unknown, segments: readonly string[]): unknown {
  let node = value;
  for (const segment of segments) {
    if (Array.isArray(node) && /^(?:0|[1-9][0-9]*)$/.test(segment)) node = node[Number(segment)];
    else if (isObject(node) && Object.hasOwn(node, segment)) node = node[segment];
    else return undefined;
  }
  return node;
}

/** What the result has at a field of the override: the declarations for `type` and `model`, the lang entries for `name` and `lights`, the file's own word for `floor` and `sway`. */
function resultAt(layers: TypeLayers, segments: readonly string[]): unknown {
  const [section, ...rest] = segments;
  const { result, namespace, id } = layers;
  switch (section) {
    case 'type':
      return valueAt(result.type, rest);
    case 'model':
      return valueAt(result.model, rest);
    case 'name': {
      const key = `wagon.${namespace}.${id}`;
      if (rest.length === 0) return Object.fromEntries(Object.entries(result.lang).flatMap(([lang, texts]) => (key in texts ? [[lang, texts[key]]] : [])));
      return rest.length === 1 ? result.lang[rest[0] as string]?.[key] : undefined;
    }
    case 'lights':
      if (rest.length === 2) return result.lang[rest[1] as string]?.[`light.${namespace}.${id}.${rest[0] as string}`];
      return valueAt(layers.effective.lights, rest);
    default:
      return valueAt(layers.effective[section as string], rest);
  }
}

/** The view of one field of the override (`/type/mass_t`, `/name/ru_ru`, `/floor/level`). */
export function fieldView(layers: TypeLayers, pointer: string): FieldView {
  const segments = parsePointer(pointer);
  return { state: fieldState(layers.override, pointer), derived: valueAt(layers.base, segments), value: resultAt(layers, segments) };
}
