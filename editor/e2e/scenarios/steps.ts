/**
 * What the scenarios of docs/proposals/editor.md §2.1–§2.5 do in the built site, as their
 * user does it: the top bar's dialogs, a form's box typed into and committed, the save
 * dialog's zip, a pack opened from a zip or from a folder. The folder is one of the
 * browser's private file system (OPFS) handed over by a replaced folder picker, as in
 * e2e/save: headless Chromium has no real dialog, and an OPFS handle is a real
 * `FileSystemDirectoryHandle`.
 *
 * The example pack's files (CC0) are the user's: picked from run/rwat_packs/RwatExamplePack.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { BlobReader, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from '@zip.js/zip.js';
import { EXAMPLE_PACK } from '../../src/testing/repo.node';
import { filesOf } from '../examplePack';

export const NS = 'rwat_example';

/** The example pack's files, '/'-separated, sorted. */
export const PACK_FILES = filesOf(EXAMPLE_PACK);

/** A file of the example pack on the disk. */
export function disk(path: string): string {
  return join(EXAMPLE_PACK, ...path.split('/'));
}

/** The files of a folder of the example pack (not its subfolders), on the disk. */
export function diskFolder(folder: string): string[] {
  return PACK_FILES.filter((path) => path.startsWith(`${folder}/`) && !path.slice(folder.length + 1).includes('/')).map(disk);
}

/** The example pack's files, changed where `edit` says (a JSON file's value edited in place), as a map of bytes. */
export function packFiles(edit: Record<string, (value: Record<string, unknown>) => void> = {}): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  for (const path of PACK_FILES) {
    let bytes = readFileSync(disk(path));
    const change = edit[path];
    if (change !== undefined) {
      const value = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
      change(value);
      bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
    }
    files.set(path, bytes);
  }
  return files;
}

/** A zip of files, written by the library itself (not the editor's writer). */
export async function zipOf(files: Map<string, Buffer>): Promise<Buffer> {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
  for (const [path, bytes] of files) await writer.add(path, new Uint8ArrayReader(bytes));
  return Buffer.from(await writer.close());
}

/** The files of a zip by path. */
export async function unzip(zip: Buffer): Promise<Map<string, Buffer>> {
  const entries = await new ZipReader(new BlobReader(new Blob([new Uint8Array(zip)]))).getEntries();
  const files = new Map<string, Buffer>();
  for (const entry of entries) if (!entry.directory) files.set(entry.filename, Buffer.from(await entry.getData(new Uint8ArrayWriter())));
  return files;
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

/** The editor opened, its schema loaded (the forms and the checks need it). */
export async function start(page: Page): Promise<void> {
  await page.goto('./');
  await expect(page.locator('.checks')).toHaveAttribute('data-schema', 'loaded');
}

/** Saves a screenshot of the page or a part of it into the test's output. */
export async function screenshot(page: Page, name: string, target?: Locator): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const path = test.info().outputPath(`${name}.png`);
  await (target ?? page).screenshot({ path });
  await test.info().attach(name, { path, contentType: 'image/png' });
}

/** axe finds nothing serious or critical. */
export async function axe(page: Page): Promise<void> {
  const serious = (await new AxeBuilder({ page }).analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

/** The field of the inspector's form at a pointer. */
export function field(page: Page, at: string): Locator {
  return page.getByTestId('inspector').locator(`[data-pointer="${at}"]`);
}

/** Types into a box and commits it with Enter, as an author does. */
export async function commit(box: Locator, text: string): Promise<void> {
  await box.fill(text);
  await box.press('Enter');
}

/** Types into the first box of a field of the inspector's form and commits it. */
export async function typeInto(page: Page, at: string, text: string): Promise<void> {
  await commit(field(page, at).locator('input').first(), text);
  await expect(field(page, at).locator('input').first()).toHaveValue(text);
}

/** Picks a file in the pack tree: the inspector shows its form. */
export async function pickFile(page: Page, file: string): Promise<void> {
  await page.getByTestId('tree').locator(`[data-file="${file}"]`).first().click();
  await expect(page.getByTestId('inspector')).toHaveAttribute('data-file', file);
}

export interface NewPack {
  name: string;
  namespace: string;
  title?: string;
  authors?: string;
  license?: string;
  description?: string;
}

/** «New pack»: the dialog filled in and created. */
export async function newPack(page: Page, answers: NewPack): Promise<void> {
  await page.getByTestId('new-pack').click();
  const dialog = page.getByTestId('new-pack-dialog');
  await expect(dialog).toBeVisible();
  for (const [name, value] of Object.entries({ name: answers.name, namespace: answers.namespace, title: answers.title, authors: answers.authors, license: answers.license, description: answers.description })) {
    if (value !== undefined) await dialog.locator(`input[name="${name}"]`).fill(value);
  }
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('pack-status')).toContainText(answers.name);
}

/** «Add files»: a folder of the pack and the files picked from the disk. */
export async function addFiles(page: Page, folder: string, files: readonly string[]): Promise<void> {
  await page.getByTestId('add-files').click();
  const dialog = page.getByTestId('add-files-dialog');
  await dialog.locator('input[name="folder"]').fill(folder);
  await dialog.locator('input[type="file"]').setInputFiles([...files]);
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

export interface Wagon {
  id: string;
  folder: string;
  files: readonly string[];
  length: string;
  mass: string;
  bogies: [string, string];
  names?: { en_us?: string; ru_ru?: string };
}

/** «Add wagon»: the dialog filled in, the model's files picked from the disk. */
export async function addWagon(page: Page, wagon: Wagon): Promise<void> {
  await page.getByTestId('add-wagon').click();
  const dialog = page.getByTestId('add-wagon-dialog');
  await dialog.locator('input[name="id"]').fill(wagon.id);
  await dialog.locator('input[name="folder"]').fill(wagon.folder);
  await dialog.locator('input[type="file"]').setInputFiles([...wagon.files]);
  await dialog.locator('input[name="length"]').fill(wagon.length);
  await dialog.locator('input[name="mass_t"]').fill(wagon.mass);
  await dialog.locator('input[name="bogie_front"]').fill(wagon.bogies[0]);
  await dialog.locator('input[name="bogie_rear"]').fill(wagon.bogies[1]);
  for (const [code, text] of Object.entries(wagon.names ?? {})) await dialog.locator(`input[name="name_${code}"]`).fill(text);
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

/** «Save», then the dialog's zip: the zip downloaded. */
export async function saveZip(page: Page, name: string): Promise<Buffer> {
  const download = page.waitForEvent('download');
  await page.getByTestId('save-zip').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(name);
  await expect(page.getByTestId('save-dialog')).toHaveCount(0);
  await expect(page.getByTestId('save')).toHaveAttribute('data-dirty', 'false');
  return readFileSync(await file.path());
}

/** «Open zip» with a zip of the user's. */
export async function openZip(page: Page, zip: Buffer, name: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('open-zip').click();
  await (await chooser).setFiles({ name, mimeType: 'application/zip', buffer: zip });
  await expect(page.getByTestId('pack-status')).toHaveAttribute('data-kind', 'zip');
}

/**
 * The folder picker replaced, before the page starts, by one that hands over a folder of
 * the browser's private file system; then the files written into that folder.
 */
export async function privateFolder(page: Page, name: string, files: Map<string, Buffer>): Promise<void> {
  await page.addInitScript((folder) => {
    (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory();
      return root.getDirectoryHandle(folder);
    };
  }, name);
  await start(page);
  const list = [...files].map(([path, bytes]) => [path, bytes.toString('base64')]);
  await page.evaluate(
    async ({ list, name }) => {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(name, { recursive: true }).catch(() => undefined);
      const folder = await root.getDirectoryHandle(name, { create: true });
      for (const [path, base64] of list as [string, string][]) {
        let dir = folder;
        const parts = path.split('/');
        const file = parts.pop() as string;
        for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
        const writable = await (await dir.getFileHandle(file, { create: true })).createWritable();
        await writable.write(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
        await writable.close();
      }
    },
    { list, name },
  );
}

/** The checks tab, with its findings. */
export async function checksTab(page: Page): Promise<Locator> {
  await page.getByRole('tab', { name: 'Checks', exact: true }).click();
  return page.getByTestId('checks');
}
