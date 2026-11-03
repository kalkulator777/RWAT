/**
 * The preview's stand-in for the light rule (./lights.ts) held to the engine's: the cases
 * of fixtures/golden/lights/ that need no model (groups, values, lights → the groups on and
 * which lights shine). Not the folder's runner — that is ports/lights.ts' (agent A3.1), and
 * this stand-in goes with it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GOLDEN_DIR } from '../testing/repo.node';
import { toNumber } from '../testing/golden.node';
import { groupsOn, lit, MAX_LIGHT_GROUPS } from './lights';

interface Case {
  id: string;
  input: { groups?: string[]; values: Record<string, number | string>; lights?: { group: string | null; invert: boolean }[] };
  expected: { on: string[]; lit?: boolean[] };
}

const cases = (JSON.parse(readFileSync(join(GOLDEN_DIR, 'lights', 'lights.json'), 'utf8')) as { cases: Case[] }).cases.filter(
  (c) => c.input.groups !== undefined && c.input.lights !== undefined,
);

describe('the light rule against the engine’s golden cases', () => {
  it('has the cases without a model', () => {
    expect(cases.length).toBeGreaterThanOrEqual(10);
  });

  for (const c of cases) {
    it(c.id, () => {
      const groups = c.input.groups!;
      const value = (group: string): number => {
        const v = c.input.values[group];
        return v === undefined ? 0 : toNumber(v);
      };
      const on = groupsOn(groups, value);
      expect(groups.filter((_, i) => on[i])).toEqual(c.expected.on);
      expect(c.input.lights!.map((light) => lit(light.group === null ? -1 : groups.indexOf(light.group), light.invert, on))).toEqual(c.expected.lit);
    });
  }

  it('never lights a group past the 64th', () => {
    const groups = Array.from({ length: MAX_LIGHT_GROUPS + 2 }, (_, i) => `G${i}`);
    const on = groupsOn(groups, () => 1);
    expect(lit(MAX_LIGHT_GROUPS, false, on)).toBe(false);
    expect(lit(MAX_LIGHT_GROUPS, true, on)).toBe(true);
    expect(lit(MAX_LIGHT_GROUPS - 1, false, on)).toBe(true);
  });
});
