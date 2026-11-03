/**
 * The objects tab in the browser (docs/proposals/editor.md §6.1, §3.8, M3 agent A3.3): the
 * example pack opens, a wagon is picked in the tree, its objects are listed with their
 * roles, the shunter's controls are found with the legend filter and the search, a click
 * on a row selects the object (the editor's one selection) and says why it has its role,
 * and the tab has no serious accessibility violation in either language.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js';
import { EXAMPLE_PACK as PACK } from '../../src/testing/repo.node';

const SHUNTER_MODEL = 'assets/rwat_example/wagon_models/shunter.json';

function filesOf(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => statSync(join(dir, name)).isFile())
    .map((name) => name.split(sep).join('/'))
    .sort();
}

async function packZip(): Promise<Buffer> {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
  for (const name of filesOf(PACK)) await writer.add(name, new Uint8ArrayReader(readFileSync(join(PACK, name))));
  return Buffer.from(await writer.close());
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function openObjects(page: Page): Promise<void> {
  await page.goto('./');
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('open-zip').click();
  await (await chooser).setFiles({ name: 'RwatExamplePack.zip', mimeType: 'application/zip', buffer: await packZip() });
  await expect(page.locator('[data-section="wagons"] [data-stock]')).toHaveCount(3);
  await page.getByRole('tab', { name: 'Objects' }).click();
}

async function axe(page: Page): Promise<void> {
  const serious = (await new AxeBuilder({ page }).analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test.use({ locale: 'en-US' });

test('a wagon picked in the tree is listed; the shunter\'s controls are found with the legend and the search; a click selects the object and says why', async ({ page }) => {
  const errors = watchErrors(page);
  await openObjects(page);

  const objects = page.getByTestId('objects');
  await expect(objects).toContainText('Pick a wagon');
  await page.locator(`[data-file="${SHUNTER_MODEL}"]`).click();
  await expect(objects).toHaveAttribute('data-wagon', 'rwat_example:shunter');
  const rows = page.locator('[data-testid="objects-table"] tr[data-object]');
  await expect(rows.first()).toBeVisible();
  const total = await rows.count();
  expect(total).toBeGreaterThan(30);
  await expect(page.getByTestId('objects-summary')).toHaveText(`Showing ${total} of ${total}`);
  await expect(rows.filter({ hasText: 'GUIDE_FLOOR_0' })).toContainText('Dropped: skip');

  // the legend filters by role: the controls of the locomotive
  await page.locator('.objects-chip[data-role="control"]').click();
  const controls = await rows.count();
  expect(controls).toBeGreaterThan(5);
  expect(controls).toBeLessThan(total);
  await expect(rows.locator('xpath=self::*[not(@data-role="control")]')).toHaveCount(0);
  await page.getByTestId('objects-search').fill('throttle');
  await expect(rows.filter({ hasText: 'THROTTLE_1_KNOB' })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'REVERSER_1_KNOB' })).toHaveCount(0);

  // a click on a row selects the object and the rule behind its role appears
  const knob = rows.filter({ hasText: 'THROTTLE_1_KNOB' });
  await knob.getByRole('button', { name: 'THROTTLE_1_KNOB' }).click();
  await expect(knob).toHaveAttribute('aria-current', 'true');
  const why = page.getByTestId('objects-why');
  await expect(why).toHaveAttribute('data-role', 'control');
  await expect(page.getByTestId('objects-how')).toContainText('THROTTLE_1');
  await expect(why).toContainText('Throttle');

  // another object: its marks are listed
  await page.getByTestId('objects-search').fill('');
  await page.getByRole('button', { name: 'WIDGET_1_TOGGLE_CG_FHL_OFFSET_-0.5' }).click();
  await expect(page.getByTestId('objects-marks').locator('li')).toHaveCount(3);
  await expect(page.getByTestId('objects-marks')).toContainText('CG_FHL');

  await axe(page);
  expect(errors).toEqual([]);
});

test('the tab speaks Russian from the schema\'s own words, and sorts', async ({ page }) => {
  await openObjects(page);
  await page.locator(`[data-file="${SHUNTER_MODEL}"]`).click();
  await expect(page.getByTestId('objects')).toHaveAttribute('data-wagon', 'rwat_example:shunter');
  await page.locator('[data-toggle="lang"] [data-value="ru"]').click();
  await expect(page.getByRole('tab', { name: 'Объекты' })).toBeVisible();
  await page.getByRole('button', { name: /^Сортировать: Имя/ }).click();
  const names = await page.locator('[data-testid="objects-table"] tr[data-object]').evaluateAll((trs) => trs.map((tr) => (tr as HTMLElement).dataset.object ?? ''));
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })));
  await page.getByRole('button', { name: 'GUIDE_FLOOR_0' }).click();
  await expect(page.getByTestId('objects-how')).toContainText('«GUIDE_»');
  await expect(page.getByTestId('objects-why')).toContainText('Выбрасывается при загрузке');
  await axe(page);
});
