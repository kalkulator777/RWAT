/**
 * The layers of a converted stock type (editor.md §1.3, §2.6): what tools/ir2rwat.py
 * derives from the IR pack → the recipe's override of the type → what the pack gets.
 * A port of the converter's merge (golden: fixtures/golden/recipe_merge/, its reference
 * Python — `deep_merge`, `layer`, `without_comments`, `edit_doors`, `Converter.prepare`,
 * `door_plan`, `convert_stock`, `add_names`).
 *
 * The derived layer is the converter's alone: the bridge (ir/bridge.ts) asks Python for
 * it ({@link Derived}), this module puts the override on top, so a form shows the result
 * of an edit without a round trip through Pyodide. Only the floor generator has to run
 * again when the override's `floor` changes: its zones come in as {@link MergeInput.floor}.
 *
 * What the converter does, step by step:
 *
 * - comments: every key starting with `_` is dropped at any depth of the recipe and the
 *   per-type file as they are read ({@link withoutComments});
 * - the recipe's inline `overrides.<id>` under the per-type file: objects merge, anything
 *   else of the file wins, a null too ({@link layer});
 * - `type` deep-merged over the derived type: an object merges, anything else replaces,
 *   null removes the key ({@link deepMerge}); `"type": null` is as if not given;
 * - doors: `type.doors` a list replaces the model's doors; an object edits them by id
 *   ({@link editDoors}); null (or nothing) keeps the model's doors;
 * - floor: `floor: false` turns the generator off; it runs for a passenger car, and for any
 *   type whose override has a `floor` object; its zones (or, without them, IR's passenger
 *   area) become `type.interior` unless the override has its own — a hand-made floor wins;
 *   `type.interior: null` is as if not given, it does not remove the floor;
 * - doors go into the type only when it has an interior;
 * - model: the door animations and door sounds of the doors the type ends up with, then
 *   `sway` (a number 0…3, else a warning), then `model` deep-merged;
 * - names: `en_us` gets the IR name, then the override's `name` and `lights` by language.
 *
 * Objects keep their keys in order, as Python's dicts do: a merged key stays where it
 * was, a new one goes at the end. A key that looks like an array index (`"1"`) would
 * jump to the front of a JavaScript object; ids of doors, light groups and languages
 * are not such keys in practice (fixtures/golden/README.md, "model_check").
 */

/** A JSON object. */
export type JsonObject = Record<string, unknown>;

/** What the converter derives for a stock type, without any override (the bridge's `plan` without overrides). */
export interface Derived {
  /** The IR category (the folder under rolling_stock/): `passenger` runs the floor generator. */
  category: string;
  /** The IR name: the `en_us` name of the type. */
  name: string;
  /** The type declaration from IR's definition (derive_type): physics, couplers, `cab` of a locomotive. */
  type: JsonObject;
  /** The doors the model carries (model_doors), OBJ frame. */
  doors: JsonObject[];
  /** IR's passenger area as one zone (derive_interior), or null. */
  interior: unknown;
  /**
   * The model declaration with every door animation and door sound the IR pack has
   * (`obj`, `animations`, `liveries`, `handbrake`, `sounds`): only those of the doors the
   * type ends up with are written.
   */
  model: JsonObject;
  /** The model's light groups, as the converter lists them (sorted). */
  lights: string[];
}

/** What {@link mergeOverride} puts together. */
export interface MergeInput {
  derived: Derived;
  /**
   * The zones the floor generator gives for the override's `floor` options (the bridge
   * runs it), or null when it gives none (options it refuses, a model it can't read).
   * Read only when the generator runs ({@link floorRuns}).
   */
  floor: unknown;
  /** The recipe's own `overrides.<id>`, if any. */
  inline?: unknown;
  /** The per-type file `<overrides_dir>/<id>.json`, if any; `_` keys are comments. */
  override?: unknown;
  /** The pack's namespace and the type's id: the lang keys. */
  namespace: string;
  id: string;
}

/** What the pack gets for the type. */
export interface MergeResult {
  /** `data/<ns>/wagon_types/<id>.json`. */
  type: JsonObject;
  /** `assets/<ns>/wagon_models/<id>.json`. */
  model: JsonObject;
  /** The type's lang entries, by language (`en_us` first): `wagon.<ns>.<id>`, `light.<ns>.<id>.<group>`. */
  lang: Record<string, Record<string, string>>;
  /** The converter's warnings about the override, as it words them (`<id>: …`). */
  warnings: string[];
}

/** An override the converter refuses for the type (it skips the type with an error). */
export class MergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MergeError';
  }
}

export function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Python's `x or {}` for a value that should be an object: anything else is no object. */
function objectOr(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}

/** A copy of the object with `key` set: at its place when present, at the end when not (Python's dict). */
function put(target: JsonObject, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

/** `without_comments`: the value with every key starting with `_` dropped, at any depth (arrays too). */
export function withoutComments(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutComments);
  if (!isObject(value)) return value;
  const out: JsonObject = {};
  for (const [key, item] of Object.entries(value)) if (!key.startsWith('_')) put(out, key, withoutComments(item));
  return out;
}

/**
 * `deep_merge`: the override onto the base; a null removes the key, an object merges into
 * an object, anything else replaces. An object the base lacks is taken as it is, nulls
 * and all (a `doors` object keeps its `{"<id>": null}` for {@link editDoors}).
 */
export function deepMerge(base: JsonObject, override: JsonObject): JsonObject {
  const merged: JsonObject = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === null) delete merged[key];
    else if (isObject(value) && isObject(merged[key])) put(merged, key, deepMerge(merged[key], value));
    else put(merged, key, value);
  }
  return merged;
}

/** `layer`: one override over another (the per-type file over the recipe's inline one): objects merge, anything else of `top` wins, a null too. */
export function layer(base: JsonObject, top: JsonObject): JsonObject {
  const merged: JsonObject = { ...base };
  for (const [key, value] of Object.entries(top)) {
    if (isObject(value) && isObject(merged[key])) put(merged, key, layer(merged[key], value));
    else put(merged, key, value);
  }
  return merged;
}

/** The override the converter reads for a type: the inline one under the file, comments dropped. */
export function effectiveOverride(inline: unknown, override: unknown): JsonObject {
  const below = isObject(inline) ? (withoutComments(inline) as JsonObject) : {};
  return isObject(override) ? layer(below, withoutComments(override) as JsonObject) : below;
}

function lower(id: unknown): string {
  return typeof id === 'string' ? id.toLowerCase() : String(id).toLowerCase();
}

/**
 * `edit_doors`: a `doors` object over the derived doors — each key a door id (any case):
 * an object edits that door (deep-merged, so `"inner": null` drops a flag) or adds it at
 * the end, null removes it (a warning when there is no such door). The others stay as
 * derived, in their order. Throws {@link MergeError} for an edit that is neither.
 */
export function editDoors(doors: readonly JsonObject[], edits: JsonObject, warn: (message: string) => void): JsonObject[] {
  const out = doors.map((door) => ({ ...door }));
  for (const [doorId, edit] of Object.entries(edits)) {
    if (edit !== null && !isObject(edit)) throw new MergeError(`"doors".${doorId} must be an object or null, not ${JSON.stringify(edit)}`);
    const at = out.findIndex((door) => lower(door.id) === doorId.toLowerCase());
    if (edit === null) {
      if (at < 0) warn(`"doors" removes ${doorId}, which isn't a derived door`);
      else out.splice(at, 1);
    } else if (at < 0) {
      out.push(deepMerge({ id: doorId }, edit));
    } else {
      out[at] = deepMerge(out[at] as JsonObject, edit);
    }
  }
  return out;
}

/** True when the converter runs the floor generator for the type: not `floor: false`, and a passenger car or a `floor` given. */
export function floorRuns(category: string, override: JsonObject): boolean {
  const floor = override.floor;
  if (floor === false) return false;
  return (floor !== undefined && floor !== null) || category === 'passenger';
}

/** True for a sway the converter writes: a number (not a boolean) from 0 to 3. */
export function validSway(sway: unknown): boolean {
  return typeof sway === 'number' && sway >= 0 && sway <= 3;
}

const MODEL_ORDER = ['obj', 'animations', 'liveries', 'handbrake', 'sounds'] as const;
const SOUND_ORDER = ['idle', 'horn', 'bell', 'wheels', 'clack', 'doors', 'controls'] as const;

/** Only the entries of a map whose key is a door of the type. */
function ofDoors(map: unknown, doorIds: ReadonlySet<string>): JsonObject {
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(objectOr(map))) if (doorIds.has(key.toLowerCase())) put(out, key, value);
  return out;
}

function nonEmpty(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (isObject(value)) return Object.keys(value).length > 0;
  return value !== undefined && value !== null && value !== '' && value !== false && value !== 0;
}

/** The model declaration before the override's `sway` and `model`: the derived one with the door animations and sounds of the type's doors. */
function modelOf(derived: JsonObject, doorIds: ReadonlySet<string>): JsonObject {
  const model: JsonObject = {};
  for (const key of MODEL_ORDER) {
    let value = derived[key];
    if (key === 'animations') value = ofDoors(value, doorIds);
    if (key === 'sounds' && isObject(value)) {
      const sounds: JsonObject = {};
      for (const name of SOUND_ORDER) {
        const sound = name === 'doors' ? ofDoors(value.doors, doorIds) : value[name];
        if (nonEmpty(sound)) put(sounds, name, sound);
      }
      value = sounds;
    }
    if (key === 'obj' ? value !== undefined : nonEmpty(value)) put(model, key, value);
  }
  return model;
}

/**
 * What the pack gets for a stock type: the derived layer with the override on top, as
 * tools/ir2rwat.py writes it (see the module's comment). Throws {@link MergeError} where
 * the converter skips the type.
 */
export function mergeOverride(input: MergeInput): MergeResult {
  const { derived, namespace, id } = input;
  const warnings: string[] = [];
  const warn = (message: string): void => {
    warnings.push(`${id}: ${message}`);
  };
  const override = effectiveOverride(input.inline, input.override);

  // prepare: the type, its doors and its floor
  const type = deepMerge(derived.type, objectOr(override.type));
  let doors: unknown;
  if (Array.isArray(type.doors)) {
    doors = type.doors;
  } else {
    const edits = isObject(type.doors) ? type.doors : {};
    if (isObject(type.doors)) delete type.doors;
    doors = editDoors(derived.doors, edits, warn);
  }
  const floor = floorRuns(derived.category, override) && input.floor !== null && input.floor !== undefined ? input.floor : derived.interior;
  if (!Object.hasOwn(type, 'interior') && floor !== null && floor !== undefined) put(type, 'interior', floor);
  if (!Object.hasOwn(type, 'doors') && Object.hasOwn(type, 'interior') && Array.isArray(doors) && doors.length > 0) put(type, 'doors', doors);

  // convert_stock: the model
  const doorIds = new Set<string>();
  if (Array.isArray(type.doors)) for (const door of type.doors) if (isObject(door)) doorIds.add(lower(door.id));
  let model = modelOf(derived.model, doorIds);
  const sway = override.sway;
  if (sway !== undefined && sway !== null) {
    if (validSway(sway)) put(model, 'sway', sway);
    else warn('"sway" must be a number from 0 to 3, left out');
  }
  model = deepMerge(model, objectOr(override.model));

  // the names
  const key = `wagon.${namespace}.${id}`;
  const lang: Record<string, Record<string, string>> = { en_us: { [key]: typeof derived.name === 'string' ? derived.name : id } };
  const entry = (language: string): Record<string, string> => {
    if (!Object.hasOwn(lang, language)) put(lang, language, {});
    return lang[language] as Record<string, string>;
  };
  for (const [language, text] of Object.entries(objectOr(override.name))) put(entry(language), key, text);
  for (const [group, names] of Object.entries(objectOr(override.lights))) {
    if (!derived.lights.includes(group)) {
      warn(`"lights" names ${group}, which isn't a light group of the model (${derived.lights.join(', ') || 'it has none'})`);
    }
    for (const [language, text] of Object.entries(objectOr(names))) put(entry(language), `light.${namespace}.${id}.${group}`, text);
  }
  return { type, model, lang, warnings };
}
