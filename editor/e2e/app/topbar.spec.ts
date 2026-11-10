/**
 * The shell's top bar (docs/proposals/editor.md §6.1) at 1280 px, the narrowest common
 * laptop screen: with a pack open, in Russian and in English, every button and toggle is
 * on one line; the pack status gives way, cut short with its whole text on hover; undo and
 * redo are arrows named by their label. Narrower, whole groups go to the next line. A
 * screenshot of the bar of each language goes to the test's output.
 */

import { expect, test, type Page } from '@playwright/test';

/** Opens a new pack from the wizard, so the status is as long as it gets for a zip. */
async function newPack(page: Page): Promise<void> {
  await page.goto('./');
  await page.getByTestId('new-pack').click();
  const dialog = page.getByTestId('new-pack-dialog');
  await dialog.locator('input').nth(0).fill('MyTrains');
  await dialog.locator('input').nth(1).fill('my_trains');
  await dialog.locator('button[type="submit"]').click();
  await expect(page.getByTestId('pack-status')).toContainText('MyTrains');
  await page.evaluate(() => document.fonts.ready);
}

/** The distinct tops of the bar's buttons, rounded: one value is one line. */
async function lines(page: Page): Promise<number[]> {
  const tops = await page.locator('.topbar button').evaluateAll((buttons) => buttons.map((b) => Math.round(b.getBoundingClientRect().top / 8)));
  return [...new Set(tops)];
}

for (const [locale, undo, redo] of [
  ['ru-RU', 'Отменить', 'Повторить'],
  ['en-US', 'Undo', 'Redo'],
] as const) {
  test.describe(`in ${locale}`, () => {
    test.use({ locale });

    test('the top bar keeps to one line at 1280 px, the pack status giving way', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await newPack(page);
      expect(await lines(page)).toHaveLength(1);
      const status = page.getByTestId('pack-status');
      await expect(status).toHaveAttribute('title', (await status.textContent()) ?? '');
      await expect(page.getByRole('button', { name: undo, exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: redo, exact: true })).toBeVisible();
      const bar = page.locator('.topbar');
      const path = test.info().outputPath(`topbar-${locale}-1280.png`);
      await bar.screenshot({ path });
      await test.info().attach(`topbar-${locale}-1280`, { path, contentType: 'image/png' });
    });

    test('narrower, whole groups go to the next line, not single buttons', async ({ page }) => {
      await page.setViewportSize({ width: 1024, height: 800 });
      await newPack(page);
      const groups = await page.locator('.topbar .file-actions, .topbar .toggle').evaluateAll((elements) =>
        elements.map((e) => new Set([...e.querySelectorAll('button')].map((b) => Math.round(b.getBoundingClientRect().top))).size),
      );
      expect(groups.every((count) => count === 1)).toBe(true);
    });
  });
}
