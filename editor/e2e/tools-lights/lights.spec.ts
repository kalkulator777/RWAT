/**
 * The lights tool in the built site (docs/proposals/editor.md §2.4, §3.9, M4): turned on
 * for the shunter it draws a cone out of each headlight the way it shines — the front one
 * forward, the rear one backward — and the cab's lamp; the group FHL chosen in its list has
 * its headlight drawn in a colour of its own, the cab's IL its lamp, and a click on the
 * front lens chooses FHL again. It edits nothing. A screenshot of the chosen group goes to
 * the test's output.
 */

import { expect, test, type Page } from '@playwright/test';
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

async function styles(page: Page, layer: string): Promise<string[]> {
  return page.evaluate((l) => (window as HookWindow).__rwatView?.view.overlays.get(l)?.map((s) => s.style) ?? [], layer);
}

test('the shunter’s headlights shine each its own way; a group chosen stands out', async ({ page }) => {
  const errors = watchErrors(page);
  await openPack(page);
  await pickWagon(page, 'rwat_example:shunter');
  const view = page.getByTestId('view3d');
  await view.locator('[data-toggle="tool"] [data-tool="lights"]').click();
  const tool = page.getByTestId('lights-tool');
  await expect(tool).toHaveAttribute('data-headlights', '2');
  await expect(tool).toHaveAttribute('data-lamps', '1');
  await expect(tool).toHaveAttribute('data-groups', '5');
  await expect(page.locator('[data-headlight="0"]')).toHaveAttribute('data-way', 'forward');
  await expect(page.locator('[data-headlight="1"]')).toHaveAttribute('data-way', 'back');
  expect(await styles(page, 'lights.headlights')).toHaveLength(8);

  await page.locator('[data-testid="lights-groups"] [data-group="0"] button').click();
  await expect(tool).toHaveAttribute('data-chosen', '0');
  expect((await styles(page, 'lights.headlights')).slice(0, 4)).toEqual(Array.from({ length: 4 }, () => 'lights.chosen'));
  const path = test.info().outputPath('shunter-lights-fhl.png');
  await page.evaluate(() => (window as HookWindow).__rwatView?.renderNow());
  await page.screenshot({ path });
  await test.info().attach('shunter-lights-fhl', { path, contentType: 'image/png' });

  // the cab's lights chosen in the list, then a click on the front headlight in the view
  // (the shutter over its lens, a control of the group FHL): its group
  await page.locator('[data-testid="lights-groups"] [data-group="3"] button').click();
  await expect(tool).toHaveAttribute('data-chosen', '3');
  expect(await styles(page, 'lights.lamps')).toEqual(['lights.chosen', 'lights.chosen']);
  const lens = await page.evaluate(() => (window as HookWindow).__rwatView?.screenOf('HEADLIGHT_1_LCG_FHL_0XFFF2CC'));
  if (!lens) throw new Error('the front lens is not drawn');
  await page.mouse.click(lens.x, lens.y);
  await expect(tool).toHaveAttribute('data-chosen', '0');
  // it only shows: nothing to undo
  await expect(page.getByTestId('undo')).toBeDisabled();
  expect(errors).toEqual([]);
});
