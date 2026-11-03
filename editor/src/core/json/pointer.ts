/**
 * JSON Pointers (RFC 6901): how an {@link Op} names the place in a file's JSON it
 * changes, and how a problem or a selection names a field.
 *
 * `''` is the whole value; otherwise every segment follows a `/`, with `~1` for a `/`
 * and `~0` for a `~` inside it (`/sounds/doors/door~1left`). An array index is `0` or
 * a number without leading zeros; `-` is the place past the last element, which only
 * an insert may name (RFC 6902).
 */

import type { JsonPointer } from '../contracts';

/** A pointer that is not one: no leading `/`, a `~` not followed by `0` or `1`. */
export class PointerError extends Error {
  constructor(readonly pointer: string, reason: string) {
    super(`bad JSON pointer ${JSON.stringify(pointer)}: ${reason}`);
    this.name = 'PointerError';
  }
}

/** The pointer's segments, unescaped: `'/doors/0/min'` → `['doors', '0', 'min']`, `''` → `[]`. */
export function parsePointer(pointer: JsonPointer): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) throw new PointerError(pointer, "it must be empty or start with '/'");
  return pointer
    .slice(1)
    .split('/')
    .map((segment) => {
      if (/~(?![01])/.test(segment)) throw new PointerError(pointer, "'~' must be followed by 0 or 1");
      return segment.replace(/~1/g, '/').replace(/~0/g, '~');
    });
}

/** One segment escaped for a pointer: `~` → `~0`, `/` → `~1`. */
export function escapeSegment(segment: string | number): string {
  return String(segment).replace(/~/g, '~0').replace(/\//g, '~1');
}

/** The pointer of these segments: `['doors', 0, 'min']` → `'/doors/0/min'`. */
export function formatPointer(segments: readonly (string | number)[]): JsonPointer {
  return segments.map((segment) => `/${escapeSegment(segment)}`).join('');
}

/** The pointer one level down: `child('/doors', 0)` → `'/doors/0'`. */
export function childPointer(pointer: JsonPointer, segment: string | number): JsonPointer {
  return `${pointer}/${escapeSegment(segment)}`;
}

/**
 * The array index a segment names in an array of `length` elements, or null when it
 * names none: not a canonical number (`01`, `+1`, `1.0`), or past the end. `-` and
 * `length` itself name the place past the last element only when `end` allows it.
 */
export function arrayIndex(segment: string, length: number, end = false): number | null {
  if (segment === '-') return end ? length : null;
  if (!/^(?:0|[1-9][0-9]*)$/.test(segment)) return null;
  const index = Number(segment);
  return index < length || (end && index === length) ? index : null;
}

/** True when `prefix` is `pointer` itself or one of its ancestors (by whole segments). */
export function isPrefixPointer(prefix: JsonPointer, pointer: JsonPointer): boolean {
  return pointer === prefix || pointer.startsWith(`${prefix}/`);
}

/**
 * The value at the pointer, or undefined when there is none (a missing member, an
 * index past the end, a step into a scalar). Only own members count: `/toString` of an
 * object is undefined.
 */
export function getAt(value: unknown, pointer: JsonPointer | readonly string[]): unknown {
  const segments = typeof pointer === 'string' ? parsePointer(pointer) : pointer;
  let node: unknown = value;
  for (const segment of segments) {
    if (Array.isArray(node)) {
      const index = arrayIndex(segment, node.length);
      if (index === null) return undefined;
      node = node[index];
    } else if (node !== null && typeof node === 'object' && Object.hasOwn(node, segment)) {
      node = (node as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return node;
}
