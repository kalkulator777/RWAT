/**
 * What an edit in a form does to a file, as journal ops (docs/proposals/editor.md §3.4–3.5):
 * a value typed into a field becomes a `set` (with the objects above it created when the
 * file lacks them), a field cleared becomes a `remove` — an absent key takes the engine's
 * value, which is not the same as an explicit 0 (`WagonTypeParser`: "an omitted field is
 * the default, an explicit 0 stays zero"). Pure: no DOM, no signals.
 */

import type { JsonPointer, Op } from '../core/contracts';
import { formatPointer, getAt, isJsonObject, parsePointer } from '../core/json';

/** The ops that put `value` at `at` in a file whose value is `root`, creating the missing objects on the way. */
export function setOps(file: string, root: unknown, at: JsonPointer, value: unknown): Op[] {
  const segments = parsePointer(at);
  if (segments.length === 0) return [{ op: 'set', file, at, value }];
  let depth = 0;
  let node = root;
  // The deepest place that exists: the set goes one below it, carrying what is missing as nested objects.
  while (depth < segments.length - 1) {
    const segment = segments[depth] as string;
    const next = getAt(node, [segment]);
    if (next === undefined) break;
    node = next;
    depth++;
  }
  // A member goes into an object; only the last step may name an element of a list.
  const fits = depth === segments.length - 1 ? isJsonObject(node) || Array.isArray(node) : isJsonObject(node);
  if (!fits) return [];
  let carried = value;
  for (let i = segments.length - 1; i > depth; i--) carried = { [segments[i] as string]: carried };
  return [{ op: 'set', file, at: formatPointer(segments.slice(0, depth + 1)), value: carried }];
}

/** The op that clears the field at `at` (removes the key or the list element); none when there is nothing there. */
export function removeOps(file: string, root: unknown, at: JsonPointer): Op[] {
  return getAt(root, at) === undefined ? [] : [{ op: 'remove', file, at }];
}

/** The ops that rename an object member, keeping its value (the new key goes last); none when the new key is taken. */
export function renameKeyOps(file: string, root: unknown, object: JsonPointer, from: string, to: string): Op[] {
  const parent = getAt(root, object);
  if (!isJsonObject(parent) || !Object.hasOwn(parent, from) || from === to || Object.hasOwn(parent, to)) return [];
  const base = parsePointer(object);
  return [
    { op: 'remove', file, at: formatPointer([...base, from]) },
    { op: 'set', file, at: formatPointer([...base, to]), value: parent[from] },
  ];
}

/** A number as JSON writes it (`-1.5e3`, no `+`, no leading zeros), the way a pack's author writes it. */
const JSON_NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;

export type ParsedNumber = { value: number } | { error: 'not-a-number' | 'not-an-integer' };

/** A number typed into a field: JSON's notation (a '.' before the fraction, as in Blender), finite; an integer field takes whole numbers only. */
export function parseNumber(text: string, integer = false): ParsedNumber {
  const trimmed = text.trim();
  if (!JSON_NUMBER.test(trimmed)) return { error: 'not-a-number' };
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { error: 'not-a-number' };
  if (integer && !Number.isInteger(value)) return { error: 'not-an-integer' };
  return { value: Object.is(value, -0) ? 0 : value };
}

/** A number as a field shows it: exactly, so that reading it back gives the same number. */
export function numberText(value: number): string {
  return String(value);
}

/** An empty value of a JSON type, for a new dictionary entry or list element. */
export function blankOf(types: readonly string[]): unknown {
  const type = types[0];
  if (type === 'number' || type === 'integer') return 0;
  if (type === 'boolean') return false;
  if (type === 'object') return {};
  if (type === 'array') return [];
  return '';
}

/**
 * A free JSON value typed into a field of no fixed type (`pack.description`, which is a
 * string or a text component): JSON when the text is JSON, else the text as a string.
 */
export function parseLoose(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** How a field of no fixed type shows a value: a string that would not read back as itself is shown bare, anything else as JSON. */
export function looseText(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string' && parseLoose(value) === value) return value;
  return JSON.stringify(value);
}
