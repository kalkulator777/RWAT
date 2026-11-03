/**
 * Golden runner of fixtures/golden/stock_defaults/ (editor.md §4.5; fixtures/golden/README.md):
 * ./stockDefaults against `stock/StockDefaults.java`, the reference that writes the
 * expected — the resistance and brakes a type gets for what its pack leaves out, a brake
 * system by its name, the constants.
 */

import { describe, expect, it } from 'vitest';
import { mismatch, readGoldenFolder } from '../testing/golden.node';
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

const golden = readGoldenFolder(FOLDER);

describe('golden stock_defaults', () => {
  it('names this port in ports.json, and the folder follows the golden format', () => {
    expect(golden.ports).toMatchObject({ reference: 'java', ports: expect.arrayContaining(['ts']) as unknown });
    expect(golden.problems).toEqual([]);
  });

  for (const file of golden.files) {
    describe(file.name, () => {
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
