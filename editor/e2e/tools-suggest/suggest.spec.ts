/**
 * The suggestions in the built site (docs/proposals/editor.md §3.9, §3.12, M6): the Python
 * tools of the converter run in Pyodide, served by the site itself, and not a byte of it
 * is asked for before a button is pressed.
 *
 * - The coach with its floor taken away (every zone removed in the zones tool): a level
 *   clicked on the model's floor, «Предложить пол» — Pyodide loads with its progress shown
 *   — gives floorgen's zones (the real `python3` says what they are), drawn dashed over the
 *   view; Accept is one entry of the journal and the floor is there, the floor check finds
 *   nothing; Ctrl+Z takes it away.
 * - The coach with its doors taken away: «Двери по именам» finds the model's doors; Accept
 *   adds them.
 * - A pack with a texture in a folder `Textures/`: the checks tab lists what renaming would
 *   change, Apply does it, the finding goes, Ctrl+Z gives the pack back.
 *
 * Screenshots go to the test's output. The service worker is kept out, so the loading
 * measured is the cold one.
 */

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js';
import type { Vec3 } from '../../src/core/contracts';
import { EXAMPLE_PACK, TOOLS_DIR } from '../../src/testing/repo.node';
import { dump } from '../../src/core/json';
import { openPack, pickWagon, watchErrors } from '../examplePack';
import { readTree } from '../../src/core/pack/testing.node';
import type { HookWindow } from '../viewPixels';

test.use({ locale: 'en-US', viewport: { width: 1600, height: 1000 }, colorScheme: 'light', serviceWorkers: 'block' });

const COACH_TYPE = 'data/rwat_example/wagon_types/coach.json';
const COACH_FILE = join(EXAMPLE_PACK, ...COACH_TYPE.split('/'));
const COACH_OBJ = join(EXAMPLE_PACK, 'assets', 'rwat_example', 'stock', 'coach', 'coach.obj');

/** Every URL the page and its workers ask for. */
async function watchRequests(page: Page): Promise<string[]> {
  const urls: string[] = [];
  await page.context().route('**/*', async (route) => {
    urls.push(route.request().url());
    await route.continue();
  });
  return urls;
}

const pyodideRequests = (urls: readonly string[]): string[] => urls.filter((url) => url.includes('/pyodide/'));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as HookWindow).__RWAT_E2E__ = true;
  });
});

/** Where a point of the OBJ frame is on the page. */
async function onPage(page: Page, point: Vec3): Promise<{ x: number; y: number }> {
  const at = await page.evaluate((p) => (window as HookWindow).__rwatView?.pointOnPage(p), point);
  if (!at) throw new Error('no view');
  return at;
}

async function screenshot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => (window as HookWindow).__rwatView?.renderNow());
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path });
  await test.info().attach(name, { path, contentType: 'image/png' });
}

/** The shapes of a layer of the view now. */
function layer(page: Page, name: string) {
  return page.evaluate((l) => (window as HookWindow).__rwatView?.view.overlays.get(l) ?? [], name);
}

/** A zip of the example pack with `change` applied to its files (path → bytes). */
async function zipWith(change: (files: Map<string, Uint8Array>) => void): Promise<Buffer> {
  const files = readTree(EXAMPLE_PACK);
  change(files);
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
  for (const [name, bytes] of [...files].sort(([a], [b]) => (a < b ? -1 : 1))) await writer.add(name, new Uint8ArrayReader(bytes));
  return Buffer.from(await writer.close());
}

/** floorgen's own answer for the coach at `level` (python3), or null where it does not run. */
function pythonZones(level: number): { min: number[]; max: number[] }[] | null {
  const script = [
    'import sys, json',
    `sys.path.insert(0, ${JSON.stringify(TOOLS_DIR)})`,
    'import floorgen',
    'f = floorgen.generate(open(sys.argv[1], "rb").read(), floorgen.FloorConfig({"level": float(sys.argv[2])}), json.load(open(sys.argv[3]))["doors"])',
    'print(json.dumps(f.interior))',
  ].join('\n');
  const run = spawnSync('python3', ['-I', '-c', script, COACH_OBJ, String(level), COACH_FILE], { encoding: 'utf8' });
  return run.status === 0 ? (JSON.parse(run.stdout) as { min: number[]; max: number[] }[]) : null;
}

test('a floor suggested for the coach that has none: a level clicked on the model, a dashed draft, Accept, Ctrl+Z; Pyodide is asked for only by the button', async ({ page }) => {
  test.setTimeout(180_000);
  const urls = await watchRequests(page);
  const errors = watchErrors(page);
  await page.goto('./');
  await expect(page.getByTestId('view3d')).toHaveAttribute('data-webgl', 'ok');
  await openPack(page);
  await pickWagon(page, 'rwat_example:coach');
  const view = page.getByTestId('view3d');

  // the floor taken away, zone by zone
  await view.locator('[data-toggle="tool"] [data-tool="floor"]').click();
  const tool = page.getByTestId('floor-tool');
  await expect(tool).toHaveAttribute('data-zones', '4');
  for (let i = 0; i < 4; i++) await page.locator('[data-testid="floor-zones"] [data-zone="0"] [aria-label="Remove zone 0"]').click();
  await expect(tool).toHaveAttribute('data-zones', '0');
  await expect(page.getByTestId('suggest-floor')).toHaveAttribute('data-phase', 'idle');

  // only the model's floor left to click on: the roof and the rest are in the way from the top
  await page.evaluate(() => {
    const hook = (window as HookWindow).__rwatView;
    const model = hook?.view.model.value;
    for (const object of model?.objects ?? []) if (object.name !== 'FLOOR') hook?.view.setVisible(object.name, false);
  });
  await page.locator('[data-action="suggest-pick-level"]').click();
  await expect(page.locator('[data-action="suggest-pick-level"]')).toHaveAttribute('aria-pressed', 'true');
  const at = await onPage(page, [2, 1.3, 0.2]);
  await page.mouse.click(at.x, at.y);
  const levels = page.getByTestId('suggest-levels');
  await expect(levels).toHaveAttribute('data-levels', '1.3');
  await expect(page.locator('[data-action="suggest-pick-level"]')).toHaveAttribute('aria-pressed', 'false');
  expect(await layer(page, 'suggest.level')).toHaveLength(1);
  await screenshot(page, 'coach-floor-level');
  // nothing of Python so far: not a request for Pyodide, and the bridge has not started
  expect(pyodideRequests(urls)).toEqual([]);

  // the button: Pyodide is fetched, its progress is shown, then the draft
  await page.locator('[data-action="suggest-floor-run"]').click();
  await expect(page.getByTestId('suggest-progress')).toBeVisible();
  const draft = page.getByTestId('suggest-draft');
  await expect(draft).toBeVisible({ timeout: 150_000 });
  expect(pyodideRequests(urls).some((url) => url.endsWith('/pyodide.asm.wasm'))).toBe(true);
  await expect(page.getByTestId('suggest-progress')).toHaveCount(0);
  const zones = Number(await draft.getAttribute('data-zones'));
  expect(zones).toBeGreaterThan(5);
  await expect(draft).toHaveAttribute('data-findings', '0');
  await expect(page.getByTestId('suggest-draft-findings')).toContainText('nothing found');

  // dashed over the view, equal to floorgen's own zones, and the type has none yet
  const shapes = (await layer(page, 'suggest.floor')) as unknown as { shape: string; style: string; min: number[]; max: number[] }[];
  expect(shapes).toHaveLength(zones);
  expect(shapes.every((shape) => shape.shape === 'rect' && shape.style === 'draft')).toBe(true);
  const theirs = pythonZones(1.3);
  if (theirs !== null) expect(shapes.map(({ min, max }) => ({ min, max }))).toEqual(theirs);
  await expect(tool).toHaveAttribute('data-zones', '0');
  await screenshot(page, 'coach-floor-draft');

  // Accept: one entry, the floor is there, the check finds nothing; the draft is gone from the view
  await page.locator('[data-action="suggest-floor-accept"]').click();
  await expect(tool).toHaveAttribute('data-zones', String(zones));
  await expect(page.getByTestId('floor-findings')).toHaveAttribute('data-count', '0');
  await expect(page.getByTestId('suggest-draft')).toHaveCount(0);
  expect(await layer(page, 'suggest.floor')).toEqual([]);
  expect((await layer(page, 'floor.zones')).length).toBe(zones);
  await screenshot(page, 'coach-floor-accepted');

  // undone in one step: no floor again
  await page.keyboard.press('Control+z');
  await expect(tool).toHaveAttribute('data-zones', '0');
  expect(errors).toEqual([]);
});

test('Reject keeps the type as it is; a level the model has no floor at is said in words', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = watchErrors(page);
  await page.goto('./');
  await openPack(page);
  await pickWagon(page, 'rwat_example:coach');
  await page.getByTestId('view3d').locator('[data-toggle="tool"] [data-tool="floor"]').click();
  const tool = page.getByTestId('floor-tool');
  await expect(tool).toHaveAttribute('data-zones', '4');

  // a level with no surface: the sentence, the generator's own line behind a fold
  await page.locator('#suggest-level').fill('7');
  await page.locator('#suggest-level').press('Enter');
  await expect(page.getByTestId('suggest-levels')).toHaveAttribute('data-levels', '7');
  await page.locator('[data-action="suggest-floor-run"]').click();
  const error = page.getByTestId('suggest-error');
  await expect(error).toBeVisible({ timeout: 150_000 });
  await expect(error).toContainText('The model has no level surface facing up at 7');
  await expect(error).not.toContainText('Traceback');
  await error.locator('summary').click();
  await expect(error.locator('pre')).toContainText('no up-facing surface near level');

  // another level, the floor the coach has: the draft, rejected, changes nothing
  await page.getByRole('button', { name: 'Remove level 7' }).click();
  await page.locator('#suggest-level').fill('1.3');
  await page.locator('#suggest-level').press('Enter');
  await page.locator('[data-action="suggest-floor-run"]').click();
  await expect(page.getByTestId('suggest-draft')).toBeVisible({ timeout: 60_000 });
  expect((await layer(page, 'suggest.floor')).length).toBeGreaterThan(5);
  await page.locator('[data-action="suggest-floor-reject"]').click();
  await expect(page.getByTestId('suggest-draft')).toHaveCount(0);
  expect(await layer(page, 'suggest.floor')).toEqual([]);
  await expect(tool).toHaveAttribute('data-zones', '4');
  await expect(page.getByTestId('undo')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('«Двери по именам» finds the doors of a model whose type has none, and Accept adds them', async ({ page }) => {
  test.setTimeout(180_000);
  const urls = await watchRequests(page);
  const errors = watchErrors(page);
  await page.goto('./');
  const withoutDoors = await zipWith((files) => {
    const type = JSON.parse(new TextDecoder().decode(files.get(COACH_TYPE))) as Record<string, unknown>;
    delete type.doors;
    files.set(COACH_TYPE, new TextEncoder().encode(dump(type)));
  });
  await openPack(page, withoutDoors);
  await pickWagon(page, 'rwat_example:coach');
  await page.getByTestId('view3d').locator('[data-toggle="tool"] [data-tool="doors"]').click();
  await expect(page.getByTestId('doors-tool')).toHaveAttribute('data-doors', '0');
  expect(pyodideRequests(urls)).toEqual([]);

  await page.locator('[data-action="suggest-doors-run"]').click();
  const draft = page.getByTestId('suggest-doors-draft');
  await expect(draft).toBeVisible({ timeout: 150_000 });
  const found = Number(await draft.getAttribute('data-found'));
  expect(found).toBeGreaterThan(3);
  await expect(draft).toHaveAttribute('data-new', String(found));
  const boxes = await layer(page, 'suggest.doors');
  expect(boxes).toHaveLength(found);
  expect(boxes.every((shape) => shape.shape === 'box' && shape.style === 'draft')).toBe(true);
  await screenshot(page, 'coach-doors-draft');

  await page.locator('[data-action="suggest-doors-accept"]').click();
  await expect(page.getByTestId('doors-tool')).toHaveAttribute('data-doors', String(found));
  await expect(page.getByTestId('suggest-doors-draft')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('doors-tool')).toHaveAttribute('data-doors', '0');
  expect(errors).toEqual([]);
});

test('a texture in a folder Textures/: the checks list the renaming, Apply does it, the finding goes, Ctrl+Z gives the pack back', async ({ page }) => {
  test.setTimeout(180_000);
  const urls = await watchRequests(page);
  const errors = watchErrors(page);
  await page.goto('./');
  const coach = 'assets/rwat_example/stock/coach';
  const broken = await zipWith((files) => {
    const bytes = files.get(`${coach}/coach_body.png`);
    if (bytes === undefined) throw new Error('no texture');
    files.delete(`${coach}/coach_body.png`);
    files.set(`${coach}/Textures/coach_body.png`, bytes);
    const mtl = new TextDecoder().decode(files.get(`${coach}/coach.mtl`)).replace('map_Kd coach_body.png', 'map_Kd Textures/coach_body.png');
    files.set(`${coach}/coach.mtl`, new TextEncoder().encode(mtl));
  });
  await openPack(page, broken);
  await page.getByRole('tab', { name: 'Checks' }).click();
  const finding = page.locator('[data-code="loader.resource-path"]');
  await expect(finding).toHaveCount(1);
  await expect(finding).toContainText(`${coach}/Textures/coach_body.png`);
  const bar = page.getByTestId('repair-paths');
  await expect(bar).toHaveAttribute('data-bad', '1');
  expect(pyodideRequests(urls)).toEqual([]);

  // the list first: nothing has changed, nothing of Python was asked
  await page.locator('[data-action="repair-review"]').click();
  const plan = page.getByTestId('repair-plan');
  await expect(plan).toBeVisible();
  await expect(plan).toHaveAttribute('data-files', '1');
  await expect(plan).toHaveAttribute('data-refs', '1');
  await expect(plan).toContainText(`${coach}/textures/coach_body.png`);
  await expect(plan).toContainText('Textures/coach_body.png');
  await expect(finding).toHaveCount(1);
  expect(pyodideRequests(urls)).toEqual([]);
  await screenshot(page, 'rename-plan');

  await page.locator('[data-action="repair-apply"]').click();
  await expect(page.getByTestId('repair-done')).toBeVisible({ timeout: 150_000 });
  expect(pyodideRequests(urls).some((url) => url.endsWith('/pyodide.asm.wasm'))).toBe(true);
  await expect(page.locator('[data-code="loader.resource-path"]')).toHaveCount(0);
  // the old name deleted, the new one made, the MTL rewritten: three files for the save
  await expect(page.getByTestId('save')).toHaveText('Save (3)');

  await page.getByTestId('undo').click();
  await expect(page.locator('[data-code="loader.resource-path"]')).toHaveCount(1);
  await expect(page.getByTestId('save')).toHaveText('Save');
  expect(errors).toEqual([]);
});
