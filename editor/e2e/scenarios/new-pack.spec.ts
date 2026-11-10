/**
 * Scenario 2.1 of docs/proposals/editor.md, short, on the example pack's files: a new pack
 * from the wizard; the textures the models share added to their folder; a wagon added with
 * its OBJ, MTL and textures — the example gondola —, the model shown and read without a
 * finding; two fields of its type filled in; Save lists the new files and downloads the
 * zip; the zip opened again has no findings, the same values, and every model it has reads
 * without an error.
 */

import { expect, test } from '@playwright/test';
import { addFiles, addWagon, axe, checksTab, diskFolder, field, newPack, NS, openZip, pickFile, saveZip, screenshot, start, typeInto, unzip, watchErrors } from './steps';

test.use({ locale: 'en-US' });

const TYPE = `data/${NS}/wagon_types/gondola.json`;
const MODEL = `assets/${NS}/wagon_models/gondola.json`;

test('2.1 a new pack: a wagon from its OBJ, two fields, saved as a zip that opens again without findings', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await start(page);

  // 1. «New pack»: the name, the namespace, the rwat block
  await newPack(page, { name: 'MyPack', namespace: NS, title: 'My pack', authors: 'Me', license: 'CC0-1.0', description: 'A gondola' });
  await expect(page.getByTestId('inspector')).toHaveAttribute('data-kind', 'pack_mcmeta_rwat');
  await expect(field(page, '/rwat/name').locator('input')).toHaveValue('My pack');

  // 2. the textures the model shares with others, then the wagon with its own files
  await addFiles(page, `assets/${NS}/stock/common`, diskFolder(`assets/${NS}/stock/common`));
  await addWagon(page, {
    id: 'gondola',
    folder: 'stock/gondola',
    files: diskFolder(`assets/${NS}/stock/gondola`),
    length: '10',
    mass: '22',
    bogies: ['2.75', '-2.75'],
    names: { en_us: 'Example two-axle gondola', ru_ru: 'Двухосный полувагон (пример)' },
  });
  await expect(page.locator(`[data-section="wagons"] [data-stock="${NS}:gondola"]`)).toBeVisible();
  // 3. the view shows the model, read without a finding
  await expect(page.getByTestId('view3d')).toHaveAttribute('data-model', `${NS}:gondola`, { timeout: 15_000 });

  // 4. the type's form: two fields
  await expect(page.getByTestId('inspector')).toHaveAttribute('data-file', TYPE);
  await typeInto(page, '/max_speed_kmh', '90');
  await field(page, '/brakes/system').locator('select').selectOption('freight');
  await expect(field(page, '/brakes/train_kn').locator('input')).toHaveAttribute('placeholder', '13.2');
  const checks = await checksTab(page);
  await expect(checks.getByTestId('checks-summary')).toHaveText('No findings.');
  await screenshot(page, 'scenario-2-1-gondola');

  // 6. «Save»: the new files listed, a zip downloaded
  await page.getByTestId('save').click();
  const dialog = page.getByTestId('save-dialog');
  await expect(dialog.getByTestId('save-where')).toHaveAttribute('data-target', 'zip');
  await expect(dialog.locator(`[data-path="${TYPE}"]`)).toHaveAttribute('data-status', 'new');
  await expect(dialog.locator(`[data-path="${MODEL}"]`)).toHaveAttribute('data-status', 'new');
  await axe(page);
  const zip = await saveZip(page, 'MyPack.zip');
  const files = await unzip(zip);
  expect([...files.keys()].filter((path) => !path.includes('/stock/'))).toEqual([`assets/${NS}/lang/en_us.json`, `assets/${NS}/lang/ru_ru.json`, MODEL, TYPE, 'pack.mcmeta']);
  expect(JSON.parse(files.get(TYPE)?.toString('utf8') ?? '')).toEqual({ length: 10, bogies: [2.75, -2.75], mass_t: 22, max_speed_kmh: 90, brakes: { system: 'freight' } });

  // the zip opened again: no findings, the same values, every model read without an error
  await page.reload();
  await expect(page.getByTestId('restore-dialog')).toHaveCount(0);
  await openZip(page, zip, 'MyPack.zip');
  await expect((await checksTab(page)).getByTestId('checks-summary')).toHaveText('No findings.');
  await pickFile(page, TYPE);
  await expect(field(page, '/max_speed_kmh').locator('input')).toHaveValue('90');
  await expect(field(page, '/brakes/system').locator('select option:checked')).toHaveText('freight');
  await page.getByTestId('check-models').click();
  await expect(page.getByTestId('check-models-bar')).toHaveAttribute('data-status', 'done', { timeout: 30_000 });
  await expect(page.getByTestId('check-models-status')).toHaveText('Models checked: 1; errors: 0, warnings: 0.');
  expect(errors).toEqual([]);
});
