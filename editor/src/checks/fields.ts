/**
 * Field descriptors (core/schema `FieldDescriber`) seen from a pack file's value: which
 * descriptor describes the value at a pointer, which branch of a `oneOf` the value takes,
 * which fields are spatial markup. Pure: the checks use it to word findings (a reserved
 * field's note in the interface language), the forms to lay a file out.
 */

import { parsePointer } from '../core/json';
import type { FieldDescriptor } from '../core/schema';

/** The JSON type names of a value as the schema spells them: `integer` is also a `number`. */
function typesOf(value: unknown): string[] {
  if (value === null) return ['null'];
  if (Array.isArray(value)) return ['array'];
  if (typeof value === 'number') return Number.isInteger(value) ? ['integer', 'number'] : ['number'];
  return [typeof value];
}

/** True when the descriptor's type admits the value (a descriptor without types admits anything). */
export function fitsType(d: FieldDescriptor, value: unknown): boolean {
  if (d.shape === 'const') return JSON.stringify(d.const) === JSON.stringify(value);
  if (d.variants !== undefined) return d.variants.some((v) => fitsType(v, value));
  if (d.types.length === 0) return d.shape !== 'null' || value === null;
  const types = typesOf(value);
  return d.types.some((t) => types.includes(t)) || (value === null && d.nullable);
}

/** The branch of a `oneOf`/`anyOf` the value takes: the first whose type admits it; undefined for an absent value or none. */
export function variantOf(d: FieldDescriptor, value: unknown): FieldDescriptor | undefined {
  if (value === undefined || d.variants === undefined) return undefined;
  return d.variants.find((v) => fitsType(v, value));
}

/** The descriptor one step down from `d` towards `segment`, for a value `value` at `d`. */
function step(d: FieldDescriptor, value: unknown, segment: string): FieldDescriptor | undefined {
  const own = d.properties?.find((p) => p.key === segment);
  if (own !== undefined) return own;
  if (d.values !== undefined && !Array.isArray(value)) return d.values;
  if (d.items !== undefined && (Array.isArray(value) || /^(?:0|[1-9][0-9]*)$/.test(segment))) return d.items;
  return undefined;
}

function member(value: unknown, segment: string): unknown {
  if (Array.isArray(value)) return value[Number(segment)];
  if (value !== null && typeof value === 'object' && Object.hasOwn(value, segment)) return (value as Record<string, unknown>)[segment];
  return undefined;
}

/**
 * The descriptor of the value at `pointer` in a file whose root descriptor is `root` and
 * whose value is `value`, following the branch of each `oneOf` the value takes (the first
 * branch that has the next key when the value is absent). Undefined when the schema
 * describes no such place (an unknown key, a step into a scalar).
 */
export function descriptorAt(root: FieldDescriptor, value: unknown, pointer: string): FieldDescriptor | undefined {
  let d: FieldDescriptor | undefined = root;
  let here = value;
  for (const segment of parsePointer(pointer)) {
    if (d === undefined) return undefined;
    if (d.variants !== undefined) {
      const chosen: FieldDescriptor | undefined = variantOf(d, here) ?? d.variants.find((v) => step(v, here, segment) !== undefined);
      if (chosen === undefined) return undefined;
      d = chosen;
    }
    d = step(d, here, segment);
    here = member(here, segment);
  }
  return d;
}

/**
 * Spatial markup (editor.md §3.7, §3.9): a field in a coordinate frame (`x-frame`), or a
 * list or a choice of such fields, or a list of objects that hold one (a driver's chair:
 * its `at`). These are edited in the 3D view with their tools (M4), not as plain numbers.
 */
export function isSpatial(d: FieldDescriptor): boolean {
  if (d.frame !== undefined) return true;
  if (d.items !== undefined) return d.items.frame !== undefined || (d.items.properties ?? []).some((p) => p.frame !== undefined);
  if (d.variants !== undefined) return d.variants.some(isSpatial);
  return false;
}
