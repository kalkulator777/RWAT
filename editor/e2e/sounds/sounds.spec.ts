/**
 * The sounds tab in the browser (docs/proposals/editor.md §2.4 item 4, M5 agent A5.1): the
 * shunter's sounds are listed by role with what the engine makes of each; a range typed
 * into its field changes the engine's reading and undo takes it back; a pack file chosen
 * for a sound is played through WebAudio (a tone the test makes, no foreign sound files in
 * the repository), a loop follows its slider and stops; a door key that names no door
 * brings a finding up in the checks and in the tab, and removing it takes it away.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js';
import { EXAMPLE_PACK } from '../../src/testing/repo.node';
import { filesOf, openPack, pickWagon, watchErrors } from '../examplePack';

const TONE = 'assets/rwat_example/sounds/tone.ogg';

test.use({ locale: 'en-US' });

/** A short sine tone as a WAV file: the browser decodes it by its content, whatever the file is called. */
function tone(): Buffer {
  const rate = 8000;
  const samples = 1600;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + samples * 2, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), 44 + i * 2);
  return wav;
}

/** The example pack as a zip, with the tone among its files. */
async function packWithTone(): Promise<Buffer> {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
  for (const name of filesOf(EXAMPLE_PACK)) await writer.add(name, new Uint8ArrayReader(readFileSync(join(EXAMPLE_PACK, name))));
  await writer.add(TONE, new Uint8ArrayReader(tone()));
  return Buffer.from(await writer.close());
}

async function openTab(page: Page, wagon: string, zip?: Buffer): Promise<void> {
  await page.goto('./');
  await openPack(page, zip);
  await pickWagon(page, wagon);
  await page.getByRole('tab', { name: 'Sounds' }).click();
  await expect(page.getByTestId('sounds')).toHaveAttribute('data-wagon', wagon);
}

test('the shunter’s sounds are listed with what the engine makes of them; a range is changed from the keyboard and undone', async ({ page }) => {
  const errors = watchErrors(page);
  await openTab(page, 'rwat_example:shunter');

  const sections = page.locator('[data-testid="sounds"] [data-sound]');
  await expect(sections).toHaveCount(7);
  await expect(page.getByTestId('sounds-section-idle')).toContainText('Carries 64 blocks.');
  await expect(page.getByTestId('sounds-section-horn')).toContainText('Carries 192 blocks.');
  await expect(page.getByTestId('sounds-effective-horn')).toHaveText('A held signal sounds at pitch 0.8, volume 1.');
  await expect(page.getByTestId('sounds-control-WIDGET_1')).toHaveAttribute('data-verdict', 'silent');
  await expect(page.getByTestId('sounds-control-THROTTLE_1')).toContainText('sounds for the handle: throttle');
  // a game sound cannot be heard here, and the tab says so
  await expect(page.locator('[data-ref="/sounds/idle/main"] [data-testid="sounds-ref-note"]')).toHaveText('a game sound, cannot be played here (minecraft:block.beacon.ambient)');
  await expect(page.locator('[data-ref="/sounds/idle/main"] .sounds-play')).toBeDisabled();

  const effective = page.getByTestId('sounds-effective-idle');
  await expect(effective).toContainText('Pitch: 0.6 → 1.1 (at rest → at full)');
  const pitchFrom = page.locator('[data-testid="sounds-ranges-idle"] [data-pointer="/sounds/idle/pitch"] input').first();
  await pitchFrom.fill('0.7');
  await pitchFrom.press('Enter');
  await expect(effective).toContainText('Pitch: 0.7 → 1.1 (at rest → at full)');
  await expect(page.getByTestId('save')).toHaveText('Save (1)');

  // the slider of the engine: notch 0 and notch 8 read the ranges as the engine does
  const slider = page.locator('[data-testid="sounds-listen-idle"] input[type="range"]');
  await slider.fill('0');
  await expect(page.getByTestId('sounds-readout-idle')).toHaveText('Playing: pitch 0.7, volume 0.5');
  await slider.fill('8');
  await expect(page.getByTestId('sounds-readout-idle')).toHaveText('Playing: pitch 1.1, volume 1');

  await page.getByTestId('undo').click();
  await expect(effective).toContainText('Pitch: 0.6 → 1.1 (at rest → at full)');
  await expect(page.getByTestId('save')).toHaveText('Save');
  await page.getByTestId('redo').click();
  await expect(effective).toContainText('Pitch: 0.7 → 1.1 (at rest → at full)');

  const serious = (await new AxeBuilder({ page }).include('[data-testid="sounds"]').analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  expect(errors).toEqual([]);
});

test('a pack file chosen for a sound plays through WebAudio, a loop follows its slider and stops', async ({ page }) => {
  await page.addInitScript(() => {
    // what the page starts on the audio context, to see that sound was really asked for
    const started: { loop: boolean; rate: number; seconds: number }[] = [];
    (window as unknown as { __started: typeof started }).__started = started;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called with the context as `this` below
    const make = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function (this: AudioContext) {
      const source = make.call(this);
      const start = source.start.bind(source);
      source.start = (...args: [number?, number?, number?]) => {
        started.push({ loop: source.loop, rate: source.playbackRate.value, seconds: source.buffer?.duration ?? 0 });
        start(...args);
      };
      return source;
    };
  });
  const errors = watchErrors(page);
  await openTab(page, 'rwat_example:shunter', await packWithTone());
  const started = () => page.evaluate(() => (window as unknown as { __started: { loop: boolean; rate: number; seconds: number }[] }).__started);

  // the horn's loop becomes the tone, picked from the pack's files
  const main = page.locator('[data-ref="/sounds/horn/main"]');
  await main.locator('select').selectOption(TONE);
  await expect(main.getByTestId('sounds-ref-note')).toHaveText('pack file');
  await expect(page.getByTestId('save')).toHaveText('Save (1)');
  await expect(main.locator('input')).toHaveValue('sounds/tone.ogg');

  // the file as it is
  await main.locator('.sounds-play').click();
  await expect.poll(async () => (await started()).length).toBe(1);
  expect((await started())[0]).toMatchObject({ loop: false, rate: 1 });
  expect((await started())[0]?.seconds).toBeCloseTo(0.2, 2);
  await expect(page.getByTestId('sounds-error')).toHaveCount(0);

  // the horn held: the second number of its pitch, 0.8, as the engine plays a signal
  const horn = page.getByTestId('sounds-listen-horn');
  await horn.getByRole('button', { name: '▶ Play' }).click();
  await expect(horn).toHaveAttribute('data-playing', 'true');
  await expect.poll(async () => (await started()).length).toBe(2);
  expect((await started())[1]).toMatchObject({ loop: true });
  expect((await started())[1]?.rate).toBeCloseTo(0.8, 5);
  await horn.getByRole('button', { name: '■ Stop' }).click();
  await expect(horn).toHaveAttribute('data-playing', 'false');

  // the wheels: a tone for the loop, the speed slider moves the pitch of the playing loop
  await page.locator('[data-ref="/sounds/wheels/main"] select').selectOption(TONE);
  const wheels = page.getByTestId('sounds-listen-wheels');
  await wheels.locator('input[type="range"]').fill('100');
  await expect(page.getByTestId('sounds-readout-wheels')).toHaveText('Playing: pitch 1.1, volume 0.6');
  await wheels.getByRole('button', { name: '▶ Play' }).click();
  await expect(wheels).toHaveAttribute('data-playing', 'true');
  await expect.poll(async () => (await started()).length).toBe(3);
  expect((await started())[2]?.rate).toBeCloseTo(1.1, 5);
  await wheels.locator('input[type="range"]').fill('0');
  await expect(page.getByTestId('sounds-readout-wheels')).toHaveText('Playing: pitch 0.7, volume 0');

  // another wagon: whatever plays stops
  await page.locator('[data-stock="rwat_example:gondola"] [data-file="assets/rwat_example/wagon_models/gondola.json"]').click();
  await expect(page.getByTestId('sounds')).toHaveAttribute('data-wagon', 'rwat_example:gondola');
  await page.locator('[data-stock="rwat_example:shunter"] [data-file="assets/rwat_example/wagon_models/shunter.json"]').click();
  await expect(page.getByTestId('sounds-listen-wheels')).toHaveAttribute('data-playing', 'false');
  expect(errors).toEqual([]);
});

test('a door key that names no door brings a finding up in the tab and the checks; removed, it goes', async ({ page }) => {
  const errors = watchErrors(page);
  await openTab(page, 'rwat_example:coach');
  await expect(page.getByTestId('checks-summary')).toHaveText('No findings.');
  await expect(page.locator('[data-testid="sounds-section-doors"] [data-door]')).toHaveCount(8);

  // a key the type has no door for, added in the model's form
  await page.locator('[data-stock="rwat_example:coach"] [data-file="assets/rwat_example/wagon_models/coach.json"]').click();
  const dictionary = page.locator('[data-testid="inspector"] [data-pointer="/sounds/doors"]');
  await dictionary.getByLabel('New key of doors', { exact: true }).fill('door_x');
  await dictionary.getByLabel('Value of the new key of doors', { exact: true }).fill('minecraft:block.piston.contract');
  await dictionary.getByRole('button', { name: 'Add', exact: true }).click();

  const found = page.getByTestId('sounds-problems-doors');
  await expect(found).toHaveAttribute('data-codes', 'loader.door-key');
  await expect(found).toContainText('“door_x” is no door of wagon type rwat_example:coach');
  await expect(page.locator('[data-testid="sounds-section-doors"] [data-door="door_x"]')).toContainText('no such door in the type');
  await expect(page.getByTestId('checks').locator('.finding[data-code="loader.door-key"]')).toHaveCount(1);

  await page.locator('[data-testid="sounds-section-doors"] [data-door="door_x"]').getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByTestId('sounds-problems-doors')).toHaveCount(0);
  await expect(page.getByTestId('checks-summary')).toHaveText('No findings.');

  // undone, the key and its finding are back; undone again, the pack is as it was
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('sounds-problems-doors')).toHaveAttribute('data-codes', 'loader.door-key');
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('sounds-problems-doors')).toHaveCount(0);
  await expect(page.getByTestId('save')).toHaveText('Save');
  expect(errors).toEqual([]);
});
