/**
 * The doors tool in the built site (docs/proposals/editor.md §2.3, §3.9, M4): turned on in
 * the view's bar it looks at the coach from the top and draws its doors — boxes, the way
 * out, the inner faces, where riders walk out, the bridges, the leaves. A door made of an
 * object picked in the Objects tab (the light switch's plate: a doorway too narrow, where
 * no floor ends) brings the floor check's findings up in the Checks tab; its edge dragged
 * in the view from the front across the aisle, the findings go; undone, they come back.
 * A finding clicked in the Checks tab turns the doors tool on with its door selected.
 * Screenshots of the coach and the shunter go to the test's output.
 *
 * The model comes as it comes to a user (e2e/examplePack.ts); where a point of the OBJ
 * frame is on the page the test hook says (src/view3d/testHook.ts).
 */

import { expect, test, type Page } from '@playwright/test';
import type { Vec3 } from '../../src/core/contracts';
import { openPack, pickWagon, watchErrors } from '../examplePack';
import type { HookWindow } from '../viewPixels';

test.use({ locale: 'en-US', viewport: { width: 1600, height: 1000 }, colorScheme: 'light' });

const COACH_TYPE = 'data/rwat_example/wagon_types/coach.json';

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

async function screenshot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => (window as HookWindow).__rwatView?.renderNow());
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path });
  await test.info().attach(name, { path, contentType: 'image/png' });
}

/** How many shapes a layer of the view has now. */
function count(page: Page, layer: string): Promise<number> {
  return page.evaluate((l) => (window as HookWindow).__rwatView?.view.overlays.get(l)?.length ?? 0, layer);
}

test('a door made of an object is found by the floor check; stretched across the aisle, the findings go', async ({ page }) => {
  const errors = watchErrors(page);
  await openPack(page);
  await pickWagon(page, 'rwat_example:coach');
  const view = page.getByTestId('view3d');

  await view.locator('[data-toggle="tool"] [data-tool="doors"]').click();
  await expect(view.locator('[data-tool="doors"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(view).toHaveAttribute('data-camera', 'top');
  const tool = page.getByTestId('doors-tool');
  await expect(tool).toHaveAttribute('data-doors', '8');
  // the doors drawn over the model: boxes, the way out, inner faces, spans, bridges, leaves
  expect(await count(page, 'doors.boxes')).toBe(8);
  expect(await count(page, 'doors.bridges')).toBe(2);
  await expect.poll(() => count(page, 'doors.leaves')).toBe(8);
  await screenshot(page, 'coach-doors-top');

  // the light switch's plate on the salon's front wall, picked in the Objects tab, made a door
  await page.getByRole('tab', { name: 'Objects' }).click();
  await page.getByRole('button', { name: 'LIGHT_SWITCH_PLATE' }).click();
  await expect(page.getByTestId('doors-objects')).toHaveAttribute('data-count', '1');
  await page.locator('[data-action="doors-from-selection"]').click();
  await expect(tool).toHaveAttribute('data-doors', '9');
  await expect(page.locator('[data-testid="doors-list"] [data-door="8"]')).toHaveAttribute('data-selected', 'true');
  await expect(page.locator('#doors-min-z')).toHaveValue('0.8');

  // the floor check finds it: too narrow, and no floor ends at it
  await page.getByRole('tab', { name: 'Checks' }).click();
  const narrow = page.locator('.finding[data-code="floor.door-too-narrow"]');
  const noFloor = page.locator('.finding[data-code="floor.door-not-at-floor-end"]');
  await expect(narrow).toHaveCount(1);
  await expect(noFloor).toHaveCount(1);
  await expect(noFloor.locator('.finding-where')).toHaveText(`${COACH_TYPE} /doors/8`);
  await expect(page.getByTestId('doors-findings')).toHaveAttribute('data-codes', 'floor.door-too-narrow floor.door-not-at-floor-end');

  // from the front, its left edge (z 0.8) dragged across the aisle to the doorways' edge
  await view.locator('[data-toggle="camera"] [data-value="front"]').click();
  await expect(view).toHaveAttribute('data-camera', 'front');
  await screenshot(page, 'coach-door-front-narrow');
  await drag(page, [-7.91, 2.4, 0.8], [-7.91, 2.4, -0.45]);
  await expect(page.locator('#doors-min-z')).toHaveValue('-0.45');
  await expect(page.locator('#doors-max-z')).toHaveValue('1');
  await expect(narrow).toHaveCount(0);
  await expect(noFloor).toHaveCount(0);
  await expect(page.getByTestId('doors-findings')).toHaveAttribute('data-count', '0');
  await screenshot(page, 'coach-door-front-stretched');

  // undone, the stretch goes and the findings come back; redone, they go again
  await page.keyboard.press('Control+z');
  await expect(page.locator('#doors-min-z')).toHaveValue('0.8');
  await expect(noFloor).toHaveCount(1);
  await expect(narrow).toHaveCount(1);
  await page.keyboard.press('Control+Shift+z');
  await expect(noFloor).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(noFloor).toHaveCount(1);

  // the plain selection: the doors' layers go; a finding clicked turns the doors tool on with its door
  await view.locator('[data-toggle="tool"] [data-tool="select"]').click();
  await expect(tool).toHaveCount(0);
  const after = await page.evaluate(() => (window as HookWindow).__rwatView?.view.overlayLayers.value);
  expect(after?.filter((layer) => layer.startsWith('doors.'))).toEqual([]);
  await noFloor.click();
  await expect(view.locator('[data-tool="doors"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-testid="doors-list"] [data-door="8"]')).toHaveAttribute('data-selected', 'true');
  await expect(page.getByTestId('doors-door')).toHaveAttribute('data-door', '8');
  expect(errors).toEqual([]);
});

test('the shunter’s doors are its two fixed steps, walked out of on each side', async ({ page }) => {
  const errors = watchErrors(page);
  await openPack(page);
  await pickWagon(page, 'rwat_example:shunter');
  const view = page.getByTestId('view3d');
  await view.locator('[data-toggle="tool"] [data-tool="doors"]').click();
  const tool = page.getByTestId('doors-tool');
  await expect(tool).toHaveAttribute('data-doors', '2');
  await page.locator('[data-testid="doors-list"] [data-door="0"] .tool-item-name').click();
  await expect(page.getByTestId('doors-facts')).toHaveAttribute('data-out', 'left');
  await expect(page.getByTestId('doors-movers')).toHaveText('A fixed opening moves no leaf: it stands shut.');
  expect(await count(page, 'doors.spans')).toBe(2);
  expect(await count(page, 'doors.bridges')).toBe(0);
  await screenshot(page, 'shunter-doors-top');

  // another wagon: the tool is turned on afresh for it
  await pickWagon(page, 'rwat_example:coach');
  await expect(tool).toHaveAttribute('data-doors', '8');
  await view.locator('[data-toggle="camera"] [data-value="orbit"]').click();
  await screenshot(page, 'coach-doors-orbit');
  expect(errors).toEqual([]);
});

test('the arch moved off the aisle, which no check finds, shows by its bridge beside the aisle', async ({ page }) => {
  const errors = watchErrors(page);
  await openPack(page);
  await pickWagon(page, 'rwat_example:coach');
  const view = page.getByTestId('view3d');
  await view.locator('[data-toggle="tool"] [data-tool="doors"]').click();
  await page.locator('[data-testid="doors-list"] [data-door="7"] .tool-item-name').click();
  await expect(page.getByTestId('doors-facts')).toHaveAttribute('data-bridge', 'both');
  const style = () => page.evaluate(() => (window as HookWindow).__rwatView?.view.overlays.get('doors.bridges')?.[1]?.style);
  expect(await style()).toBe('bridge');

  // ExamplePackLoadTest.coachBreaks "salon_arch off the aisle": a block aside, typed in
  for (const [id, value] of [
    ['#doors-max-z', '1.45'],
    ['#doors-min-z', '0.55'],
  ] as const) {
    await page.locator(id).fill(value);
    await page.locator(id).press('Enter');
  }
  await expect(page.getByTestId('doors-facts')).toHaveAttribute('data-bridge', 'one');
  await expect(page.getByTestId('doors-facts')).toContainText('its bridge reaches the floor on one side only');
  await expect.poll(style).toBe('warning');
  // the floor check sees nothing wrong: the rear vestibule has doors of its own
  await expect(page.getByTestId('doors-findings')).toHaveAttribute('data-count', '0');
  await expect(page.getByTestId('checks-summary')).toHaveText('No findings.');
  // the salon door selected instead, the arch's bridge shows in its own colour
  await page.locator('[data-testid="doors-list"] [data-door="6"] .tool-item-name').click();
  await screenshot(page, 'coach-arch-off-the-aisle');
  expect(errors).toEqual([]);
});
