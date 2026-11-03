/**
 * The floor tool in the built site (docs/proposals/editor.md §2.3, §3.9, M4): turned on in
 * the view's bar it looks at the coach from the top and draws its floor; a zone drawn with
 * the mouse beside the corridor, too short for a player, brings the floor check's
 * `ZONE_TOO_NARROW` up — in the tool's list of findings, in the words the checks tab has, and
 * in its warning colour —; stretched by its edge it holds a place and the finding goes;
 * undone, it comes back. Screenshots of each step go to the test's output.
 *
 * The model comes as it comes to a user (e2e/examplePack.ts); where a point of the OBJ
 * frame is on the page the test hook says (src/view3d/testHook.ts).
 */

import { expect, test, type Page } from '@playwright/test';
import type { Vec3 } from '../../src/core/contracts';
import { openPack, pickWagon, watchErrors } from '../examplePack';
import type { HookWindow } from '../viewPixels';

test.use({ locale: 'en-US', viewport: { width: 1600, height: 1000 }, colorScheme: 'light' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as HookWindow).__RWAT_E2E__ = true;
  });
  await page.goto('./');
  await expect(page.getByTestId('view3d')).toHaveAttribute('data-webgl', 'ok');
});

/** Where a point of the OBJ frame is on the page. */
async function onPage(page: Page, point: Vec3): Promise<{ x: number; y: number }> {
  const at = await page.evaluate((p) => (window as HookWindow).__rwatView?.pointOnPage(p), point);
  if (!at) throw new Error('no view');
  return at;
}

/** A drag with the left button from one point of the plan to another, at the floor's height. */
async function drag(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const a = await onPage(page, [from[0], 1.3, from[1]]);
  const b = await onPage(page, [to[0], 1.3, to[1]]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
}

async function screenshot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => (window as HookWindow).__rwatView?.renderNow());
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path });
  await test.info().attach(name, { path, contentType: 'image/png' });
}

/** The style the view draws a zone's outline in now. */
async function zoneStyle(page: Page, index: number): Promise<string | undefined> {
  return page.evaluate((i) => (window as HookWindow).__rwatView?.view.overlays.get('floor.zones')?.[i]?.style, index);
}

test('a zone drawn too short for a player is found by the floor check; stretched, the finding goes', async ({ page }) => {
  const errors = watchErrors(page);
  await openPack(page);
  await pickWagon(page, 'rwat_example:coach');
  const view = page.getByTestId('view3d');

  await view.locator('[data-toggle="tool"] [data-tool="floor"]').click();
  await expect(view.locator('[data-tool="floor"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(view).toHaveAttribute('data-camera', 'top');
  const tool = page.getByTestId('floor-tool');
  await expect(tool).toHaveAttribute('data-zones', '4');
  const findings = page.getByTestId('floor-findings');
  await expect(findings).toHaveAttribute('data-count', '0');
  // the floor drawn over the model: the zones, the pieces a centre stands on, the ways out
  const layers = await page.evaluate(() => (window as HookWindow).__rwatView?.view.overlayLayers.value);
  expect(layers).toEqual(expect.arrayContaining(['floor.zones', 'floor.pieces', 'floor.exits', 'floor.cuts', 'floor.bridges']));
  await screenshot(page, 'coach-floor-top');

  // from the free floor by the side wall to the corridor's edge, which the corner snaps to
  await drag(page, [3.4, 1.15], [3.0, 0.57]);
  await expect(tool).toHaveAttribute('data-zones', '5');
  await expect(page.locator('[data-testid="floor-zones"] [data-zone="4"]')).toHaveAttribute('data-selected', 'true');
  await expect(page.locator('#floor-min-z')).toHaveValue('0.55');
  await expect(findings).toHaveAttribute('data-codes', 'ZONE_TOO_NARROW');
  await expect(findings.locator('[data-code="ZONE_TOO_NARROW"]')).toHaveAttribute('data-index', '4');
  expect(await zoneStyle(page, 4)).toBe('warning');
  await screenshot(page, 'coach-floor-narrow-zone');

  // stretched by its far end along the car to about x 4 (the end snaps to what is near
  // there): a player fits, and the corridor joins it
  const number = async (id: string): Promise<number> => Number(await page.locator(id).inputValue());
  const minX = await number('#floor-min-x');
  const maxX = await number('#floor-max-x');
  const minZ = await number('#floor-min-z');
  const maxZ = await number('#floor-max-z');
  expect(maxX - minX).toBeLessThan(0.6);
  await drag(page, [maxX, (minZ + maxZ) / 2], [4, (minZ + maxZ) / 2]);
  await expect.poll(() => number('#floor-max-x')).toBeGreaterThan(3.8);
  expect(await number('#floor-min-x')).toBe(minX);
  await expect(findings).toHaveAttribute('data-count', '0');
  expect(await zoneStyle(page, 4)).toBe('zone');
  await screenshot(page, 'coach-floor-stretched');

  // undone, the stretch goes and the finding comes back; redone, it goes again
  await page.keyboard.press('Control+z');
  await expect(findings).toHaveAttribute('data-codes', 'ZONE_TOO_NARROW');
  await page.keyboard.press('Control+Shift+z');
  await expect(findings).toHaveAttribute('data-count', '0');

  // the plain selection again: the floor's layers go, the camera stays
  await view.locator('[data-toggle="tool"] [data-tool="select"]').click();
  await expect(tool).toHaveCount(0);
  const after = await page.evaluate(() => (window as HookWindow).__rwatView?.view.overlayLayers.value);
  expect(after?.filter((layer) => layer.startsWith('floor.'))).toEqual([]);
  expect(errors).toEqual([]);
});

test('the doors open bridge the coach’s salon door; the shunter’s floor is its cab', async ({ page }) => {
  const errors = watchErrors(page);
  await openPack(page);
  await pickWagon(page, 'rwat_example:coach');
  const view = page.getByTestId('view3d');
  await view.locator('[data-toggle="tool"] [data-tool="floor"]').click();
  const count = (layer: string) => page.evaluate((l) => (window as HookWindow).__rwatView?.view.overlays.get(l)?.length ?? 0, layer);
  expect(await count('floor.cuts')).toBe(1);
  await page.locator('[data-toggle="floor-doors"] [data-value="open"]').click();
  await expect.poll(() => count('floor.bridges')).toBe(2);
  expect(await count('floor.cuts')).toBe(0);
  await screenshot(page, 'coach-floor-doors-open');

  // another wagon: the tool is turned on afresh for it
  await pickWagon(page, 'rwat_example:shunter');
  await expect(page.getByTestId('floor-tool')).toHaveAttribute('data-cabs', '1');
  await expect.poll(() => count('floor.cabs')).toBeGreaterThan(0);
  await expect(page.locator('[data-toggle="floor-doors"] [data-value="closed"]')).toHaveAttribute('aria-pressed', 'true');
  await screenshot(page, 'shunter-floor-cab');
  expect(errors).toEqual([]);
});
