/**
 * The floor check's budget on MVP's types (docs/proposals/editor.md §3.10–3.11): a type as
 * the pack writes it, read (./wagonType) and checked (./floorCheck `findings`), within
 * {@link BUDGET_MS} for the heaviest type on a quiet machine. MVP's long cars took tens of
 * milliseconds while `FloorRegion.reach` passed over every piece of the floor for every
 * step it walked (`er2m` 57 ms, `dr1a_motorhead` 49 ms, all 45 types 380 ms); now a pass
 * visits only the pieces on its line (./floorRegion `reach`, the same answers), and the
 * heaviest, `dr1a_motorhead`, takes some 10 ms, all 45 types some 50 ms.
 *
 * Coverage instrumentation (`npm test`) slows the check several times over (the heaviest
 * 30–40 ms; under the engine's rule 0.4–0.9 s) and a busy runner more, so the test holds
 * each type to {@link GUARD_MS} and says how long the heaviest took; that the walk along a
 * floor is no longer quadratic is held, apart from the clock's moods, by
 * ./floorRegion.test.ts. Measured
 * in Node, the same engine (V8) and code as the page: each type read and checked once to
 * warm up, then the best of three. MVP is in the repository for now (D3, R12): without it
 * the test is skipped and says so (E9).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../testing/repo.node';
import { findings } from './floorCheck';
import { parseWagonType } from './wagonType';

/** What the heaviest type of MVP is to take on a quiet machine, ms. */
const BUDGET_MS = 20;

/** What any type of MVP may take under coverage on a busy runner, ms: the engine's rule took up to 900 there. */
const GUARD_MS = 5 * BUDGET_MS;

const MVP_TYPES = join(REPO_ROOT, 'run', 'rwat_packs', 'MatoiVanillaPack', 'data', 'mvp', 'wagon_types');
const present = existsSync(MVP_TYPES);

/** A type read from its text and checked, ms: the best of three after a warm-up. */
function timed(id: string, text: string): number {
  findings(parseWagonType(id, JSON.parse(text) as unknown));
  let best = Infinity;
  for (let run = 0; run < 3; run++) {
    const json = JSON.parse(text) as unknown; // a new value: the type's floor is built anew
    const started = performance.now();
    findings(parseWagonType(id, json));
    best = Math.min(best, performance.now() - started);
  }
  return best;
}

describe('the floor check budget on MVP', () => {
  it.skipIf(!present)(`checks the heaviest type of MVP within ${BUDGET_MS} ms on a quiet machine`, () => {
    const names = readdirSync(MVP_TYPES).filter((name) => name.endsWith('.json'));
    let worst = { id: '', ms: 0 };
    let total = 0;
    for (const name of names) {
      const id = `mvp:${name.slice(0, -'.json'.length)}`;
      const ms = timed(id, readFileSync(join(MVP_TYPES, name), 'utf8'));
      total += ms;
      if (ms > worst.ms) worst = { id, ms };
    }
    console.info(`floor check, MVP: ${names.length} types in ${total.toFixed(1)} ms, the heaviest ${worst.id} in ${worst.ms.toFixed(2)} ms`);
    expect(names.length).toBeGreaterThan(40);
    expect(worst.ms, worst.id).toBeLessThanOrEqual(GUARD_MS);
  }, 60_000);

  it.skipIf(present)('is skipped: MVP (run/rwat_packs/MatoiVanillaPack) is not in this checkout', () => {
    expect(present).toBe(false);
  });
});
