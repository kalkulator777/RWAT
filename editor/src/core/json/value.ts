/**
 * JSON values as the pack model holds them: plain objects, arrays and scalars, never
 * changed in place. An edit returns a new root that shares every untouched branch with
 * the old one, so whoever holds the old value (an undo entry, a computed signal) keeps
 * it as it was, and an unchanged branch is still `===` to itself.
 */

import { arrayIndex } from './pointer';
import { putMember } from './parse';

/** A plain JSON object (not an array, not null). */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Equal as JSON values: the same scalars (`20` and `20.0` are one number), arrays
 * element by element, objects member by member whatever their order.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isJsonObject(a) && isJsonObject(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]));
  }
  return false;
}

/** A place in a value that an edit cannot reach: no parent there, a scalar on the way, an index past the end. */
export class ValuePathError extends Error {
  constructor(readonly segments: readonly string[], reason: string) {
    super(`${reason} at /${segments.join('/')}`);
    this.name = 'ValuePathError';
  }
}

/** The container one level above the last segment, or throws. */
function parentOf(root: unknown, segments: readonly string[]): unknown {
  let node = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i] as string;
    if (Array.isArray(node)) {
      const index = arrayIndex(segment, node.length);
      if (index === null) throw new ValuePathError(segments.slice(0, i + 1), 'no such element');
      node = node[index];
    } else if (isJsonObject(node) && Object.hasOwn(node, segment)) {
      node = node[segment];
    } else {
      throw new ValuePathError(segments.slice(0, i + 1), 'no such member');
    }
  }
  if (node === null || typeof node !== 'object') throw new ValuePathError(segments.slice(0, -1), 'not an object or array');
  return node;
}

/**
 * Rebuilds the path down to the parent of the last segment, letting `change` make the
 * new parent from the old one. Every container on the way is copied; nothing else is.
 */
function rebuild(node: unknown, segments: readonly string[], depth: number, change: (parent: unknown) => unknown): unknown {
  if (depth === segments.length - 1) return change(node);
  const segment = segments[depth] as string;
  if (Array.isArray(node)) {
    const index = Number(segment);
    const copy = node.slice();
    copy[index] = rebuild(node[index], segments, depth + 1, change);
    return copy;
  }
  const object = node as Record<string, unknown>;
  return withMember(object, segment, rebuild(object[segment], segments, depth + 1, change));
}

function withMember(object: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> {
  const copy = { ...object };
  putMember(copy, key, value);
  return copy;
}

/** What the place held before an edit: `exists` false when the member was absent. */
export interface Previous {
  exists: boolean;
  value?: unknown;
}

/**
 * Sets the value at the segments: replaces the root (no segments), an object member
 * (added at the end when absent) or an existing array element. Returns the new root and
 * what was there.
 */
export function setIn(root: unknown, segments: readonly string[], value: unknown): { root: unknown; previous: Previous } {
  if (segments.length === 0) return { root: value, previous: { exists: true, value: root } };
  const parent = parentOf(root, segments);
  const last = segments[segments.length - 1] as string;
  let previous: Previous;
  if (Array.isArray(parent)) {
    const index = arrayIndex(last, parent.length);
    if (index === null) throw new ValuePathError(segments, 'no such element to set');
    previous = { exists: true, value: parent[index] };
  } else {
    const object = parent as Record<string, unknown>;
    previous = Object.hasOwn(object, last) ? { exists: true, value: object[last] } : { exists: false };
  }
  const next = rebuild(root, segments, 0, (node) => {
    if (Array.isArray(node)) {
      const copy: unknown[] = node.slice();
      copy[Number(last)] = value;
      return copy;
    }
    return withMember(node as Record<string, unknown>, last, value);
  });
  return { root: next, previous };
}

/** Removes an object member or an array element (the rest move up). Returns the new root, the value removed and its index in an array. */
export function removeIn(root: unknown, segments: readonly string[]): { root: unknown; value: unknown; index: number | null } {
  if (segments.length === 0) throw new ValuePathError(segments, 'the whole value cannot be removed');
  const parent = parentOf(root, segments);
  const last = segments[segments.length - 1] as string;
  if (Array.isArray(parent)) {
    const index = arrayIndex(last, parent.length);
    if (index === null) throw new ValuePathError(segments, 'no such element to remove');
    const next = rebuild(root, segments, 0, (node) => (node as unknown[]).filter((_item, i) => i !== index));
    return { root: next, value: parent[index], index };
  }
  const object = parent as Record<string, unknown>;
  if (!Object.hasOwn(object, last)) throw new ValuePathError(segments, 'no such member to remove');
  const next = rebuild(root, segments, 0, (node) => {
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(node as Record<string, unknown>)) {
      if (key !== last) putMember(copy, key, item);
    }
    return copy;
  });
  return { root: next, value: object[last], index: null };
}

/** Inserts into an array before the element the last segment names, or at its end (`-` or its length). Returns the new root and the index the value got. */
export function insertIn(root: unknown, segments: readonly string[], value: unknown): { root: unknown; index: number } {
  if (segments.length === 0) throw new ValuePathError(segments, 'an insert needs an array element');
  const parent = parentOf(root, segments);
  if (!Array.isArray(parent)) throw new ValuePathError(segments.slice(0, -1), 'not an array to insert into');
  const index = arrayIndex(segments[segments.length - 1] as string, parent.length, true);
  if (index === null) throw new ValuePathError(segments, 'no such place to insert');
  const next = rebuild(root, segments, 0, (node) => {
    const copy = (node as unknown[]).slice();
    copy.splice(index, 0, value);
    return copy;
  });
  return { root: next, index };
}
