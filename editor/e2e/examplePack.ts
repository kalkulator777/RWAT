/**
 * The example pack in the browser tests, opened the way a user opens it: a zip of the
 * repository's run/rwat_packs/RwatExamplePack (CC0) handed to the shell's "Open zip", and
 * a wagon picked in the pack tree, after which the model worker reads its model and the
 * 3D view shows it. Also the console's errors, which a test expects to stay empty.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js';
import { EXAMPLE_PACK } from '../src/testing/repo.node';

/** Every file of a folder, '/'-separated, sorted. */
export function filesOf(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => statSync(join(dir, name)).isFile())
    .map((name) => name.split(sep).join('/'))
    .sort();
}

/** A zip of a pack folder, built with the library directly (not the editor's own writer). */
export async function packZip(dir: string = EXAMPLE_PACK): Promise<Buffer> {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
  for (const name of filesOf(dir)) await writer.add(name, new Uint8ArrayReader(readFileSync(join(dir, name))));
  return Buffer.from(await writer.close());
}

/** Opens a zip of a pack (the example pack by default) through the shell's button. */
export async function openPack(page: Page, zip?: Buffer, name = 'RwatExamplePack.zip'): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('open-zip').click();
  await (await chooser).setFiles({ name, mimeType: 'application/zip', buffer: zip ?? (await packZip()) });
  await expect(page.getByTestId('pack-status')).toBeVisible();
}

/** Picks a wagon by its model file in the pack tree and waits until the 3D view shows its model. */
export async function pickWagon(page: Page, id: string, timeout = 15_000): Promise<void> {
  const [namespace, name] = id.split(':') as [string, string];
  await page.locator(`[data-stock="${id}"] [data-file="assets/${namespace}/wagon_models/${name}.json"]`).click();
  await expect(page.getByTestId('view3d')).toHaveAttribute('data-model', id, { timeout });
}

/** Collects what the page logs as an error and what it throws. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}
