/**
 * The chairs tool in the built site (docs/proposals/editor.md §2.3, §3.9, M4): turned on
 * in the view's bar it looks at the shunter from the top and draws its two driver's
 * chairs; a click on the long hood places a third chair off the floor — the floor check's
 * `SEAT_NOT_SITTABLE` comes up, in the tool's own list and in the checks tab —; its disc
 * dragged onto a cushion in the cab snaps to the cushion's middle and the finding goes;
 * undone, it comes back. With the tool off, a click on that finding in the checks turns
 * the tool on with the chair selected. Screenshots of each step go to the test's output.
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

/** A drag with the left button from one point of the OBJ frame to another, as the page shows them. */
async function drag(page: Page, from: Vec3, to: Vec3): Promise<void> {
  const a = await onPage(page, from);
  const b = await onPage(page, to);
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

/** The chairs as the tool's section lists them: each one's summary. */
async function summaries(page: Page): Promise<string[]> {
  return page.locator('[data-testid="seats-driver"] .seats-summary').allTextContents();
}

test('a chair placed off the floor is found by the floor check; dragged onto a cushion, the finding goes', async ({ page }) => {
  const errors = watchErrors(page);
  await openPack(page);
  await pickWagon(page, 'rwat_example:shunter');
  const view = page.getByTestId('view3d');

  await view.locator('[data-toggle="tool"] [data-tool="seats"]').click();
  await expect(view.locator('[data-toggle="tool"] [data-tool="seats"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(view).toHaveAttribute('data-camera', 'top');
  const tool = page.getByTestId('seats-tool');
  await expect(tool).toHaveAttribute('data-places', '2');
  await expect(tool).toHaveAttribute('data-forward', '1');
  await expect(tool).toHaveAttribute('data-back', '1');
  const findings = page.getByTestId('seats-findings');
  await expect(findings).toHaveAttribute('data-count', '0');
  const layers = await page.evaluate(() => (window as HookWindow).__rwatView?.view.overlayLayers.value);
  expect(layers).toEqual(expect.arrayContaining(['seats.chairs', 'seats.facing', 'seats.floor', 'seats.reach']));
  // the cab's walls and roof out of the way, to see the chairs
  await page.evaluate(() => (window as HookWindow).__rwatView?.view.setRoleShown('body', false));
  await screenshot(page, 'shunter-seats');
  await page.evaluate(() => (window as HookWindow).__rwatView?.view.setRoleShown('body', true));

  // a click on the long hood's top, far from the cab: a chair nobody can sit down in
  const hood = await onPage(page, [-1.5, 3.3, 0.2]);
  await page.mouse.click(hood.x, hood.y);
  await expect(tool).toHaveAttribute('data-places', '3');
  await expect(tool).toHaveAttribute('data-selected', 'seat:2');
  const placed = (await summaries(page))[2] ?? '';
  expect(placed).toMatch(/^\(-1\.\d+, 3\.3, 0\.\d+\), 0°$/);
  await expect(findings).toHaveAttribute('data-codes', 'SEAT_NOT_SITTABLE');
  await expect(findings.locator('[data-code="SEAT_NOT_SITTABLE"]')).toHaveAttribute('data-index', '2');
  const checked = page.locator('.finding[data-code="floor.seat-not-sittable"]');
  await expect(checked).toHaveCount(1);
  expect(await page.evaluate(() => (window as HookWindow).__rwatView?.view.overlays.get('seats.chairs')?.[4]?.style)).toBe('warning');
  await screenshot(page, 'shunter-seat-off-floor');

  // its disc dragged onto the second chair's cushion in the cab: it snaps to its middle and height
  const [x, , z] = placed.slice(1, placed.indexOf(')')).split(', ').map(Number) as [number, number, number];
  await drag(page, [x, 3.3, z], [2.95, 2.1, 0.8]);
  await expect.poll(() => summaries(page).then((s) => s[2])).toBe('(2.95, 2.1, 0.8), 0°');
  await expect(findings).toHaveAttribute('data-count', '0');
  await expect(checked).toHaveCount(0);
  await screenshot(page, 'shunter-seat-on-cushion');

  // undone, the move goes and the finding comes back; redone, it goes again
  await page.keyboard.press('Control+z');
  await expect(findings).toHaveAttribute('data-codes', 'SEAT_NOT_SITTABLE');
  await expect(checked).toHaveCount(1);
  await page.keyboard.press('Control+Shift+z');
  await expect(findings).toHaveAttribute('data-count', '0');
  await page.keyboard.press('Control+z');
  await expect(checked).toHaveCount(1);

  // the tool off: the finding clicked in the checks turns it on, the chair selected
  await view.locator('[data-toggle="tool"] [data-tool="select"]').click();
  await expect(tool).toHaveCount(0);
  const after = await page.evaluate(() => (window as HookWindow).__rwatView?.view.overlayLayers.value);
  expect(after?.filter((layer) => layer.startsWith('seats.'))).toEqual([]);
  await checked.click();
  await expect(view.locator('[data-toggle="tool"] [data-tool="seats"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('seats-tool')).toHaveAttribute('data-selected', 'seat:2');
  await expect(page.getByTestId('seats-numbers')).toHaveAttribute('data-seat', '2');
  // the whole placing undone: two chairs again, and nothing found
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('seats-tool')).toHaveAttribute('data-places', '2');
  await expect(checked).toHaveCount(0);
  expect(errors).toEqual([]);
});
