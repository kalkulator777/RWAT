/**
 * The help in the built site (docs/proposals/editor.md §6.1, M5, A5.3): the top bar's
 * «Help» opens it at «Where to begin» in the interface's language; a link opens its topic
 * in place, the list of topics too, from the keyboard as well; Escape closes it; axe finds
 * nothing serious or critical in it, in Russian and in English. Screenshots of each go to
 * the test's output, and to `RWAT_HELP_SHOTS` when that names a folder.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const folder = process.env.RWAT_HELP_SHOTS;
  if (folder !== undefined && folder !== '') mkdirSync(folder, { recursive: true });
  const path = folder !== undefined && folder !== '' ? join(folder, `${name}.png`) : test.info().outputPath(`${name}.png`);
  await page.getByTestId('help-dialog').screenshot({ path });
  await test.info().attach(name, { path, contentType: 'image/png' });
}

async function axe(page: Page): Promise<void> {
  const serious = (await new AxeBuilder({ page }).include('[data-testid="help-dialog"]').analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

for (const { locale, lang, button, start, scenario, keys, close } of [
  { locale: 'ru-RU', lang: 'ru', button: 'Справка', start: 'С чего начать', scenario: 'Новый пак с нуля', keys: 'Клавиши', close: 'Закрыть' },
  { locale: 'en-US', lang: 'en', button: 'Help', start: 'Where to begin', scenario: 'A new pack from scratch', keys: 'Keys', close: 'Close' },
]) {
  test.describe(`in ${locale}`, () => {
    test.use({ locale, viewport: { width: 1440, height: 900 }, colorScheme: 'light' });

    test('the help opens at its start, goes to a topic by a link and by the list, and closes', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto('./');
      await page.getByRole('button', { name: button, exact: true }).click();
      const dialog = page.getByTestId('help-dialog');
      const topic = page.getByTestId('help-topic');
      await expect(dialog).toBeVisible();
      await expect(topic).toHaveAttribute('data-topic', 'start');
      await expect(topic).toHaveAttribute('lang', lang);
      await expect(topic.locator('h3')).toHaveText(start);
      await shot(page, `help-start-${lang}`);
      await axe(page);

      await topic.locator('[data-topic-link="new-pack"]').click();
      await expect(topic).toHaveAttribute('data-topic', 'new-pack');
      await expect(topic.locator('h3')).toHaveText(scenario);
      await expect(topic.locator('h3')).toBeFocused();
      await shot(page, `help-new-pack-${lang}`);

      // the list of topics from the keyboard
      const keysButton = dialog.locator('nav button[data-topic="keys"]');
      await keysButton.focus();
      await page.keyboard.press('Enter');
      await expect(topic).toHaveAttribute('data-topic', 'keys');
      await expect(topic.locator('h3')).toHaveText(keys);
      await expect(keysButton).toHaveAttribute('aria-current', 'page');
      await shot(page, `help-keys-${lang}`);
      await axe(page);

      await dialog.locator('nav button[data-topic="limits"]').click();
      await shot(page, `help-limits-${lang}`);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await page.getByTestId('help').click();
      await page.getByRole('button', { name: close, exact: true }).click();
      await expect(page.getByTestId('help-dialog')).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  });
}
