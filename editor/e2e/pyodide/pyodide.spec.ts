/**
 * The Python bridge in the browser (docs/proposals/editor.md §3.11, §3.12, §5.5): the
 * built site's worker loads Pyodide from the site's own files — no request leaves the
 * site, checked on every request the page and its workers make — and answers
 * `suggest_floor` for the example pack's coach with floorgen's zones (the real Python
 * says what they are, where python3 runs); cancelling stops the worker and the next call
 * starts a new one. The bridge is the page's (`window.__rwatPython`, given to a test page
 * only). The service worker is kept out, so the loading measured is the cold one.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { EXAMPLE_PACK, TOOLS_DIR } from '../../src/testing/repo.node';

const COACH = join(EXAMPLE_PACK, 'assets', 'rwat_example', 'stock', 'coach', 'coach.obj');
const COACH_TYPE = join(EXAMPLE_PACK, 'data', 'rwat_example', 'wagon_types', 'coach.json');
const OPTIONS = { level: 1.3 };

test.use({ serviceWorkers: 'block' });

/** Every URL the page and its workers ask for; any that leaves the site is refused and noted. */
async function watchRequests(page: Page, origin: string): Promise<{ all: string[]; outside: string[] }> {
  const seen = { all: [] as string[], outside: [] as string[] };
  await page.context().route('**/*', async (route) => {
    const url = route.request().url();
    seen.all.push(url);
    if (url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:')) await route.continue();
    else {
      seen.outside.push(url);
      await route.abort('blockedbyclient');
    }
  });
  return seen;
}

/** floorgen's own answer, from python3; null where it does not run. */
function pythonFloor(): unknown {
  const script = [
    'import sys, json',
    `sys.path.insert(0, ${JSON.stringify(TOOLS_DIR)})`,
    'import floorgen',
    'f = floorgen.generate(open(sys.argv[1], "rb").read(), floorgen.FloorConfig(json.loads(sys.argv[2])), json.load(open(sys.argv[3]))["doors"])',
    'print(json.dumps({"interior": f.interior, "levels": [floorgen.y_to_obj(l) for l in f.levels], "notes": f.notes,',
    '                  "regionArea": f.region.area(), "droppedArea": f.dropped_area}))',
  ].join('\n');
  const run = spawnSync('python3', ['-I', '-c', script, COACH, JSON.stringify(OPTIONS), COACH_TYPE], { encoding: 'utf8' });
  return run.status === 0 ? (JSON.parse(run.stdout) as unknown) : null;
}

type Bridge = import('../../src/ir/bridge').PythonBridge;

test('the worker loads Pyodide from the site and suggests the example coach\'s floor', async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  const origin = new URL(baseURL ?? '/').origin;
  const requests = await watchRequests(page, origin);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    (window as { __RWAT_E2E__?: boolean }).__RWAT_E2E__ = true;
  });
  await page.goto('./');
  await page.waitForFunction(() => (window as { __rwatPython?: unknown }).__rwatPython !== undefined);
  expect(requests.all.some((url) => url.includes('/pyodide/'))).toBe(false); // nothing loaded before it is asked for

  const obj = [...readFileSync(COACH)];
  const doors = (JSON.parse(readFileSync(COACH_TYPE, 'utf8')) as { doors: unknown[] }).doors;
  const answer = await page.evaluate(
    async ({ obj, doors, options }) => {
      const bridge = (window as unknown as { __rwatPython: Bridge }).__rwatPython;
      const stages: string[] = [];
      let loaded = 0;
      let total = 0;
      bridge.onProgress((p) => {
        if (stages.at(-1) !== p.stage) stages.push(p.stage);
        loaded = Math.max(loaded, p.loaded);
        total = p.total;
      });
      const began = performance.now();
      const info = await bridge.start();
      const loadMs = performance.now() - began;
      const asked = performance.now();
      const floor = await bridge.suggestFloor(new Uint8Array(obj), options, doors);
      return { info, loadMs, floorMs: performance.now() - asked, floor, stages, loaded, total, memory: await bridge.memory() };
    },
    { obj, doors, options: OPTIONS },
  );
  console.info(
    `Pyodide ${answer.info.pyodide} (Python ${answer.info.python}) in the browser: cold load ${answer.loadMs.toFixed(0)} ms ` +
      `(${(answer.loaded / 2 ** 20).toFixed(1)} of ${(answer.total / 2 ** 20).toFixed(1)} MiB counted), suggest_floor ${answer.floorMs.toFixed(0)} ms, ` +
      `wasm heap ${(answer.memory / 2 ** 20).toFixed(0)} MiB`,
  );

  expect(requests.outside).toEqual([]);
  const wasm = requests.all.filter((url) => url.endsWith('/pyodide.asm.wasm'));
  expect(wasm).toHaveLength(1);
  expect(wasm[0]).toMatch(new RegExp(`^${origin}/pyodide/${answer.info.pyodide.replaceAll('.', '\\.')}/pyodide\\.asm\\.wasm$`));
  expect(answer.stages).toEqual(['download', 'start', 'ready']);
  expect(answer.loaded).toBe(answer.total);
  expect(answer.floor.levels).toEqual([1.3]);
  expect(answer.floor.interior.length).toBeGreaterThan(5);
  const reference = pythonFloor();
  if (reference !== null) expect(answer.floor).toEqual(reference);
  expect(errors).toEqual([]);
});

test('cancelling stops the worker: the call fails as cancelled, the next one starts anew', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    (window as { __RWAT_E2E__?: boolean }).__RWAT_E2E__ = true;
  });
  await page.goto('./');
  await page.waitForFunction(() => (window as { __rwatPython?: unknown }).__rwatPython !== undefined);
  const obj = [...readFileSync(COACH)];
  const outcome = await page.evaluate(
    async ({ obj }) => {
      const bridge = (window as unknown as { __rwatPython: Bridge }).__rwatPython;
      await bridge.start();
      const abort = new AbortController();
      // two levels and a fine grid: seconds of work, cancelled at once
      const running = bridge.suggestFloor(new Uint8Array(obj), { level: [1.15, 1.3], cell: 0.03125 }, [], { signal: abort.signal });
      setTimeout(() => abort.abort(), 50);
      const failed = await running.then(
        () => 'finished',
        (error: { kind?: string }) => error.kind ?? 'unknown',
      );
      const stage = bridge.progress.stage;
      const again = await bridge.suggestFloor(new Uint8Array(obj), { level: 1.3, cell: 0.125 }, []);
      return { failed, stage, zones: again.interior.length };
    },
    { obj },
  );
  expect(outcome).toMatchObject({ failed: 'cancelled', stage: 'idle' });
  expect(outcome.zones).toBeGreaterThan(0);
});

test.describe('with the service worker', () => {
  test.use({ serviceWorkers: 'allow' });

  test('Pyodide used once on the first visit loads offline afterwards', async ({ page, context }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => {
      (window as { __RWAT_E2E__?: boolean }).__RWAT_E2E__ = true;
    });
    const doors = () =>
      page.evaluate(async () => {
        const bridge = (window as unknown as { __rwatPython: Bridge }).__rwatPython;
        const obj = 'o DOOR_1_EXTERNAL\nv 0 0 0\nv 1 0 0\nv 1 2 0\nv 0 2 0\nf 1 2 3 4\n';
        return (await bridge.modelDoors(new TextEncoder().encode(obj), [])).length;
      });
    await page.goto('./');
    await page.waitForFunction(() => (window as { __rwatPython?: unknown }).__rwatPython !== undefined);
    // the first visit's page is the service worker's at once, so what it fetches is cached as fetched
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 20_000 });
    expect(await doors()).toBeGreaterThanOrEqual(0);
    const cached = await page.evaluate(async () => (await (await caches.open('rwat-pyodide')).keys()).map((r) => r.url.split('/').pop()).sort());
    expect(cached).toEqual(['pyodide-lock.json', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'pyodide.mjs', 'python_stdlib.zip']);

    await context.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => (window as { __rwatPython?: unknown }).__rwatPython !== undefined);
    expect(await doors()).toBeGreaterThanOrEqual(0);
    await context.setOffline(false);
  });
});
