/**
 * Golden runner of fixtures/golden/stock_defaults/ (editor.md §4.5; fixtures/golden/README.md):
 * ./stockDefaults against `stock/StockDefaults.java`, the reference that writes the
 * expected — the resistance and brakes a type gets for what its pack leaves out, a brake
 * system by its name, the constants.
 */

import Ajv2020 from 'ajv/dist/2020';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../testing/repo.node';
import {
  ADHESION,
  BRAKE_SYSTEMS,
  DEFAULT_BRAKE_SYSTEM,
  TRACTION_RAMP_S,
  brakeSystemByName,
  brakes,
  resistance,
  type BrakeSystem,
} from './stockDefaults';

const FOLDER = `${REPO_ROOT}fixtures/golden/stock_defaults`;

// ---- the golden case files (one copy per runner until a shared helper takes them over)

interface Case {
  id: string;
  note: string;
  input?: unknown;
  input_file?: string | Record<string, string>;
  expected: unknown;
}

interface CaseFile {
  tolerance: number;
  cases: Case[];
}

const NON_FINITE: Record<string, number> = { NaN: NaN, Infinity: Infinity, '-Infinity': -Infinity };

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

const files = readdirSync(FOLDER)
  .filter((name) => name.endsWith('.json') && name !== 'ports.json')
  .sort();

/** First place where `actual` differs from `expected` (numbers within `tol`, non-finite ones by name), or null. */
function mismatch(actual: unknown, expected: unknown, tol: number, path = '$'): string | null {
  const fail = `${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
  if (typeof expected === 'string' && expected in NON_FINITE) {
    return Object.is(actual, NON_FINITE[expected]) || actual === expected ? null : fail;
  }
  if (typeof expected === 'number') {
    return typeof actual === 'number' && Number.isFinite(actual) && Math.abs(actual - expected) <= tol ? null : fail;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return fail;
    for (let i = 0; i < expected.length; i++) {
      const found = mismatch(actual[i], expected[i], tol, `${path}[${i}]`);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof expected === 'object' && expected !== null) {
    if (typeof actual !== 'object' || actual === null || Array.isArray(actual)) return fail;
    const keys = Object.keys(expected);
    if (JSON.stringify(Object.keys(actual)) !== JSON.stringify(keys)) return `${path}: keys ${JSON.stringify(Object.keys(actual))}, expected ${JSON.stringify(keys)}`;
    for (const key of keys) {
      const found = mismatch((actual as Record<string, unknown>)[key], (expected as Record<string, unknown>)[key], tol, `${path}.${key}`);
      if (found !== null) return found;
    }
    return null;
  }
  return actual === expected ? null : fail;
}

describe('golden stock_defaults', () => {
  it('names this port in ports.json, every file follows the golden schema, and there are enough cases', () => {
    expect(readJson(`${FOLDER}/ports.json`)).toMatchObject({ reference: 'java', ports: expect.arrayContaining(['ts']) as unknown });
    const ajv = new Ajv2020({ strict: false });
    const valid = ajv.compile(readJson(`${REPO_ROOT}fixtures/golden/schema.json`) as object);
    let cases = 0;
    for (const name of files) {
      const document = readJson(`${FOLDER}/${name}`);
      expect(valid(document), `${name}: ${ajv.errorsText(valid.errors)}`).toBe(true);
      cases += (document as CaseFile).cases.length;
    }
    expect(cases).toBeGreaterThanOrEqual(10);
  });

  for (const name of files) {
    const file = readJson(`${FOLDER}/${name}`) as CaseFile;
    describe(name, () => {
      for (const c of file.cases) {
        it(c.id, () => {
          expect(mismatch(compute(c.input as Input), c.expected, file.tolerance), c.note).toBeNull();
        });
      }
    });
  }
});

// ---- what the port makes of an input, laid out as StockDefaultsGolden lays the engine's

interface Input {
  system_name?: string;
  constants?: true;
  mass_t?: number;
  system?: string;
  drivable?: boolean;
}

function compute(input: Input): unknown {
  if (input.system_name !== undefined) return brakeSystemByName(input.system_name)?.jsonName ?? null;
  if (input.constants !== undefined) {
    const systems: Record<string, unknown> = {};
    for (const system of BRAKE_SYSTEMS) {
      systems[system.jsonName] = { kn_per_tonne: system.knPerTonne, apply_s: system.applyS, release_s: system.releaseS };
    }
    return { adhesion: ADHESION, traction_ramp_s: TRACTION_RAMP_S, default_brake_system: DEFAULT_BRAKE_SYSTEM.jsonName, systems };
  }
  const massT = input.mass_t as number;
  const system = brakeSystemByName(input.system as string) as BrakeSystem;
  const r = resistance(massT);
  const b = brakes(system, massT, input.drivable === true);
  return {
    resistance: { a: r.a, b: r.b, c: r.c, c_front: r.cFront },
    brakes: {
      train_kn: b.trainKn,
      independent_kn: b.independentKn,
      dynamic_kn: b.dynamicKn,
      dynamic_fade_kmh: b.dynamicFadeKmh,
      parking_kn: b.parkingKn,
      apply_s: b.applyS,
      release_s: b.releaseS,
    },
  };
}
