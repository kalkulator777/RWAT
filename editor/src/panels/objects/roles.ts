/**
 * What the objects tab reads of schema/obj-conventions.json: the wagon roles in the order
 * the engine tries them, and the schema's entries by id. The texts of the schema are
 * picked by language in ./explain.ts.
 */

import conventions from '../../../../schema/obj-conventions.json';

/** The schema, as the tab reads it. */
export const CONVENTIONS = conventions;

/** A role's entry in the schema's `roles`. */
export interface RoleEntry {
  id: string;
  name: string;
  category: string;
  match?: { type: string; value?: string; regex?: string; input?: string; also?: string };
  except?: string[];
  effect: string;
  engine?: string;
  code?: string[];
  examples?: string[];
  [key: string]: unknown;
}

/** The wagon roles, in `parse_order.steps`: the first step that takes an object decides. */
export const ROLE_ORDER: readonly string[] = conventions.parse_order.steps;

const ENTRIES = new Map<string, RoleEntry>((conventions.roles as RoleEntry[]).map((entry) => [entry.id, entry]));

/** The schema entry of a role, or undefined for an id the schema does not know. */
export function roleEntry(id: string): RoleEntry | undefined {
  return ENTRIES.get(id);
}

/** The regular expression a role's `match` gives, compiled as the engine's ports compile them; null when the match has none. */
export function roleRegex(id: string): RegExp | null {
  const source = ENTRIES.get(id)?.match?.regex;
  return source === undefined ? null : new RegExp(source, 'u');
}

/** The position of a role in the engine's order; roles it does not know go last. */
export function roleRank(id: string): number {
  const at = ROLE_ORDER.indexOf(id);
  return at < 0 ? ROLE_ORDER.length : at;
}
