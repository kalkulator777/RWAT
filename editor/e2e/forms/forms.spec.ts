/**
 * The gate of M2 for the forms (docs/proposals/editor.md §7, M2; §2.1 steps 1–2, §3.7):
 * a new pack from the wizard, a wagon added with its OBJ, the non-spatial fields of its
 * type and model filled in through the inspector, names in both languages, an edit undone
 * and redone, a finding said in the interface language; the zip saved and opened again
 * shows the same values. Switching the language changes every text of the forms, the
 * schema's descriptions included; an empty `brakes.train_kn` shows the engine's number.
 * axe finds nothing serious or critical with the forms open. Screenshots of the forms go
 * to the test's output.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { BlobReader, TextWriter, ZipReader } from '@zip.js/zip.js';
import { REPO_SCHEMA_DIR } from '../../src/testing/repo.node';

type SchemaFile = { properties: Record<string, { description: string; 'x-description-ru': string }> };
const typeSchema = JSON.parse(readFileSync(join(REPO_SCHEMA_DIR, 'wagon_type.schema.json'), 'utf8')) as SchemaFile;

const TYPE = 'data/my_trains/wagon_types/coach.json';
const MODEL = 'assets/my_trains/wagon_models/coach.json';
const OBJ = 'o BODY\nv -10 0 -1.5\nv 10 0 -1.5\nv 10 3 1.5\nf 1 2 3\n';

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function screenshot(page: Page, name: string, target?: Locator): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const path = test.info().outputPath(`${name}.png`);
  await (target ?? page).screenshot({ path });
  await test.info().attach(name, { path, contentType: 'image/png' });
}

async function axe(page: Page): Promise<void> {
  const serious = (await new AxeBuilder({ page }).analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

/**
 * The findings but the model's: the wizard's wagon is a bare OBJ with no material, so the
 * model check (checks/model) says it draws nothing — true, and no business of the forms.
 */
function formFindings(page: Page): Locator {
  return page.getByTestId('checks').locator('.finding:not([data-source="model"])');
}

/** The field of the inspector's form at a pointer. */
function field(page: Page, at: string): Locator {
  return page.getByTestId('inspector').locator(`[data-pointer="${at}"]`);
}

/** Types into a box and commits it with Enter, as an author does. */
async function commit(box: Locator, text: string): Promise<void> {
  await box.fill(text);
  await box.press('Enter');
}

async function typeInto(page: Page, at: string, text: string): Promise<void> {
  await commit(field(page, at).locator('input').first(), text);
}

test.use({ locale: 'en-US' });

test('a new pack, a wagon, its forms filled in, saved as a zip and opened again with the same values', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await page.goto('./');
  await expect(page.locator('.checks')).toHaveAttribute('data-schema', 'loaded');

  // --- the wizard: a new pack
  await page.getByTestId('new-pack').click();
  const newPack = page.getByTestId('new-pack-dialog');
  await expect(newPack).toBeVisible();
  await newPack.getByLabel('Pack name').fill('MyTrains');
  await newPack.getByLabel('Namespace').fill('my_trains');
  await newPack.getByLabel('Authors').fill('Me');
  await newPack.getByLabel('License').fill('CC0-1.0');
  await newPack.getByLabel('Description').fill('A test pack');
  await screenshot(page, 'wizard-new-pack');
  await newPack.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByTestId('pack-status')).toContainText('MyTrains');
  await expect(page.getByTestId('inspector')).toHaveAttribute('data-kind', 'pack_mcmeta_rwat');
  await expect(field(page, '/rwat/license').locator('input')).toHaveValue('CC0-1.0');
  await expect(field(page, '/rwat/format').locator('input')).toHaveValue('1');

  // --- the wizard: a wagon with its OBJ
  await page.getByTestId('add-wagon').click();
  const addWagon = page.getByTestId('add-wagon-dialog');
  await expect(addWagon.getByLabel('Namespace')).toHaveValue('my_trains');
  await addWagon.getByLabel('Type id').fill('coach');
  await addWagon.locator('input[type="file"]').setInputFiles({ name: 'coach.obj', mimeType: 'text/plain', buffer: Buffer.from(OBJ) });
  await addWagon.locator('input[name="length"]').fill('20');
  await addWagon.locator('input[name="mass_t"]').fill('40');
  await addWagon.locator('input[name="bogie_front"]').fill('7');
  await addWagon.locator('input[name="bogie_rear"]').fill('-7');
  await addWagon.locator('input[name="name_en_us"]').fill('Test coach');
  await addWagon.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(addWagon).toHaveCount(0);
  await expect(page.locator('[data-section="wagons"] [data-stock="my_trains:coach"]')).toBeVisible();
  await expect(page.getByTestId('inspector').locator('.inspector-title')).toHaveText('Wagon type my_trains:coach');
  await expect(formFindings(page)).toHaveCount(0);

  // --- an empty brakes.train_kn shows the engine's number, and follows the brake system and the mass
  const train = field(page, '/brakes/train_kn');
  await expect(train.locator('input')).toHaveValue('');
  await expect(train.locator('input')).toHaveAttribute('placeholder', '40');
  await expect(train.locator('.field-default')).toHaveText('If left out, the engine takes 40 kN (kn_per_t(system) · mass_t)');
  await field(page, '/brakes/system').locator('select').selectOption('ep');
  await expect(train.locator('input')).toHaveAttribute('placeholder', '44');

  // --- the type's other non-spatial fields
  await typeInto(page, '/max_speed_kmh', '120');
  await typeInto(page, '/resistance/c', '1.1');
  await typeInto(page, '/brakes/parking_kn', '18');
  await typeInto(page, '/couplers/front', '-0.05');
  await field(page, '/aliases').getByLabel('New item of aliases').fill('my_trains:old_coach');
  await field(page, '/aliases').getByLabel('New item of aliases').press('Enter');
  await field(page, '/cab').getByRole('button', { name: 'Add the section cab' }).click();
  await expect(field(page, '/brakes/independent_kn').locator('input')).toHaveAttribute('placeholder', '28');
  await expect(field(page, '/doors').locator('.field-spatial')).toContainText('edited in the 3D view');
  await page.getByTestId('inspector').getByLabel('wagon.my_trains.coach, ru_ru').fill('Тестовый вагон');
  await page.getByTestId('inspector').getByLabel('wagon.my_trains.coach, ru_ru').press('Enter');

  // --- undo and redo of one edit
  await expect(field(page, '/couplers/front').locator('input')).toHaveValue('-0.05');
  await typeInto(page, '/couplers/rear', '-0.05');
  await page.getByTestId('undo').click();
  await expect(field(page, '/couplers/rear').locator('input')).toHaveValue('');
  await page.getByTestId('redo').click();
  await expect(field(page, '/couplers/rear').locator('input')).toHaveValue('-0.05');

  // --- a finding, said in the interface language, brings its field into view
  await typeInto(page, '/bogies/0', '11');
  const finding = formFindings(page);
  await expect(finding).toHaveCount(1);
  await expect(finding.locator('.finding-text')).toHaveText('“bogies[0]” = 11 is outside the body: a pivot must lie within ±length/2 = ±10');
  await expect(field(page, '/bogies').locator('.field-list-item input').first()).toHaveAttribute('aria-invalid', 'true');
  await finding.click();
  await expect(field(page, '/bogies/0').locator('input')).toBeFocused();
  await typeInto(page, '/bogies/0', '7');
  await expect(formFindings(page)).toHaveCount(0);
  await screenshot(page, 'form-type-en');

  // --- the model's non-spatial fields
  await page.locator(`[data-stock="my_trains:coach"] [data-file="${MODEL}"]`).click();
  await expect(page.getByTestId('inspector').locator('.inspector-title')).toHaveText('Wagon model my_trains:coach');
  await expect(field(page, '/obj').locator('input')).toHaveValue('stock/coach/coach.obj');
  await typeInto(page, '/sway', '0.8');
  await field(page, '/skip').getByLabel('New item of skip').fill('GUIDE_');
  await field(page, '/skip').getByLabel('New item of skip').press('Enter');
  await field(page, '/liveries').getByLabel('New key of liveries', { exact: true }).fill('blue');
  await field(page, '/liveries').getByLabel('Value of the new key of liveries', { exact: true }).fill('l_blue');
  await field(page, '/liveries').getByRole('button', { name: 'Add', exact: true }).click();
  await field(page, '/sounds/wheels').getByLabel('string', { exact: true }).check();
  await commit(field(page, '/sounds/wheels').getByLabel('wheels', { exact: true }), 'minecraft:entity.minecart.riding');
  await typeInto(page, '/sounds/clack', 'minecraft:block.chain.step');
  await field(page, '/sounds/horn').getByLabel(/^object/).check();
  await typeInto(page, '/sounds/horn/main', 'minecraft:item.goat_horn.sound.0');
  await commit(field(page, '/sounds/horn/pitch').getByLabel('pitch[0]', { exact: true }), '0.8');
  await commit(field(page, '/sounds/horn/pitch').getByLabel('pitch[1]', { exact: true }), '0.9');
  await expect(formFindings(page)).toHaveCount(0);
  await screenshot(page, 'form-model-en');

  // --- the names tab
  await page.getByRole('tab', { name: 'Names' }).click();
  const names = page.getByTestId('names');
  await expect(names.getByLabel('wagon.my_trains.coach, en_us')).toHaveValue('Test coach');
  await expect(names.getByLabel('wagon.my_trains.coach, ru_ru')).toHaveValue('Тестовый вагон');
  await screenshot(page, 'names-en', page.getByRole('region', { name: 'Bottom tabs' }));
  await axe(page);

  // --- save the zip
  const download = page.waitForEvent('download');
  await page.getByTestId('save').click();
  await page.getByTestId('save-zip').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('MyTrains.zip');
  const zip = readFileSync(await file.path());
  const entries = await new ZipReader(new BlobReader(new Blob([new Uint8Array(zip)]))).getEntries();
  const texts = new Map<string, string>();
  for (const entry of entries) if (!entry.directory) texts.set(entry.filename, await entry.getData(new TextWriter()));
  expect([...texts.keys()]).toEqual([
    'assets/my_trains/lang/en_us.json',
    'assets/my_trains/lang/ru_ru.json',
    'assets/my_trains/stock/coach/coach.obj',
    MODEL,
    TYPE,
    'pack.mcmeta',
  ]);
  expect(JSON.parse(texts.get(TYPE) as string)).toEqual({
    length: 20,
    bogies: [7, -7],
    mass_t: 40,
    brakes: { system: 'ep', parking_kn: 18 },
    max_speed_kmh: 120,
    resistance: { c: 1.1 },
    couplers: { front: -0.05, rear: -0.05 },
    aliases: ['my_trains:old_coach'],
    cab: {},
  });
  expect(JSON.parse(texts.get(MODEL) as string)).toEqual({
    obj: 'stock/coach/coach.obj',
    sway: 0.8,
    skip: ['GUIDE_'],
    liveries: { blue: 'l_blue' },
    sounds: {
      wheels: 'minecraft:entity.minecart.riding',
      clack: 'minecraft:block.chain.step',
      horn: { main: 'minecraft:item.goat_horn.sound.0', pitch: [0.8, 0.9] },
    },
  });
  expect(texts.get('assets/my_trains/stock/coach/coach.obj')).toBe(OBJ);

  // --- open the zip again: the same values in the forms
  await page.reload();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('open-zip').click();
  await (await chooser).setFiles({ name: 'MyTrains.zip', mimeType: 'application/zip', buffer: zip });
  await expect(page.getByTestId('pack-status')).toHaveAttribute('data-kind', 'zip');
  await expect(formFindings(page)).toHaveCount(0);
  await page.locator(`[data-stock="my_trains:coach"] [data-file="${TYPE}"]`).click();
  await expect(field(page, '/max_speed_kmh').locator('input')).toHaveValue('120');
  await expect(field(page, '/resistance/c').locator('input')).toHaveValue('1.1');
  await expect(field(page, '/brakes/system').locator('select option:checked')).toHaveText('ep');
  await expect(field(page, '/brakes/parking_kn').locator('input')).toHaveValue('18');
  await expect(field(page, '/brakes/train_kn').locator('input')).toHaveAttribute('placeholder', '44');
  await expect(field(page, '/couplers/front').locator('input')).toHaveValue('-0.05');
  await expect(field(page, '/aliases').locator('.field-list-item input').first()).toHaveValue('my_trains:old_coach');
  await expect(field(page, '/cab').locator('.field-object-body')).toHaveAttribute('data-present', 'true');
  await expect(page.getByTestId('inspector').getByLabel('wagon.my_trains.coach, ru_ru')).toHaveValue('Тестовый вагон');
  await page.locator(`[data-stock="my_trains:coach"] [data-file="${MODEL}"]`).click();
  await expect(field(page, '/sway').locator('input')).toHaveValue('0.8');
  await expect(field(page, '/liveries/blue').locator('input')).toHaveValue('l_blue');
  await expect(field(page, '/sounds/wheels').getByLabel('string', { exact: true })).toBeChecked();
  await expect(field(page, '/sounds/wheels').getByLabel('wheels', { exact: true })).toHaveValue('minecraft:entity.minecart.riding');
  await expect(field(page, '/sounds/horn/main').locator('input')).toHaveValue('minecraft:item.goat_horn.sound.0');
  await expect(field(page, '/sounds/horn/pitch').getByLabel('pitch[1]', { exact: true })).toHaveValue('0.9');
  expect(errors).toEqual([]);
});

test('switching the language changes every text of the forms, the descriptions from the schema included', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  await expect(page.locator('.checks')).toHaveAttribute('data-schema', 'loaded');
  await page.getByTestId('new-pack').click();
  const newPack = page.getByTestId('new-pack-dialog');
  await newPack.getByLabel('Pack name').fill('Lang');
  await newPack.getByLabel('Namespace').fill('lang');
  await newPack.getByRole('button', { name: 'Create' }).click();
  await page.getByTestId('add-wagon').click();
  const addWagon = page.getByTestId('add-wagon-dialog');
  await addWagon.getByLabel('Type id').fill('coach');
  await addWagon.locator('input[type="file"]').setInputFiles({ name: 'coach.obj', mimeType: 'text/plain', buffer: Buffer.from(OBJ) });
  for (const [name, value] of [['length', '20'], ['mass_t', '42'], ['bogie_front', '7'], ['bogie_rear', '-7']] as const) {
    await addWagon.locator(`input[name="${name}"]`).fill(value);
  }
  await addWagon.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByTestId('inspector')).toHaveAttribute('data-kind', 'wagon_type');
  await field(page, '/brakes/dynamic_kn').locator('input').fill('5');
  await field(page, '/brakes/dynamic_kn').locator('input').press('Enter');
  await expect(page.getByTestId('checks').locator('.finding[data-source="model"]')).toHaveCount(1); // the bare OBJ draws nothing
  await expect(formFindings(page)).toHaveCount(1);

  const inspector = page.getByTestId('inspector');
  const texts = () =>
    inspector.evaluate((root) => ({
      help: [...root.querySelectorAll('.form-help, .field-help')].map((el) => el.textContent ?? ''),
      notes: [...root.querySelectorAll('.field-default, .field-status-note, .field-spatial, .field-problem, .field-unit, .badge-status')].map((el) => el.textContent ?? ''),
      buttons: [...root.querySelectorAll('button')].map((el) => el.getAttribute('aria-label') ?? el.textContent ?? ''),
      title: root.querySelector('.inspector-title')?.textContent ?? '',
    }));
  const english = await texts();
  await expect(field(page, '/mass_t').locator('.field-help')).toHaveText(typeSchema.properties.mass_t?.description as string);
  expect(english.help.length).toBeGreaterThan(20);
  await axe(page);

  await page.getByRole('group', { name: 'Interface language' }).getByRole('button', { name: 'RU' }).click();
  await expect(field(page, '/mass_t').locator('.field-help')).toHaveText(typeSchema.properties.mass_t?.['x-description-ru'] as string);
  const russian = await texts();
  expect(russian.title).toBe('Тип вагона lang:coach');
  expect(russian.help).toHaveLength(english.help.length);
  russian.help.forEach((text, i) => {
    expect(text, `description ${i}`).not.toBe(english.help[i]);
    expect(text, `description ${i}`).toMatch(/[а-яё]/i);
  });
  expect(russian.notes).toHaveLength(english.notes.length);
  // defaults, statuses, findings, units and badges: the units are the schema's too (pack-layout.json)
  russian.notes.forEach((text, i) => expect(text, `note ${i}: ${english.notes[i]}`).not.toBe(english.notes[i]));
  russian.buttons.forEach((text, i) => expect(text, `button ${i}`).not.toBe(english.buttons[i]));
  await expect(formFindings(page).locator('.finding-text')).toHaveText(/^зарезервировано — в игре ничего не меняет: .*[а-я]/);
  await screenshot(page, 'form-type-ru');
  await axe(page);
  expect(errors).toEqual([]);
});
