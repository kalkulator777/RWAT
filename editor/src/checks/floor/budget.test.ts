/**
 * The floor check's budget (docs/proposals/editor.md §3.10–3.11). It runs on the main
 * thread a moment after an edit, type by type, giving the page back between them
 * (./live.ts). A type of the example pack is checked within 10 ms. The largest types of MVP
 * take tens of milliseconds each — some 70 ms for `dr1a_motorhead`, 350 ms for all 45
 * types on a quiet machine, several times that under coverage — not the "units of
 * milliseconds" the plan reckoned: what keeps the page responsive is the slicing (one type
 * at most between two turns of the page, ./live.test.ts), and the number here is a guard
 * against a check gone quadratic, wide enough for a busy runner with coverage on.
 * Measured in Node, the same engine (V8) and code as the page; each type warmed up once,
 * then the best of three runs. MVP is in the repository for now (D3, R12): without it
 * that part is skipped and says so.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXAMPLE_PACK, REPO_ROOT } from '../../testing/repo.node';
import { typeFloorProblems } from './problems';

/** The budget of one type of the example pack, ms. */
const BUDGET_MS = 10;

/** The guard of one type of MVP, ms (a quiet machine: under 100, the long task of §3.11). */
const MVP_GUARD_MS = 2000;

const MVP = join(REPO_ROOT, 'run', 'rwat_packs', 'MatoiVanillaPack');
const MVP_TYPES = join(MVP, 'data', 'mvp', 'wagon_types');
const present = existsSync(MVP_TYPES);

/** The slowest type of a pack's namespace: its id and its best time of three, ms. */
function slowest(root: string, namespace: string): { id: string; ms: number; types: number } {
  const folder = join(root, 'data', namespace, 'wagon_types');
  let worst = { id: '', ms: 0 };
  const names = readdirSync(folder).filter((name) => name.endsWith('.json'));
  for (const name of names) {
    const id = `${namespace}:${name.slice(0, -'.json'.length)}`;
    const text = readFileSync(join(folder, name), 'utf8');
    typeFloorProblems(id, name, JSON.parse(text) as unknown);
    let best = Infinity;
    for (let run = 0; run < 3; run++) {
      const value = JSON.parse(text) as unknown; // a new value: not the cached findings
      const started = performance.now();
      typeFloorProblems(id, name, value);
      best = Math.min(best, performance.now() - started);
    }
    if (best > worst.ms) worst = { id, ms: best };
  }
  return { ...worst, types: names.length };
}

describe('the floor check budget (§3.10)', () => {
  it(`checks each type of the example pack within ${BUDGET_MS} ms`, () => {
    const { id, ms } = slowest(EXAMPLE_PACK, 'rwat_example');
    expect(ms, id).toBeLessThanOrEqual(BUDGET_MS);
  });

  it.skipIf(!present)(`checks every type of MVP, each within ${MVP_GUARD_MS} ms`, () => {
    const { id, ms, types } = slowest(MVP, 'mvp');
    console.info(`floor check, MVP: ${types} types, the slowest ${id} in ${ms.toFixed(2)} ms`);
    expect(ms, id).toBeLessThanOrEqual(MVP_GUARD_MS);
  }, 120_000); // 45 types four times over: a minute with coverage on a busy runner

  it.skipIf(present)('is skipped for MVP: run/rwat_packs/MatoiVanillaPack is not in this checkout', () => {
    expect(present).toBe(false);
  });
});
