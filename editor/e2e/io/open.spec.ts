/**
 * Opening and saving packs in the browser (docs/proposals/editor.md §1.2, §2.2): a zip
 * and a folder of the example pack through the file dialogs, a zip saved twice as the
 * same bytes, a zip with a `..` path refused, and the File System Access code run
 * against the browser's private file system, which needs no picker.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { BlobReader, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from '@zip.js/zip.js';

const PACK = fileURLToPath(new URL('../../../run/rwat_packs/RwatExamplePack', import.meta.url));

function filesOf(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => statSync(join(dir, name)).isFile())
    .map((name) => name.split(sep).join('/'))
    .sort();
}

const FILES = filesOf(PACK);
const BYTES = FILES.reduce((sum, name) => sum + statSync(join(PACK, name)).size, 0);

/** The example pack as a zip, built with the library directly (not the editor's own writer). */
async function packZip(extra: Record<string, string> = {}): Promise<Buffer> {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
  for (const name of FILES) await writer.add(name, new Uint8ArrayReader(readFileSync(join(PACK, name))));
  for (const [name, text] of Object.entries(extra)) await writer.add(name, new Uint8ArrayReader(new TextEncoder().encode(text)));
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

async function openZip(page: Page, buffer: Buffer): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('io-open-zip').click();
  await (await chooser).setFiles({ name: 'RwatExamplePack.zip', mimeType: 'application/zip', buffer });
}

test.use({ locale: 'en-US' });

test('a zip of the example pack opens and shows its number of files', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  await openZip(page, await packZip());
  const status = page.getByTestId('io-status');
  await expect(status).toHaveAttribute('data-kind', 'zip');
  await expect(status).toHaveAttribute('data-count', String(FILES.length));
  await expect(status).toHaveAttribute('data-bytes', String(BYTES));
  await expect(status).toHaveText(`RwatExamplePack.zip (zip): ${FILES.length} files, ${BYTES} bytes`);
  expect(errors).toEqual([]);
});

test('a folder of the example pack opens for reading with the same files', async ({ page }) => {
  await page.goto('./');
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('io-open-folder').click();
  await (await chooser).setFiles(PACK);
  const status = page.getByTestId('io-status');
  await expect(status).toHaveAttribute('data-kind', 'dir-input');
  await expect(status).toHaveAttribute('data-count', String(FILES.length));
  await expect(status).toHaveAttribute('data-bytes', String(BYTES));
  await expect(status).toContainText('RwatExamplePack (dir-input)');
});

test('the zip saved twice is the same bytes, laid out like the converter writes it', async ({ page }) => {
  await page.goto('./');
  await openZip(page, await packZip());
  await expect(page.getByTestId('io-status')).toHaveAttribute('data-count', String(FILES.length));

  const save = async (): Promise<Buffer> => {
    const download = page.waitForEvent('download');
    await page.getByTestId('io-save-zip').click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('RwatExamplePack.zip');
    return readFileSync(await file.path());
  };
  const first = await save();
  const second = await save();
  expect(second.equals(first)).toBe(true);

  const entries = await new ZipReader(new BlobReader(new Blob([new Uint8Array(first)]))).getEntries();
  expect(entries.map((entry) => entry.filename)).toEqual(FILES);
  for (const entry of entries) {
    expect(entry.lastModDate.getFullYear()).toBe(1980);
    expect(entry.externalFileAttributes >>> 16).toBe(0o644);
  }
});

test('a zip with a .. path is refused, whole', async ({ page }) => {
  await page.goto('./');
  const zip = await packZip({ 'aa/evil.txt': 'evil' });
  // Same-length rename in both headers: aa/evil.txt -> ../evil.txt.
  const from = Buffer.from('aa/evil.txt');
  for (let at = zip.indexOf(from); at >= 0; at = zip.indexOf(from, at + 1)) Buffer.from('../evil.txt').copy(zip, at);
  await openZip(page, zip);
  await expect(page.getByTestId('io-error')).toContainText('../evil.txt');
  await expect(page.getByTestId('io-status')).toHaveCount(0);
});

test('File System Access code reads, writes and deletes in a real folder', async ({ page }) => {
  await page.goto('./');
  const result = await page.evaluate(async () => {
    const io = (window as unknown as { rwatIo: typeof import('../../src/io') }).rwatIo;
    const root = await navigator.storage.getDirectory();
    const name = `rwat-e2e-${Date.now()}`;
    const folder = await root.getDirectoryHandle(name, { create: true });
    const source = await io.openFsAccessSource(io.fromNativeHandle(folder));
    const text = (s: string) => new TextEncoder().encode(s);
    await source.sink().write([
      { path: 'pack.mcmeta', bytes: text('{}') },
      { path: 'assets/ns/a.json', bytes: text('[1]') },
      { path: 'assets/ns/deep/b.json', bytes: text('[2]') },
    ]);
    const listed = await source.list();
    const read = new TextDecoder().decode(await source.read('assets/ns/a.json'));
    await source.sink().write([
      { path: 'assets/ns/deep/b.json', delete: true },
      { path: 'assets/ns/a.json', bytes: text('[3]') },
    ]);
    const after = await source.list();
    let hasDeep = true;
    try {
      await (await folder.getDirectoryHandle('assets')).getDirectoryHandle('ns').then((ns) => ns.getDirectoryHandle('deep'));
    } catch {
      hasDeep = false;
    }
    let missing = '';
    try {
      await source.read('nope.json');
    } catch (error) {
      missing = (error as { code: string }).code;
    }
    await root.removeEntry(name, { recursive: true });
    return { writable: source.writable, listed, read, after, hasDeep, missing };
  });
  expect(result.writable).toBe(true);
  expect(result.listed).toEqual([
    { path: 'assets/ns/a.json', size: 3 },
    { path: 'assets/ns/deep/b.json', size: 3 },
    { path: 'pack.mcmeta', size: 2 },
  ]);
  expect(result.read).toBe('[1]');
  expect(result.after.map((e) => e.path)).toEqual(['assets/ns/a.json', 'pack.mcmeta']);
  expect(result.hasDeep).toBe(false);
  expect(result.missing).toBe('not-found');
});
