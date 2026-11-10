/**
 * Scenario 2.3 of docs/proposals/editor.md, short (the markup tools' own tests are in
 * e2e/tools-*): the example shunter with no markup — its floor, doors and chairs taken out
 * of its type — marked up again in the view: a zone of the cab floor drawn with the mouse
 * from the top and its height clicked on the floor; a door made of the doorway guide picked
 * in the Objects tab; a chair placed by a click on a cushion. The floor check finds nothing
 * at each step, in the tool's own list and in the checks tab; undo takes the chair back.
 *
 * Where a point of the OBJ frame is on the page the test hook says (src/view3d/testHook.ts).
 */

import { expect, test, type Page } from '@playwright/test';
import type { Vec3 } from '../../src/core/contracts';
import { pickWagon } from '../examplePack';
import type { HookWindow } from '../viewPixels';
import { NS, openZip, packFiles, screenshot, watchErrors, zipOf } from './steps';

test.use({ locale: 'en-US', viewport: { width: 1600, height: 1000 }, colorScheme: 'light' });

const SHUNTER = `data/${NS}/wagon_types/shunter.json`;

async function onPage(page: Page, point: Vec3): Promise<{ x: number; y: number }> {
  const at = await page.evaluate((p) => (window as HookWindow).__rwatView?.pointOnPage(p), point);
  if (!at) throw new Error('no view');
  return at;
}

/** A drag with the left button from one point of the OBJ frame to another. */
async function drag(page: Page, from: Vec3, to: Vec3): Promise<void> {
  const a = await onPage(page, from);
  const b = await onPage(page, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
}

async function click(page: Page, point: Vec3): Promise<void> {
  const at = await onPage(page, point);
  await page.mouse.click(at.x, at.y);
}

/** The cab's walls and roof shown or not (they hide the floor and the chairs from the top). */
async function body(page: Page, shown: boolean): Promise<void> {
  await page.evaluate((s) => (window as HookWindow).__rwatView?.view.setRoleShown('body', s), shown);
}

test('2.3 the shunter marked up again: a floor zone, a door of an object, a chair on its cushion', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    (window as HookWindow).__RWAT_E2E__ = true;
  });
  await page.goto('./');
  await expect(page.getByTestId('view3d')).toHaveAttribute('data-webgl', 'ok');
  const zip = await zipOf(
    packFiles({
      [SHUNTER]: (type) => {
        delete type.interior;
        delete type.doors;
        delete type.cab;
      },
    }),
  );
  await openZip(page, zip, 'Bare.zip');
  await pickWagon(page, `${NS}:shunter`);
  const view = page.getByTestId('view3d');

  // 1. «Zones»: from the top, a drag across the cab floor; its height a click on the floor
  await view.locator('[data-toggle="tool"] [data-tool="floor"]').click();
  await expect(view).toHaveAttribute('data-camera', 'top');
  const floor = page.getByTestId('floor-tool');
  await expect(floor).toHaveAttribute('data-zones', '0');
  await drag(page, [1.3, 1.6, -1.35], [3.3, 1.6, 1.35]);
  await expect(floor).toHaveAttribute('data-zones', '1');
  await body(page, false);
  await page.locator('[data-action="floor-pick-height"]').click();
  await click(page, [2.3, 1.6, 0]);
  await expect(page.locator('#floor-min-y')).toHaveValue('1.6');
  await body(page, true);
  await expect(page.getByTestId('floor-findings')).toHaveAttribute('data-count', '0');
  await screenshot(page, 'scenario-2-3-zone');

  // 2. «Doors»: the left doorway's guide picked in the Objects tab, a door made of it
  await view.locator('[data-toggle="tool"] [data-tool="doors"]').click();
  await page.getByRole('tab', { name: 'Objects' }).click();
  await page.getByRole('button', { name: 'GUIDE_DOORWAY_STEPS_LEFT' }).click();
  await expect(page.getByTestId('doors-objects')).toHaveAttribute('data-count', '1');
  await page.locator('[data-action="doors-from-selection"]').click();
  await expect(page.getByTestId('doors-tool')).toHaveAttribute('data-doors', '1');
  for (const [box, value] of [
    ['#doors-min-x', '2'],
    ['#doors-max-x', '2.6'],
    ['#doors-min-z', '1.42'],
    ['#doors-max-z', '1.5'],
  ] as const) {
    await expect(page.locator(box)).toHaveValue(value);
  }
  await expect(page.getByTestId('doors-facts')).toHaveAttribute('data-out', 'left');
  await expect(page.getByTestId('doors-findings')).toHaveAttribute('data-count', '0');

  // 3. «Chairs»: a click on the driver's cushion puts the chair in its middle, on its top
  await view.locator('[data-toggle="tool"] [data-tool="seats"]').click();
  const seats = page.getByTestId('seats-tool');
  await expect(seats).toHaveAttribute('data-places', '0');
  await body(page, false);
  await click(page, [1.52, 2.1, -0.93]);
  await expect(seats).toHaveAttribute('data-places', '1');
  await expect(page.locator('[data-testid="seats-driver"] .seats-summary')).toHaveText(['(1.65, 2.1, -0.8), 0°']);
  await screenshot(page, 'scenario-2-3-chair');
  await body(page, true);
  await expect(page.getByTestId('seats-findings')).toHaveAttribute('data-count', '0');
  await page.getByRole('tab', { name: 'Checks', exact: true }).click();
  await expect(page.getByTestId('checks-summary')).toHaveText('No findings.');

  // undone, the chair goes; the zone and the door stay
  await page.keyboard.press('Control+z');
  await expect(seats).toHaveAttribute('data-places', '0');
  await view.locator('[data-toggle="tool"] [data-tool="floor"]').click();
  await expect(page.getByTestId('floor-tool')).toHaveAttribute('data-zones', '1');
  await expect(page.getByTestId('save')).toHaveText('Save (1)');
  expect(errors).toEqual([]);
});
