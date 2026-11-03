/**
 * Strict reading of the pack format's JSON, as every declaration parser of the engine
 * reads it: port of `pack/PackJson.java` (golden: through `fixtures/golden/wagon_type/`,
 * whose messages are this module's word for word).
 *
 * - A key a section doesn't know is a warning, never an error, with the nearest known key
 *   as a hint ({@link checkKeys}): `unknown key 'max_speed' (ignored) — did you mean
 *   'max_speed_kmh'?`.
 * - A JSON `null` or a value of the wrong type is an error naming the field and the type
 *   expected (`'brakes.train_kn' must be a finite number, got null`), thrown as
 *   {@link PackJsonError} as the engine throws its `JsonSyntaxException`.
 * - Numbers must be finite.
 *
 * Fields are named by their dotted path in the file (`doors[2].min`); `where` is the path
 * of the object being read, empty at the top level. Input is the JSON value as
 * `JSON.parse` gives it. Pure: it runs in workers and in Node.
 */

/** A declaration the engine does not load: its `JsonSyntaxException`, the message as Java's. */
export class PackJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackJsonError';
  }
}

/** A JSON object as `JSON.parse` gives it. */
export type JsonObject = Record<string, unknown>;

/** True for a JSON object (`JsonElement.isJsonObject`): not null, not an array. */
export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True if the object has the member `key` (`JsonObject.has`), never a prototype's. */
export function has(object: JsonObject, key: string): boolean {
  return Object.hasOwn(object, key);
}

/** The member `key` of an object, undefined when absent (`JsonObject.get`), never a prototype's. */
export function get(object: JsonObject, key: string): unknown {
  return has(object, key) ? object[key] : undefined;
}

/** The path of `key` in the object at `where`, or of element `key` of the array at `where` (`PackJson.at`). */
export function at(where: string, key: string | number): string {
  if (typeof key === 'number') return `${where}[${key}]`;
  return where === '' ? key : `${where}.${key}`;
}

// ---------------------------------------------------------------- unknown keys

/** `toLowerCase(Locale.ROOT)`: JavaScript's lower case knows no locale. */
function lowerCase(text: string): string {
  return text.toLowerCase();
}

function bare(key: string): string {
  return key.replace(/[_\- ]/g, '');
}

/** Optimal string alignment distance: insertions, deletions, substitutions, neighbour swaps (`PackJson.distance`). */
function distance(a: string, b: string): number {
  const d: number[][] = [];
  for (let i = 0; i <= a.length; i++) d.push(new Array<number>(b.length + 1).fill(0));
  const row = (i: number): number[] => d[i] as number[];
  for (let i = 0; i <= a.length; i++) row(i)[0] = i;
  for (let j = 0; j <= b.length; j++) row(0)[j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      let best = Math.min(
        Math.min((row(i - 1)[j] as number) + 1, (row(i)[j - 1] as number) + 1),
        (row(i - 1)[j - 1] as number) + cost,
      );
      if (i > 1 && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) {
        best = Math.min(best, (row(i - 2)[j - 2] as number) + 1);
      }
      row(i)[j] = best;
    }
  }
  return row(a.length)[b.length] as number;
}

/**
 * The known key `key` most likely is a typo of, or null if none is close (`PackJson.nearest`):
 * the fewest edits (a swap of two neighbours counts as one), at most about a third of the
 * known key's length (a key of one or two letters only case aside); or one contains the
 * other, underscores aside. Ties go to the key listed first.
 */
export function nearestKey(key: string, known: Iterable<string>): string | null {
  const lower = lowerCase(key);
  const keyBare = bare(lower);
  let best: string | null = null;
  let bestDistance = Number.MAX_SAFE_INTEGER;
  for (const candidate of known) {
    const other = lowerCase(candidate);
    const otherBare = bare(other);
    const d = distance(lower, other);
    const allowed = other.length <= 2 ? 0 : Math.max(1, Math.trunc((other.length + 1) / 3));
    const close =
      d <= allowed || (keyBare.length >= 3 && otherBare.includes(keyBare)) || (otherBare.length >= 3 && keyBare.includes(otherBare));
    if (close && d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}

/** Warn about every key of `object` that `known` doesn't list, with the nearest known one as a hint (`PackJson.checkKeys`). */
export function checkKeys(object: JsonObject, known: readonly string[], where: string, warnings: (text: string) => void): void {
  for (const key of Object.keys(object)) {
    if (known.includes(key)) continue;
    const hint = nearestKey(key, known);
    warnings(`unknown key '${at(where, key)}' (ignored)${hint !== null ? ` — did you mean '${at(where, hint)}'?` : ''}`);
  }
}

// ---------------------------------------------------------------- values

/**
 * What a value is, for an error message: `nothing`, `null`, `the string "95"`, `an object`
 * (`PackJson.describe`). Java quotes a number as the file writes it (`the number 1.0`);
 * this port has only the value and writes it as JavaScript does (`the number 1`).
 */
export function describe(value: unknown): string {
  if (value === undefined) return 'nothing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return `the number ${Object.is(value, -0) ? '-0' : String(value)}`;
  if (typeof value === 'string') return `the string "${value.length > 40 ? `${value.substring(0, 40)}…` : value}"`;
  return 'an object';
}

/** `'path' must be <expected>, got <what is there>` (`PackJson.wrongType`). */
export function wrongType(path: string, expected: string, found: unknown): PackJsonError {
  return new PackJsonError(`'${path}' must be ${expected}, got ${describe(found)}`);
}

/** The object at `path`, or an error naming what is there instead (`PackJson.object`). */
export function asObject(value: unknown, path: string): JsonObject {
  if (!isObject(value)) throw wrongType(path, 'an object', value);
  return value;
}

/** The array at `path`, or an error naming what is there instead (`PackJson.array`). */
export function asArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw wrongType(path, 'an array', value);
  return value as unknown[];
}

/** The finite number at `path`, or an error naming what is there instead (`PackJson.number`). */
export function asNumber(value: unknown, path: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw wrongType(path, 'a finite number', value);
}

/** The string at `path`, or an error naming what is there instead (`PackJson.string`). */
export function asString(value: unknown, path: string): string {
  if (typeof value === 'string') return value;
  throw wrongType(path, 'a string', value);
}

/** The `true`/`false` at `path`, or an error naming what is there instead (`PackJson.bool`). */
export function asBool(value: unknown, path: string): boolean {
  if (typeof value === 'boolean') return value;
  throw wrongType(path, 'true or false', value);
}

// ---------------------------------------------------------------- fields

/** The value of a field that must be there; a `null` is there, and fails its type check (`PackJson.required`). */
export function required(object: JsonObject, key: string, where: string): unknown {
  if (!has(object, key)) throw new PackJsonError(`missing required field '${at(where, key)}'`);
  return object[key];
}

/** A number field, `fallback` when absent (`PackJson.optionalNumber`). */
export function optionalNumber(object: JsonObject, key: string, where: string, fallback: number): number {
  return has(object, key) ? asNumber(object[key], at(where, key)) : fallback;
}

/** A `true`/`false` field, `fallback` when absent (`PackJson.optionalBool`). */
export function optionalBool(object: JsonObject, key: string, where: string, fallback: boolean): boolean {
  return has(object, key) ? asBool(object[key], at(where, key)) : fallback;
}

/** An object field, null when absent (`PackJson.optionalObject`). */
export function optionalObject(object: JsonObject, key: string, where: string): JsonObject | null {
  return has(object, key) ? asObject(object[key], at(where, key)) : null;
}

/** An array field, null when absent (`PackJson.optionalArray`). */
export function optionalArray(object: JsonObject, key: string, where: string): unknown[] | null {
  return has(object, key) ? asArray(object[key], at(where, key)) : null;
}
