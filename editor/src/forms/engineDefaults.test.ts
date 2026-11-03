/**
 * The engine's values the forms figure for empty fields: ports/stockDefaults applied to a
 * file as the parser applies it, held to cases of fixtures/golden/stock_defaults written
 * out (the port itself is held to the whole folder by its runner, ports/stockDefaults.test.ts),
 * and the schema: each figured field says `x-engine-default`.
 */

import { describe, expect, it } from 'vitest';
import { descriptorAt } from '../checks/fields';
import { createSchema, SCHEMA_KINDS } from '../core/schema';
import { readSchemaFiles } from '../core/schema/files.node';
import { engineDefault, FIGURED_DEFAULTS } from './engineDefaults';

const schema = createSchema(readSchemaFiles());

/** stock_defaults/defaults.json: `mass-50-passenger-cab`, `mass-80-freight-no-cab`, `mass-42-ep-cab`. */
const CASES = [
  { type: { mass_t: 50, brakes: { system: 'passenger' }, cab: {} }, a: 550, train: 50, independent: 35, parking: 20, apply: 4, release: 8 },
  { type: { mass_t: 80, brakes: { system: 'freight' } }, a: 760, train: 48, independent: 0, parking: 32, apply: 15, release: 30 },
  { type: { mass_t: 42, brakes: { system: 'ep' }, cab: {} }, a: 494, train: 46.2, independent: 29.4, parking: 16.8, apply: 1.5, release: 3 },
];

describe("the engine's value of an empty field", () => {
  it('is StockDefaults applied to the mass, the brake system and the cab of the file', () => {
    for (const c of CASES) {
      const at = (pointer: string): number | undefined => engineDefault('wagon_type', pointer, c.type);
      expect(at('/resistance/a')).toBeCloseTo(c.a, 9);
      expect(at('/brakes/train_kn')).toBeCloseTo(c.train, 9);
      expect(at('/brakes/independent_kn')).toBeCloseTo(c.independent, 9);
      expect(at('/brakes/parking_kn')).toBeCloseTo(c.parking, 9);
      expect(at('/brakes/apply_s')).toBe(c.apply);
      expect(at('/brakes/release_s')).toBe(c.release);
    }
  });

  it('takes the passenger brake when the file names none, and gives up without a mass or with an unknown system', () => {
    expect(engineDefault('wagon_type', '/brakes/train_kn', { mass_t: 24 })).toBe(24);
    expect(engineDefault('wagon_type', '/brakes/apply_s', {})).toBe(4);
    expect(engineDefault('wagon_type', '/brakes/train_kn', {})).toBeUndefined();
    expect(engineDefault('wagon_type', '/brakes/train_kn', { mass_t: 'x' })).toBeUndefined();
    expect(engineDefault('wagon_type', '/brakes/train_kn', { mass_t: 10, brakes: { system: 'magnetic' } })).toBeUndefined();
    expect(engineDefault('wagon_type', '/brakes/apply_s', { brakes: { system: 7 } })).toBeUndefined();
    expect(engineDefault('wagon_type', '/length', { mass_t: 10 })).toBeUndefined();
    expect(engineDefault('wagon_model', '/bogies', {})).toBeUndefined();
  });

  it('figures the brakes that do not depend on the brake system with an unknown one', () => {
    const type = { mass_t: 10, brakes: { system: 'magnetic' }, cab: {} };
    expect(engineDefault('wagon_type', '/brakes/independent_kn', type)).toBeCloseTo(7, 9);
    expect(engineDefault('wagon_type', '/brakes/parking_kn', type)).toBeCloseTo(4, 9);
    expect(engineDefault('wagon_type', '/brakes/independent_kn', { mass_t: 10 })).toBe(0);
  });

  it('is figured only for fields whose schema says x-engine-default', () => {
    for (const kind of SCHEMA_KINDS) {
      const root = schema.fields.root(kind);
      for (const pointer of FIGURED_DEFAULTS[kind]) expect(descriptorAt(root, {}, pointer)?.engineDefault, `${kind} ${pointer}`).toBeDefined();
    }
  });
});
