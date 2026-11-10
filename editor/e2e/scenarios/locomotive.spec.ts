/**
 * Scenario 2.4 of docs/proposals/editor.md, short, on the example shunter: a control moved
 * in the preview as the game moves it (the throttle to notch 8 turns its lever), a light
 * group switched on (its headlight lights, its cover goes) and named in the Names tab, a
 * sound changed in the Sounds tab; the checks find nothing, Save counts the two files.
 */

import { expect, test, type Page } from '@playwright/test';
import { pickWagon } from '../examplePack';
import type { HookWindow } from '../viewPixels';
import { checksTab, NS, openZip, packFiles, screenshot, watchErrors, zipOf } from './steps';

test.use({ locale: 'en-US', viewport: { width: 1600, height: 1000 }, colorScheme: 'light' });

const SHUNTER = `${NS}:shunter`;

/** What the view holds now of some objects: the transform (column-major, null at rest), hidden, lit. */
async function viewOf(page: Page, names: readonly string[]): Promise<Record<string, { transform: number[] | null; hidden: boolean; lit: boolean }>> {
  return page.evaluate((names) => {
    const view = (window as HookWindow).__rwatView?.view;
    if (!view) throw new Error('no view');
    return Object.fromEntries(
      names.map((name) => {
        const matrix = view.transforms.get(name);
        return [name, { transform: matrix === undefined ? null : Array.from(matrix), hidden: view.hidden.has(name), lit: view.lit.has(name) }];
      }),
    );
  }, names);
}

/** The knob of the throttle as the view turns it now. */
async function knob(page: Page): Promise<number[] | null> {
  return (await viewOf(page, ['THROTTLE_1_KNOB'])).THROTTLE_1_KNOB?.transform ?? null;
}

async function previewSection(page: Page, section: 'controls' | 'lights'): Promise<void> {
  await page.getByRole('tab', { name: 'Preview', exact: true }).click();
  await page.getByTestId('preview').locator(`button[data-section="${section}"]`).click();
  await expect(page.getByTestId('preview')).toHaveAttribute('data-section', section);
}

test('2.4 the shunter: the throttle moved in the preview, a light group on and named, a sound changed', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    (window as HookWindow).__RWAT_E2E__ = true;
  });
  await page.goto('./');
  await expect(page.getByTestId('view3d')).toHaveAttribute('data-webgl', 'ok');
  await openZip(page, await zipOf(packFiles()), 'RwatExamplePack.zip');
  await pickWagon(page, SHUNTER);

  // 1. a control: the throttle at notch 8, as the driver sets it; its lever turns
  await previewSection(page, 'controls');
  const throttle = page.locator('tr[data-control="THROTTLE_1"]');
  const atRest = await knob(page);
  await throttle.locator('input[type="range"]').fill('8');
  await expect(throttle).toContainText('8');
  await expect.poll(() => knob(page)).not.toEqual(atRest);

  // 2. a light group: FHL on, its headlight lights and its cover goes
  const lens = 'HEADLIGHT_1_LCG_FHL_0XFFF2CC';
  const cover = 'WIDGET_7_CG_FHL_HIDE_NOTOUCH';
  await previewSection(page, 'lights');
  await page.locator('label[data-group="FHL"] input').check();
  await page.getByRole('button', { name: 'Show in the Light display' }).click();
  await expect(page.getByTestId('view3d')).toHaveAttribute('data-display', 'lit');
  await expect.poll(async () => await viewOf(page, [lens, cover])).toEqual({ [lens]: { transform: null, hidden: false, lit: true }, [cover]: expect.objectContaining({ hidden: true }) as unknown });
  await screenshot(page, 'scenario-2-4-headlight', page.getByTestId('view3d'));

  // its name, in the Names tab
  await page.getByRole('tab', { name: 'Names', exact: true }).click();
  const name = page.getByTestId('names').getByLabel(`light.${NS}.shunter.FHL, en_us`);
  await expect(name).toHaveValue('Front headlight');
  await name.fill('Front lamp');
  await name.press('Enter');
  await expect(page.getByTestId('save')).toHaveText('Save (1)');

  // 3. a sound: the horn another game sound; the tab says it cannot be played here
  await page.getByRole('tab', { name: 'Sounds', exact: true }).click();
  await expect(page.getByTestId('sounds')).toHaveAttribute('data-wagon', SHUNTER);
  const horn = page.locator('[data-ref="/sounds/horn/main"]');
  await horn.locator('input.sounds-ref-input').fill('minecraft:block.note_block.didgeridoo');
  await horn.locator('input.sounds-ref-input').press('Enter');
  await expect(horn.getByTestId('sounds-ref-note')).toHaveText('a game sound, cannot be played here (minecraft:block.note_block.didgeridoo)');
  await expect(page.getByTestId('sounds-effective-horn')).toHaveText('A held signal sounds at pitch 0.8, volume 1.');
  await expect(page.getByTestId('save')).toHaveText('Save (2)');

  await expect((await checksTab(page)).getByTestId('checks-summary')).toHaveText('No findings.');
  // undone, the sound is as it was
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('save')).toHaveText('Save (1)');
  expect(errors).toEqual([]);
});
