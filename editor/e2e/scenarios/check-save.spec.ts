/**
 * Scenario 2.5 of docs/proposals/editor.md, short, on the example pack: a field broken —
 * the checks find it, at its field, in the interface's words; Save says the pack can be
 * saved with the error all the same; the field mended — the finding goes; Save lists the
 * one changed file with its lines and its difference — the one line, the number written as
 * the file writes its numbers —, and the zip it downloads has the edit and every other file
 * byte for byte.
 */

import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { axe, checksTab, disk, field, NS, openZip, PACK_FILES, packFiles, pickFile, saveZip, screenshot, start, unzip, watchErrors, zipOf } from './steps';

test.use({ locale: 'en-US' });

const COACH = `data/${NS}/wagon_types/coach.json`;

test('2.5 a field broken is found; mended, the finding goes; Save lists the changed file and the zip has it', async ({ page }) => {
  const errors = watchErrors(page);
  await start(page);
  await openZip(page, await zipOf(packFiles()), 'RwatExamplePack.zip');
  const checks = await checksTab(page);
  await expect(checks.getByTestId('checks-summary')).toHaveText('No findings.');

  // 1. broken: a parking brake that pulls the wrong way
  await pickFile(page, COACH);
  const parking = field(page, '/brakes/parking_kn').locator('input');
  await parking.fill('-18');
  await parking.press('Enter');
  const finding = checks.locator('.finding');
  await expect(finding).toHaveCount(1);
  await expect(finding).toHaveAttribute('data-source', 'schema');
  await expect(finding).toHaveAttribute('data-code', 'schema.minimum');
  await expect(finding).toHaveClass(/finding-error/);
  await expect(finding.locator('.finding-where')).toHaveText(`${COACH} /brakes/parking_kn`);
  await expect(parking).toHaveAttribute('aria-invalid', 'true');
  await screenshot(page, 'scenario-2-5-finding');

  // Save says the pack can be saved with it all the same
  await page.getByTestId('save').click();
  const dialog = page.getByTestId('save-dialog');
  await expect(dialog.getByTestId('save-errors')).toHaveAttribute('data-count', '1');
  await expect(dialog.getByTestId('save-errors')).toContainText('You can save');
  await dialog.getByTestId('save-close').click();
  await expect(dialog).toHaveCount(0);

  // 2. mended: the finding goes
  await finding.click();
  await expect(parking).toBeFocused();
  await parking.fill('20');
  await parking.press('Enter');
  await expect(checks.getByTestId('checks-summary')).toHaveText('No findings.');
  await expect(parking).not.toHaveAttribute('aria-invalid', 'true');

  // 3. Save: the one changed file, its lines, its difference
  await page.getByTestId('save').click();
  await expect(dialog.getByTestId('save-errors')).toHaveAttribute('data-count', '0');
  await expect(dialog.locator('[data-path]')).toHaveCount(1);
  await expect(dialog.locator(`[data-path="${COACH}"]`)).toHaveAttribute('data-status', 'changed');
  await expect(dialog.getByTestId('save-lines')).toHaveText('+1 −1');
  await dialog.getByRole('button', { name: 'Difference' }).click();
  await expect(dialog.getByTestId('save-diff').locator('[data-kind="add"]')).toHaveText([/^\+ {5}"parking_kn": 20\.0\s*$/]);
  await axe(page);
  await screenshot(page, 'scenario-2-5-save');

  // 4. the zip: the edit, and the rest byte for byte
  const files = await unzip(await saveZip(page, 'RwatExamplePack.zip'));
  expect([...files.keys()]).toEqual(PACK_FILES);
  for (const [path, bytes] of files) {
    const original = readFileSync(disk(path));
    if (path !== COACH) expect(bytes.equals(original), path).toBe(true);
    else expect(bytes.toString('utf8').split('\n').filter((line, i) => line !== original.toString('utf8').split('\n')[i])).toEqual(['    "parking_kn": 20.0']);
  }
  expect(errors).toEqual([]);
});
