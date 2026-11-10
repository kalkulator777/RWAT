/**
 * JSON as the pack's files are written: the port of tools/ir2rwat.py `dump` (golden
 * `json_dump`, its reference Python), which the converter and the example pack's
 * generator use too, so new files of the editor look like theirs:
 *
 * - two spaces a level; every object member and every element of an array that holds
 *   an object or an array on a line of its own; an array of scalars (`[x, y, z]`,
 *   `[front, rear]`) on one line, for hand editing;
 * - strings with only what JSON must escape (`ensure_ascii=False`): Cyrillic as it is;
 * - numbers as Python writes them (./numbers.ts);
 * - a line end after the last line.
 *
 * Keys in their order. A JavaScript object puts numeric-looking keys (`"1"`) first
 * whatever their order was; a `Map` (as ./parse.ts `parseLossless` gives) keeps them.
 *
 * Minimal edits (./edit.ts) write the values they put into a file with the same
 * {@link encodeValue}, in the file's own indent and line end.
 */

import { formatLexeme, formatNumber } from './numbers';
import { JsonNumber } from './parse';

/** How a file indents and ends its lines. */
export interface TextStyle {
  /** One level of indent: two spaces in dump, whatever the file uses in an edited one. */
  unit: string;
  eol: '\n' | '\r\n';
}

/** The style of {@link dump}. */
export const DUMP_STYLE: TextStyle = { unit: '  ', eol: '\n' };

/** The members of an object value (a plain object or a Map), or null when the value is no object. */
export function entriesOf(value: unknown): [string, unknown][] | null {
  if (value instanceof Map) return [...(value as Map<unknown, unknown>)].map(([key, item]) => [String(key), item]);
  if (value === null || typeof value !== 'object' || Array.isArray(value) || value instanceof JsonNumber) return null;
  return Object.entries(value);
}

/** True for an object or an array: what dump never puts on the line of an array of scalars. */
function isContainer(value: unknown): boolean {
  return Array.isArray(value) || entriesOf(value) !== null;
}

/** A scalar as JSON text; throws TypeError on what JSON has no form for (undefined, functions, symbols). */
export function encodeScalar(value: unknown): string {
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'number':
      return formatNumber(value);
    case 'bigint':
      return value.toString();
    case 'boolean':
      return value ? 'true' : 'false';
    default:
      if (value === null) return 'null';
      if (value instanceof JsonNumber) return formatLexeme(value.lexeme);
      throw new TypeError(`${typeof value} has no JSON form`);
  }
}

/**
 * The value as text placed on a line that starts with `indent`: nested lines get
 * `indent` plus one `style.unit` a level, the closing bracket `indent` again
 * (ir2rwat `encode`).
 */
export function encodeValue(value: unknown, indent: string, style: TextStyle): string {
  const inner = indent + style.unit;
  const entries = entriesOf(value);
  if (entries !== null) {
    if (entries.length === 0) return '{}';
    const lines = entries.map(([key, item]) => `${inner}${JSON.stringify(key)}: ${encodeValue(item, inner, style)}`);
    return `{${style.eol}${lines.join(`,${style.eol}`)}${style.eol}${indent}}`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (!value.some(isContainer)) return `[${value.map(encodeScalar).join(', ')}]`;
    const lines = value.map((item) => inner + encodeValue(item, inner, style));
    return `[${style.eol}${lines.join(`,${style.eol}`)}${style.eol}${indent}]`;
  }
  return encodeScalar(value);
}

/** The value on one line, as Python's `json.dumps` writes it by default: `{"a": [1, 2], "b": true}`. */
export function encodeInline(value: unknown): string {
  const entries = entriesOf(value);
  if (entries !== null) return `{${entries.map(([key, item]) => `${JSON.stringify(key)}: ${encodeInline(item)}`).join(', ')}}`;
  if (Array.isArray(value)) return `[${value.map(encodeInline).join(', ')}]`;
  return encodeScalar(value);
}

/** The text of a new pack file holding the value (ir2rwat `dump`, decoded). */
export function dump(value: unknown): string {
  return `${encodeValue(value, '', DUMP_STYLE)}\n`;
}

const utf8 = new TextEncoder();

/** {@link dump} as the bytes of the file (UTF-8, no BOM), as ir2rwat `dump` returns them. */
export function dumpBytes(value: unknown): Uint8Array {
  return utf8.encode(dump(value));
}
