/**
 * Smoke test of the built site: the shell opens with the layout of
 * docs/proposals/editor.md §6.1 in the browser's language, the language switches and is
 * remembered, the layout is resized from the keyboard and remembered, the site serves
 * the schema at its `$id` and opens offline after the first visit (§5.5); axe finds nothing
 * serious or critical in the empty shell (§6.3). Each language
 * leaves a screenshot of the shell in the test's output (test-results/), attached to the
 * report; reference screenshots to compare against are e2e/visual/'s, made by CI (§5.2).
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** Collects console errors and uncaught exceptions of the page. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/** Waits for the editor's own fonts and saves a screenshot of the window into the test's output. */
async function screenshot(page: Page, name: string): Promise<void> {
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((font) => font.status === 'loaded').map((font) => font.family.replaceAll('"', ''));
  });
  expect(loaded).toContain('Inter Variable');
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path });
  await test.info().attach(name, { path, contentType: 'image/png' });
}

async function expectLayout(page: Page, names: { tree: string; view: string; inspector: string; bottom: string }) {
  const box = async (role: 'complementary' | 'main' | 'region', name: string) => {
    const region = page.getByRole(role, { name, exact: true });
    await expect(region).toBeVisible();
    const bounds = await region.boundingBox();
    if (!bounds) throw new Error(`${name} has no box`);
    return bounds;
  };
  const tree = await box('complementary', names.tree);
  const view = await box('main', names.view);
  const inspector = await box('complementary', names.inspector);
  const bottom = await box('region', names.bottom);
  // Tree | view | inspector side by side, the bottom tabs under the view.
  expect(tree.x + tree.width).toBeLessThanOrEqual(view.x);
  expect(view.x + view.width).toBeLessThanOrEqual(inspector.x);
  expect(view.y + view.height).toBeLessThanOrEqual(bottom.y);
  expect(bottom.x).toBeCloseTo(view.x, 0);
  expect(bottom.width).toBeCloseTo(view.width, 0);
  await expect(page.getByRole('separator')).toHaveCount(3);
}

test.describe('in a Russian browser', () => {
  test.use({ locale: 'ru-RU' });

  test('the shell opens in Russian with the layout of §6.1', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('./');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
    await expect(page).toHaveTitle('Редактор паков RWAT');
    await expect(page.getByRole('banner')).toContainText('Пак не открыт');
    await expectLayout(page, { tree: 'Пак', view: 'Вид', inspector: 'Инспектор', bottom: 'Нижние вкладки' });
    await expect(page.getByRole('complementary', { name: 'Пак' })).toHaveText('Откройте пак или создайте новый.');
    await expect(page.getByRole('button', { name: 'Пак RWAT' })).toHaveAttribute('aria-pressed', 'true');
    await screenshot(page, 'shell-ru');
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test.describe('in an English browser', () => {
  test.use({ locale: 'en-US' });

  test('the shell opens in English, switches to Russian and remembers it', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('./');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page).toHaveTitle('RWAT pack editor');
    await expectLayout(page, { tree: 'Pack', view: 'View', inspector: 'Inspector', bottom: 'Bottom tabs' });
    await screenshot(page, 'shell-en');

    const languages = page.getByRole('group', { name: 'Interface language' });
    await languages.getByRole('button', { name: 'RU' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
    await expect(page).toHaveTitle('Редактор паков RWAT');
    await expect(page.getByRole('main', { name: 'Вид' }).locator('.view3d-message')).toHaveText('Модель не открыта.');
    await expect(page.getByRole('group', { name: 'Язык интерфейса' }).getByRole('button', { name: 'RU' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
    await expect(page.getByRole('complementary', { name: 'Инспектор' })).toHaveText('Ничего не выделено.');
    expect(errors).toEqual([]);
  });

  test('the areas resize from the keyboard and keep their size after a reload', async ({ page }) => {
    await page.goto('./');
    const tree = page.getByRole('complementary', { name: 'Pack', exact: true });
    const before = (await tree.boundingBox())?.width ?? 0;
    const splitter = page.getByRole('separator', { name: 'Pack tree width' });
    await splitter.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(splitter).toHaveAttribute('aria-valuenow', '312');
    expect((await tree.boundingBox())?.width).toBeCloseTo(before + 32, 0);

    await page.reload();
    await expect(page.getByRole('separator', { name: 'Pack tree width' })).toHaveAttribute('aria-valuenow', '312');
    expect((await tree.boundingBox())?.width).toBeCloseTo(before + 32, 0);
  });

  test('the site serves the schema at its $id and opens offline after the first visit', async ({ page, context }) => {
    await page.goto('./');
    const schemaId = () =>
      page.evaluate(async () => {
        const response = await fetch('schema/wagon_type.schema.json');
        return ((await response.json()) as { $id: string }).$id;
      });
    expect(await schemaId()).toBe('https://kalkulator777.github.io/RWAT/schema/wagon_type.schema.json');

    // The service worker has installed (and precached the shell) once it is ready.
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    expect(scope).toBe(new URL('./', page.url()).href);

    await context.setOffline(true);
    await page.reload();
    await expect(page).toHaveTitle('RWAT pack editor');
    await expect(page.getByRole('main', { name: 'View' }).locator('.view3d-message')).toHaveText('No model open.');
    expect(await schemaId()).toBe('https://kalkulator777.github.io/RWAT/schema/wagon_type.schema.json');
    await context.setOffline(false);
  });
});
