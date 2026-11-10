/**
 * Golden runner of fixtures/golden/lights/ (editor.md §4.5; fixtures/golden/README.md): the
 * port ./lights.ts against `ModelParts.lit` and `ModelParts.litMask`, the reference that
 * writes the expected. A case gives a model's light groups and their control groups'
 * values and asks which groups are on and whether each light (its group or none,
 * `LINVERT`) shines; a case with a model (`obj`… as model_parts reads it,
 * ./modelCase.node.ts) asks it of the model's own headlights, cabin lamps and glowing
 * parts, as LightsGolden does.
 */

import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../testing/repo.node';
import { mismatch, readGoldenFolder, toNumber } from '../testing/golden.node';
import { groupsOn, lit, litMask, MAX_LIGHT_GROUPS, shines } from './lights';
import { readModelCase, type ModelCase } from './modelCase.node';
import { drawn } from './modelParts';

const FOLDER = `${REPO_ROOT}fixtures/golden/lights`;

interface Input extends Partial<ModelCase> {
  values?: Record<string, number | string>;
  groups?: string[];
  lights?: { group: string | null; invert: boolean }[];
}

/** What the port makes of a case's input, as LightsGolden asks it. */
function compute(input: Input): unknown {
  const values = input.values ?? {};
  const value = (group: string): number => (Object.hasOwn(values, group) ? toNumber(values[group]) : 0);
  if (input.obj !== undefined) {
    const { objects, parts } = readModelCase(input as ModelCase);
    const mask = litMask(parts.lightGroups, value);
    return {
      on: groupsOn(parts.lightGroups, mask),
      headlights: parts.headlights.map((h) => shines(h, mask)),
      lamps: parts.lamps.map((lamp) => shines(lamp, mask)),
      glowing: parts.roles.flatMap((role, i) => (drawn(role.place) && role.light.fullbright ? [[objects[i], shines(role.light, mask)]] : [])),
    };
  }
  const groups = input.groups ?? [];
  const mask = litMask(groups, value);
  return {
    on: groupsOn(groups, mask),
    lit: (input.lights ?? []).map((light) => lit(light.group === null ? -1 : groups.indexOf(light.group), light.invert, mask)),
  };
}

const golden = readGoldenFolder(FOLDER);

describe('golden lights', () => {
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

describe('lights beyond the golden cases', () => {
  it('tells 64 groups apart: the 64th is the sign bit of a Java long, and still a group', () => {
    expect(MAX_LIGHT_GROUPS).toBe(64);
    const groups = Array.from({ length: 70 }, (_, i) => `G${i}`);
    const mask = litMask(groups, (group) => (group === 'G63' || group === 'G64' ? 1 : 0));
    expect(mask).toBe(1n << 63n);
    expect(lit(63, false, mask)).toBe(true);
    expect(lit(64, false, -1n)).toBe(false);
    expect(lit(64, true, -1n)).toBe(true);
    expect(groupsOn(groups, mask)).toEqual(['G63']);
  });

  it('shines without a group whatever the mask, LINVERT or not', () => {
    expect(lit(-1, false, 0n)).toBe(true);
    expect(lit(-1, true, -1n)).toBe(true);
  });
});
