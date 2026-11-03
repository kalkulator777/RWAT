/**
 * Opening, checking and saving packs in the browser through the shell's own buttons
 * (docs/proposals/editor.md §1.2, §2.2, §7 M1): a zip and a folder of the example pack
 * through the file dialogs, the tree and the checks tab showing it, the zip saved twice
 * as the same bytes with the pack's files unchanged byte for byte, a zip with a `..`
 * path refused, and a folder opened and saved through the File System Access code (the
 * picker is replaced by one that hands over the browser's private file system, which
 * needs no dialog).
 *
 * There are no forms yet, so no edit of a field is made here: an edit and its save are
 * the Vitest gate's (test/m1.test.ts); this file checks the shell around them, and that
 * a save with no edits writes the pack back as it was.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { BlobReader, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from '@zip.js/zip.js';
import { EXAMPLE_PACK as PACK } from '../../src/testing/repo.node';

function filesOf(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => statSync(join(dir, name)).isFile())
    .map((name) => name.split(sep).join('/'))
    .sort();
}

const FILES = filesOf(PACK);

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
  await page.getByTestId('open-zip').click();
  await (await chooser).setFiles({ name: 'RwatExamplePack.zip', mimeType: 'application/zip', buffer });
}

/** Clicks Save and returns the zip it downloads. */
async function saveZip(page: Page): Promise<Buffer> {
  const download = page.waitForEvent('download');
  await page.getByTestId('save').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('RwatExamplePack.zip');
  return readFileSync(await file.path());
}

test.use({ locale: 'en-US' });

test('a zip of the example pack opens: the top bar, the tree of wagons and the checks tab show it', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  await expect(page.getByTestId('save')).toBeDisabled();
  await openZip(page, await packZip());

  const status = page.getByTestId('pack-status');
  await expect(status).toHaveAttribute('data-kind', 'zip');
  await expect(status).toContainText('RwatExamplePack.zip');
  const wagons = page.locator('[data-section="wagons"] [data-stock]');
  await expect(wagons).toHaveText([/rwat_example:coach/, /rwat_example:gondola/, /rwat_example:shunter/]);
  await expect(page.locator('[data-section="rails"]')).toContainText('rwat_example:wooden_track');
  await expect(page.getByTestId('tree').locator('[data-file="pack.mcmeta"]')).toBeVisible();

  // The schema comes from the site (schema/ next to the page): the example pack has no findings.
  await expect(page.getByTestId('checks')).toHaveAttribute('data-schema', 'loaded');
  await expect(page.getByTestId('checks-summary')).toHaveText('No findings.');
  await expect(page.getByTestId('save')).toBeEnabled();
  await expect(page.getByTestId('undo')).toBeDisabled();
  await expect(page.getByTestId('redo')).toBeDisabled();
  await page.keyboard.press('Control+Z');
  await page.keyboard.press('Control+Shift+Z');
  const serious = (await new AxeBuilder({ page }).analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  expect(errors).toEqual([]);
});

test('a folder of the example pack opens for reading with the same files', async ({ page }) => {
  await page.goto('./');
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('open-folder-readonly').click();
  await (await chooser).setFiles(PACK);
  const status = page.getByTestId('pack-status');
  await expect(status).toHaveAttribute('data-kind', 'dir-input');
  await expect(status).toContainText('RwatExamplePack');
  await expect(page.locator('[data-section="wagons"] [data-stock]')).toHaveCount(3);
  await expect(page.getByTestId('checks')).toHaveAttribute('data-schema', 'loaded');
  await expect(page.getByTestId('checks-summary')).toHaveText('No findings.');
});

test('the zip saved is the same bytes every time, the pack unchanged byte for byte, laid out like the converter writes it', async ({ page }) => {
  await page.goto('./');
  await openZip(page, await packZip());
  await expect(page.getByTestId('pack-status')).toBeVisible();

  const first = await saveZip(page);
  await page.keyboard.press('Control+S'); // the shortcut saves too
  const second = first.equals(await saveZip(page));
  expect(second).toBe(true);

  const entries = await new ZipReader(new BlobReader(new Blob([new Uint8Array(first)]))).getEntries();
  expect(entries.map((entry) => entry.filename)).toEqual(FILES);
  for (const entry of entries) {
    expect(entry.lastModDate.getFullYear()).toBe(1980);
    expect(entry.externalFileAttributes >>> 16).toBe(0o644);
    if (entry.directory) throw new Error(`${entry.filename} is a folder entry`);
    const bytes = await entry.getData(new Uint8ArrayWriter());
    expect(Buffer.from(bytes).equals(readFileSync(join(PACK, entry.filename))), entry.filename).toBe(true);
  }
});

test('a zip with a .. path is refused, whole, and the message says which path', async ({ page }) => {
  await page.goto('./');
  const zip = await packZip({ 'aa/evil.txt': 'evil' });
  // Same-length rename in both headers: aa/evil.txt -> ../evil.txt.
  const from = Buffer.from('aa/evil.txt');
  for (let at = zip.indexOf(from); at >= 0; at = zip.indexOf(from, at + 1)) Buffer.from('../evil.txt').copy(zip, at);
  await openZip(page, zip);
  await expect(page.getByTestId('failure')).toContainText('../evil.txt');
  await expect(page.getByTestId('pack-status')).toHaveCount(0);
  await page.getByTestId('failure').getByRole('button').click();
  await expect(page.getByTestId('failure')).toHaveCount(0);
});

test('a zip with no pack.mcmeta is not a pack', async ({ page }) => {
  await page.goto('./');
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
  await writer.add('readme.txt', new Uint8ArrayReader(new TextEncoder().encode('hi')));
  await openZip(page, Buffer.from(await writer.close()));
  await expect(page.getByTestId('failure')).toContainText('not a pack');
});

test('a folder opened for writing through File System Access is saved back in place, untouched files and all', async ({ page }) => {
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    // The picker hands over a folder of the browser's private file system: no dialog to drive.
    (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory();
      return root.getDirectoryHandle('rwat-e2e-pack');
    };
  });
  await page.goto('./');
  const files = FILES.map((name) => [name, readFileSync(join(PACK, name)).toString('base64')]);
  await page.evaluate(async (list) => {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry('rwat-e2e-pack', { recursive: true }).catch(() => undefined);
    const folder = await root.getDirectoryHandle('rwat-e2e-pack', { create: true });
    for (const [path, base64] of list as [string, string][]) {
      let dir = folder;
      const parts = path.split('/');
      const name = parts.pop() as string;
      for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
      const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await writable.write(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
      await writable.close();
    }
  }, files);

  await page.getByTestId('open-folder').click();
  const status = page.getByTestId('pack-status');
  await expect(status).toHaveAttribute('data-kind', 'fs-access');
  await expect(status).toContainText('saved in place');
  await expect(page.locator('[data-section="wagons"] [data-stock]')).toHaveCount(3);
  await expect(page.getByTestId('checks')).toHaveAttribute('data-schema', 'loaded');
  await expect(page.getByTestId('checks-summary')).toHaveText('No findings.');

  const saved = page.waitForEvent('download', { timeout: 1000 }).then(() => true, () => false);
  await page.getByTestId('save').click();
  expect(await saved, 'a folder is saved in place, not downloaded').toBe(false);

  const after = await page.evaluate(async () => {
    const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle('rwat-e2e-pack');
    const out: [string, string][] = [];
    const walk = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
      for await (const [name, handle] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
        if (handle.kind === 'directory') await walk(handle as FileSystemDirectoryHandle, `${prefix}${name}/`);
        else {
          const bytes = new Uint8Array(await (await (handle as FileSystemFileHandle).getFile()).arrayBuffer());
          const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
          out.push([`${prefix}${name}`, [...digest].map((b) => b.toString(16).padStart(2, '0')).join('')]);
        }
      }
    };
    await walk(folder, '');
    return out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  });
  expect(after).toEqual(FILES.map((name) => [name, createHash('sha256').update(readFileSync(join(PACK, name))).digest('hex')]));
  expect(errors).toEqual([]);
});
