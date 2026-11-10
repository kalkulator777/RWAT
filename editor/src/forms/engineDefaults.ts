/**
 * The engine's value of a field left out whose default is figured from other fields
 * (`x-engine-default` in the schema, editor.md §3.7): an empty `brakes.train_kn` shows
 * the number the engine will take, not only the formula.
 *
 * The figures are the port's, ports/stockDefaults.ts (`stock/StockDefaults.java`, golden
 * `stock_defaults`), applied as `WagonTypeParser.parse` applies them: the brake system
 * named in the file (the default one when it names none), a cab when the `cab` section is
 * there. Unlike the parser, the form figures what it can from a file that does not load
 * yet: the brakes that do not depend on the brake system are shown with an unknown one.
 * The `type` section of a conversion override is figured as a wagon type: a form over
 * layers (2b) shows the type the pack gets there.
 */

import type { JsonPointer } from '../core/contracts';
import { isJsonObject } from '../core/json';
import type { SchemaKind } from '../core/schema';
import { brakes, brakeSystemByName, DEFAULT_BRAKE_SYSTEM, resistance, type Brakes, type BrakeSystem } from '../ports/stockDefaults';

/** The brake system a type's file names (`brakes.system`), the default one when it names none, null for an unknown name. */
function brakeSystem(type: Record<string, unknown>): BrakeSystem | null {
  const section = isJsonObject(type.brakes) ? type.brakes : {};
  if (section.system === undefined) return DEFAULT_BRAKE_SYSTEM;
  return typeof section.system === 'string' ? brakeSystemByName(section.system) : null;
}

/** `StockDefaults.brakes` for the file: its brake system (any, for the brakes that do not depend on it) and its cab. */
function brakesOf(type: Record<string, unknown>, massT: number): Brakes {
  return brakes(brakeSystem(type) ?? DEFAULT_BRAKE_SYSTEM, massT, type.cab !== undefined);
}

type Formula = (type: Record<string, unknown>, massT: number) => number | undefined;

const WAGON_TYPE: Record<JsonPointer, Formula> = {
  '/resistance/a': (_type, massT) => resistance(massT).a,
  '/brakes/train_kn': (type, massT) => (brakeSystem(type) === null ? undefined : brakesOf(type, massT).trainKn),
  '/brakes/independent_kn': (type, massT) => brakesOf(type, massT).independentKn,
  '/brakes/parking_kn': (type, massT) => brakesOf(type, massT).parkingKn,
};

/** Formulas that need no mass. */
const WAGON_TYPE_CONSTANT: Record<JsonPointer, (type: Record<string, unknown>) => number | undefined> = {
  '/brakes/apply_s': (type) => brakeSystem(type)?.applyS,
  '/brakes/release_s': (type) => brakeSystem(type)?.releaseS,
};

/**
 * The engine's value of the field at `at` of a file of `kind` whose value is `root`, when
 * the field is left out; undefined when the schema's `x-engine-default` is not a number the
 * editor can figure (no mass yet, an unknown brake system, a default that needs the model).
 */
export function engineDefault(kind: SchemaKind, at: JsonPointer, root: unknown): number | undefined {
  // a conversion override's `type` is a wagon type (a form over layers shows the merged one there)
  if (kind === 'recipe_override') return isJsonObject(root) && at.startsWith('/type/') ? engineDefault('wagon_type', at.slice('/type'.length), root.type) : undefined;
  if (kind !== 'wagon_type' || !isJsonObject(root)) return undefined;
  const constant = WAGON_TYPE_CONSTANT[at];
  if (constant !== undefined) return constant(root);
  const formula = WAGON_TYPE[at];
  const massT = root.mass_t;
  if (formula === undefined || typeof massT !== 'number' || !(massT > 0)) return undefined;
  return formula(root, massT);
}

/** The pointers {@link engineDefault} can figure, for the test that every one has an `x-engine-default` in the schema. */
export const FIGURED_DEFAULTS: Readonly<Record<SchemaKind, readonly JsonPointer[]>> = {
  wagon_type: [...Object.keys(WAGON_TYPE), ...Object.keys(WAGON_TYPE_CONSTANT)],
  wagon_model: [],
  rail_model: [],
  pack_mcmeta_rwat: [],
  recipe: [],
  recipe_override: [...Object.keys(WAGON_TYPE), ...Object.keys(WAGON_TYPE_CONSTANT)].map((at) => `/type${at}`),
};
