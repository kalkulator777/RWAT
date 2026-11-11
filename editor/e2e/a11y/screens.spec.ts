/**
 * axe on every screen and state of the editor (docs/proposals/editor.md §5.2, §6.3), in the
 * light and the dark scheme and in both languages: the empty start, the open example pack,
 * each kind of file of the tree, each tab of the bottom area, each markup tool, the layers
 * menu, the failure banner and every window (new pack, add wagon, save with and without
 * changes, the restore question after a reload, the Keys window). No `serious` or `critical`
 * violation is allowed anywhere; the lesser ones go into the test's report (`axe-*`
 * attachment) and are listed in the milestone's report.
 *
 * Also held here: the page's `lang` follows the interface language, and the colour scheme the
 * test asked for is the one the page drew in.
 */

import { expect, test, type Page } from '@playwright/test';
import { openPack, pickWagon, watchErrors } from '../examplePack';
import type { HookWindow } from '../viewPixels';
import { Audit } from './axe';

const COACH = 'data/rwat_example/wagon_types/coach.json';

/** One tree file by its path. */
function file(page: Page, path: string) {
  return page.getByTestId('tree').locator(`[data-file="${path}"]`).first();
}

/** Opens a tab of the bottom area. */
async function tab(page: Page, id: string): Promise<void> {
  await page.locator(`#tab-${id}`).click();
  await expect(page.locator(`#tab-${id}`)).toHaveAttribute('aria-selected', 'true');
}

/** Turns a tool on in the view's bar and waits until it is on. */
async function tool(page: Page, id: string): Promise<void> {
  const button = page.locator(`[data-toggle="tool"] [data-tool="${id}"]`);
  await expect(button).toBeEnabled();
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('tool-section')).toHaveAttribute('data-tool', id);
}

for (const scheme of ['light', 'dark'] as const) {
  for (const [locale, lang] of [
    ['en-US', 'en'],
    ['ru-RU', 'ru'],
  ] as const) {
    test.describe(`${scheme} scheme, ${lang}`, () => {
      test.use({ locale, colorScheme: scheme, viewport: { width: 1600, height: 1000 } });

      test('axe finds nothing serious or critical on any screen', async ({ page }) => {
        test.setTimeout(240_000);
        const errors = watchErrors(page);
        const axe = new Audit();
        await page.addInitScript(() => {
          (window as HookWindow).__RWAT_E2E__ = true;
        });
        await page.goto('./');
        await expect(page.getByTestId('view3d')).toHaveAttribute('data-webgl', 'ok');
        await expect(page.locator('html')).toHaveAttribute('lang', lang);
        expect(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(scheme === 'dark');

        // ---- the empty start and the windows that need no pack
        await axe.at(page, 'empty');
        await page.getByTestId('keys-button').click();
        await expect(page.getByTestId('keys-dialog')).toBeVisible();
        await axe.at(page, 'keys-window');
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('keys-dialog')).toHaveCount(0);
        await page.getByTestId('new-pack').click();
        await expect(page.getByTestId('new-pack-dialog')).toBeVisible();
        await axe.at(page, 'new-pack-window');
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('new-pack-dialog')).toHaveCount(0);

        // ---- a file that is no pack: the failure banner
        const chooser = page.waitForEvent('filechooser');
        await page.getByTestId('open-zip').click();
        await (await chooser).setFiles({ name: 'bad.zip', mimeType: 'application/zip', buffer: Buffer.from('not a zip') });
        await expect(page.getByTestId('failure')).toBeVisible();
        await axe.at(page, 'failure-banner');
        await page.getByTestId('failure').getByRole('button').click();

        // ---- the open pack and each kind of file in the tree
        await openPack(page);
        await axe.at(page, 'pack-open');
        for (const [name, path] of [
          ['pack-mcmeta', 'pack.mcmeta'],
          ['wagon-type', COACH],
          ['rail-style', 'assets/rwat_example/rail_models/wooden_track.json'],
          ['lang-file', 'assets/rwat_example/lang/en_us.json'],
          ['asset-file', 'assets/rwat_example/stock/coach/coach.mtl'],
        ] as const) {
          await file(page, path).click();
          await expect(file(page, path)).toHaveAttribute('aria-selected', 'true');
          await axe.at(page, `tree-${name}`);
        }
        await pickWagon(page, 'rwat_example:coach');
        await axe.at(page, 'tree-wagon-model');

        // ---- the bottom tabs, on a wagon with doors, then on the one with a cab
        for (const id of ['checks', 'objects', 'preview', 'names', 'sounds']) {
          await tab(page, id);
          await axe.at(page, `tab-${id}-coach`);
        }
        await pickWagon(page, 'rwat_example:shunter');
        for (const id of ['objects', 'preview', 'sounds']) {
          await tab(page, id);
          await axe.at(page, `tab-${id}-shunter`);
        }
        await tab(page, 'checks');

        // ---- each tool, on the wagon it fits
        await pickWagon(page, 'rwat_example:coach');
        for (const id of ['floor', 'doors']) {
          await tool(page, id);
          await axe.at(page, `tool-${id}`);
        }
        await pickWagon(page, 'rwat_example:shunter');
        for (const id of ['seats', 'lights', 'pivots']) {
          await tool(page, id);
          await axe.at(page, `tool-${id}`);
        }
        await page.locator('[data-toggle="tool"] [data-tool="select"]').click();

        // ---- the layers menu
        await page.locator('details.view3d-menu > summary').click();
        await axe.at(page, 'layers-menu');
        await page.locator('details.view3d-menu > summary').click();

        // ---- the windows over a pack
        await page.getByTestId('add-wagon').click();
        await expect(page.getByTestId('add-wagon-dialog')).toBeVisible();
        await axe.at(page, 'add-wagon-window');
        await page.keyboard.press('Escape');
        await page.getByTestId('save').click();
        await expect(page.getByTestId('save-dialog')).toBeVisible();
        await axe.at(page, 'save-window-nothing');
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('save-dialog')).toHaveCount(0);

        // ---- an edit: the save window lists it, with its difference; a reload brings the restore question
        await file(page, COACH).click();
        const mass = page.getByTestId('inspector').locator('[data-pointer="/mass_t"] input').first();
        await mass.fill('45');
        await mass.press('Enter');
        await expect(page.getByTestId('save')).toHaveAttribute('data-dirty', 'true');
        await page.getByTestId('save').click();
        const dialog = page.getByTestId('save-dialog');
        await dialog.getByRole('button', { name: lang === 'ru' ? 'Разница' : 'Difference' }).click();
        await expect(dialog.getByTestId('save-diff')).toBeVisible();
        await axe.at(page, 'save-window-changes');
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('save')).toHaveAttribute('data-session', 'saved');
        page.once('dialog', (confirm) => void confirm.accept());
        await page.reload();
        await expect(page.getByTestId('restore-dialog')).toBeVisible();
        await axe.at(page, 'restore-window');
        await page.getByTestId('restore-discard').click();
        await expect(page.getByTestId('restore-dialog')).toHaveCount(0);

        // ---- the other language: the page follows it
        const other = lang === 'en' ? 'RU' : 'EN';
        await page.locator('[data-toggle="lang"]').getByRole('button', { name: other }).click();
        await expect(page.locator('html')).toHaveAttribute('lang', other.toLowerCase());
        await axe.at(page, `empty-after-switch-to-${other.toLowerCase()}`);

        await axe.finish(`${scheme}-${lang}`);
        expect(axe.states.length).toBeGreaterThanOrEqual(30);
        expect(errors).toEqual([]);
      });
    });
  }
}
