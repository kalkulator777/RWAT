/**
 * The engine's value of a field left out whose default is figured from other fields
 * (`x-engine-default` in the schema, editor.md §3.7): an empty `brakes.train_kn` shows
 * the number the engine will take, not only the formula.
 *
 * TEMPORARY. The figures and formulas are `stock/StockDefaults.java`'s, applied as
 * `WagonTypeParser.parse` applies them (the brake system named in the file, a cab when
 * the `cab` section is there). They belong to the port ports/stockDefaults.ts (A2.3,
 * golden `stock_defaults`); when it lands, {@link STOCK} is replaced by it and nothing
 * else here changes. Until then the test of this file checks the figures against cases
 * of the golden file, written out.
 */

import type { JsonPointer } from '../core/contracts';
import { isJsonObject } from '../core/json';
import type { SchemaKind } from '../core/schema';

interface BrakeSystem {
  knPerTonne: number;
  applyS: number;
  releaseS: number;
}

/** `StockDefaults` as the forms need it; names as in Java, so the port can stand in for it. */
const STOCK = {
  RESISTANCE_A_PER_TONNE: 7.0,
  RESISTANCE_A_PER_WAGON: 200.0,
  INDEPENDENT_KN_PER_TONNE: 0.7,
  PARKING_KN_PER_TONNE: 0.4,
  DEFAULT_BRAKE_SYSTEM: 'passenger',
  systems: {
    passenger: { knPerTonne: 1.0, applyS: 4.0, releaseS: 8.0 },
    freight: { knPerTonne: 0.6, applyS: 15.0, releaseS: 30.0 },
    ep: { knPerTonne: 1.1, applyS: 1.5, releaseS: 3.0 },
  } as Record<string, BrakeSystem>,
};

/** The brake system a type's file names (`brakes.system`), the default one when it names none, undefined for an unknown name. */
function brakeSystem(type: Record<string, unknown>): BrakeSystem | undefined {
  const brakes = isJsonObject(type.brakes) ? type.brakes : {};
  const name = brakes.system === undefined ? STOCK.DEFAULT_BRAKE_SYSTEM : brakes.system;
  return typeof name === 'string' && Object.hasOwn(STOCK.systems, name) ? STOCK.systems[name] : undefined;
}

type Formula = (type: Record<string, unknown>, massT: number) => number | undefined;

const WAGON_TYPE: Record<JsonPointer, Formula> = {
  '/resistance/a': (_type, massT) => STOCK.RESISTANCE_A_PER_TONNE * massT + STOCK.RESISTANCE_A_PER_WAGON,
  '/brakes/train_kn': (type, massT) => {
    const system = brakeSystem(type);
    return system && system.knPerTonne * massT;
  },
  '/brakes/independent_kn': (type, massT) => (type.cab !== undefined ? STOCK.INDEPENDENT_KN_PER_TONNE * massT : 0.0),
  '/brakes/parking_kn': (_type, massT) => STOCK.PARKING_KN_PER_TONNE * massT,
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
  recipe_override: [],
};
