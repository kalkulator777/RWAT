/**
 * The hinges tool in the built site (docs/proposals/editor.md §2.4, §3.9, M4): turned on
 * for the shunter it marks every control's hinge; the throttle chosen in its list has its
 * axis, the arc of its −50° travel and its end as a ghost drawn, and its objects selected
 * and framed; a click on the reverser's knob in the view chooses the reverser. It edits
 * nothing. A screenshot of the throttle's travel goes to the test's output.
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

async function count(page: Page, layer: string): Promise<number> {
  return page.evaluate((l) => (window as HookWindow).__rwatView?.view.overlays.get(l)?.length ?? 0, layer);
}

test('the throttle’s hinge, axis, arc of travel and end show; a click on the reverser chooses it', async ({ page }) => {
  const errors = watchErrors(page);
  await openPack(page);
  await pickWagon(page, 'rwat_example:shunter');
  const view = page.getByTestId('view3d');
  await view.locator('[data-toggle="tool"] [data-tool="pivots"]').click();
  const tool = page.getByTestId('pivots-tool');
  await expect(tool).toHaveAttribute('data-controls', '29');
  expect(await count(page, 'pivots.markers')).toBeGreaterThan(10);
  expect(await count(page, 'pivots.ghost')).toBe(0);

  await page.locator('[data-testid="pivots-controls"] [data-key="THROTTLE_1"] button').click();
  await expect(page.getByTestId('pivots-chosen')).toHaveAttribute('data-control', '1');
  await expect(page.locator('[data-fact="degrees"]')).toHaveText('-50');
  expect(await count(page, 'pivots.ghost')).toBe(6);
  expect(await count(page, 'pivots.travel')).toBe(1);
  expect(await count(page, 'pivots.axis')).toBe(1);
  // its objects selected and framed from the side, across its axis, the cab's walls and roof out of the way
  await page.locator('[data-action="pivots-select"]').click();
  await page.evaluate(() => {
    const hook = (window as HookWindow).__rwatView;
    hook?.view.setRoleShown('body', false);
    hook?.view.setCamera('side');
    hook?.view.requestFraming('selected');
  });
  const box = await view.locator('canvas').boundingBox();
  if (box !== null) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 400);
  }
  const path = test.info().outputPath('shunter-throttle-travel.png');
  await page.evaluate(() => (window as HookWindow).__rwatView?.renderNow());
  await page.screenshot({ path });
  await test.info().attach('shunter-throttle-travel', { path, contentType: 'image/png' });

  const knob = await page.evaluate(() => (window as HookWindow).__rwatView?.screenOf('REVERSER_1_KNOB'));
  if (!knob) throw new Error('the reverser’s knob is not drawn');
  await page.mouse.click(knob.x, knob.y);
  await expect(page.getByTestId('pivots-chosen')).toHaveAttribute('data-control', '2');
  await expect(page.locator('[data-fact="travel"]')).toHaveText('value from -0.5 to 0.5');
  // it only shows: nothing to undo
  await expect(page.getByTestId('undo')).toBeDisabled();
  expect(errors).toEqual([]);
});
