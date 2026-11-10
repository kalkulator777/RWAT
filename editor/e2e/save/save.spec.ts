/**
 * Saving and the session in the browser (docs/proposals/editor.md §2.5 steps 3–4, M5):
 *
 * - an edit, then "Save": the dialog lists one changed file with its one line, the zip it
 *   downloads has the edit and every other file byte for byte;
 * - an edit, then the page reloaded: "Restore the session" brings the edit back and undo
 *   works; the session kept the zip in IndexedDB;
 * - a folder through File System Access: the folder picker is replaced by one that hands
 *   over a folder of the browser's private file system (OPFS) — headless Chromium has no
 *   real dialog, and an OPFS handle is a real `FileSystemDirectoryHandle`, written through
 *   `createWritable` like a folder on disk. Only the changed file is written; after a
 *   reload a saved session is not offered, an unsaved one is. Restoring from the handle
 *   itself is not driven here (see the test).
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { BlobReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';
import { filesOf, openPack, watchErrors } from '../examplePack';
import { EXAMPLE_PACK as PACK } from '../../src/testing/repo.node';

const COACH = 'data/rwat_example/wagon_types/coach.json';
const FILES = filesOf(PACK);
const FOLDER = 'rwat-e2e-save';

test.use({ locale: 'en-US' });

/** Selects the coach's type in the tree and commits a mass into its form. */
async function editMass(page: Page, value: string): Promise<void> {
  await page.getByTestId('tree').locator(`[data-file="${COACH}"]`).first().click();
  const box = page.getByTestId('inspector').locator('[data-pointer="/mass_t"] input').first();
  await box.fill(value);
  await box.press('Enter');
  await expect(page.getByTestId('save')).toHaveAttribute('data-dirty', 'true');
}

async function massShown(page: Page): Promise<string> {
  await page.getByTestId('tree').locator(`[data-file="${COACH}"]`).first().click();
  return page.getByTestId('inspector').locator('[data-pointer="/mass_t"] input').first().inputValue();
}

/** Waits until the session is written to IndexedDB, then reloads (the page asks before leaving with unsaved changes: yes). */
async function reload(page: Page): Promise<void> {
  await expect(page.getByTestId('save')).toHaveAttribute('data-session', 'saved');
  page.once('dialog', (dialog) => void dialog.accept());
  await page.reload();
}

async function axe(page: Page): Promise<void> {
  const serious = (await new AxeBuilder({ page }).analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

const sha = (bytes: Buffer | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

test('an edit: Save lists the one changed file with its line, and the zip has the edit and the rest byte for byte', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  await openPack(page);
  await expect(page).toHaveTitle('RwatExamplePack.zip — RWAT pack editor');
  await editMass(page, '45');
  await expect(page).toHaveTitle('● RwatExamplePack.zip — RWAT pack editor');

  await page.getByTestId('save').click();
  const dialog = page.getByTestId('save-dialog');
  await expect(dialog.locator('[data-path]')).toHaveCount(1);
  await expect(dialog.locator(`[data-path="${COACH}"]`)).toHaveAttribute('data-status', 'changed');
  await expect(dialog.getByTestId('save-lines')).toHaveText('+1 −1');
  await expect(dialog.getByTestId('save-where')).toHaveAttribute('data-target', 'zip');
  await dialog.getByRole('button', { name: 'Difference' }).click();
  await expect(dialog.getByTestId('save-diff').locator('[data-kind="add"]')).toHaveText(['+   "mass_t": 45.0,']);
  await axe(page);

  const download = page.waitForEvent('download');
  await dialog.getByTestId('save-zip').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('RwatExamplePack.zip');
  await expect(page.getByTestId('save-dialog')).toHaveCount(0);
  await expect(page.getByTestId('save')).toHaveAttribute('data-dirty', 'false');
  await expect(page).toHaveTitle('RwatExamplePack.zip — RWAT pack editor');

  const entries = await new ZipReader(new BlobReader(new Blob([new Uint8Array(readFileSync(await file.path()))]))).getEntries();
  expect(entries.map((entry) => entry.filename)).toEqual(FILES);
  for (const entry of entries) {
    if (entry.directory) continue;
    const bytes = Buffer.from(await entry.getData(new Uint8ArrayWriter()));
    const original = readFileSync(join(PACK, entry.filename));
    if (entry.filename !== COACH) {
      expect(bytes.equals(original), entry.filename).toBe(true);
      continue;
    }
    const was = original.toString('utf8').split('\n');
    const now = bytes.toString('utf8').split('\n');
    expect(now.filter((line, i) => line !== was[i])).toEqual(['  "mass_t": 45.0,']);
  }
  expect(errors).toEqual([]);
});

test('an edit survives a reload: Restore brings it back, undo works', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  await openPack(page);
  await editMass(page, '45');
  await editMass(page, '46');
  await reload(page);

  const restore = page.getByTestId('restore-dialog');
  await expect(restore).toBeVisible();
  await expect(restore.getByTestId('restore-text')).toContainText('RwatExamplePack.zip');
  await expect(restore.getByTestId('restore-text')).toContainText('1 changed file');
  await axe(page);
  await restore.getByTestId('restore-session').click();
  await expect(restore).toHaveCount(0);
  await expect(page.getByTestId('pack-status')).toHaveAttribute('data-kind', 'zip');
  expect(await massShown(page)).toBe('46');
  await expect(page.getByTestId('save')).toHaveText('Save (1)');

  await page.getByTestId('undo').click();
  expect(await massShown(page)).toBe('45');
  await page.getByTestId('undo').click();
  expect(await massShown(page)).toBe('42');
  await expect(page.getByTestId('save')).toHaveText('Save');
  await expect(page.getByTestId('undo')).toBeDisabled();
  await page.getByTestId('redo').click();
  expect(await massShown(page)).toBe('45');

  // starting afresh forgets it: the next reload asks nothing
  await reload(page);
  await page.getByTestId('restore-discard').click();
  await expect(page.getByTestId('restore-dialog')).toHaveCount(0);
  await expect(page.getByTestId('pack-status')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('open-zip')).toBeVisible();
  await expect(page.getByTestId('restore-dialog')).toHaveCount(0);
  expect(errors).toEqual([]);
});

/** The example pack copied into a folder of the private file system; the folder picker hands that folder over. */
async function opfsFolder(page: Page): Promise<void> {
  await page.addInitScript((name) => {
    (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory();
      return root.getDirectoryHandle(name);
    };
  }, FOLDER);
  await page.goto('./');
  const files = FILES.map((name) => [name, readFileSync(join(PACK, name)).toString('base64')]);
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
    { list: files, name: FOLDER },
  );
}

/** Every file of the private folder with its SHA-256. */
async function folderHashes(page: Page): Promise<[string, string][]> {
  return page.evaluate(async (name) => {
    const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle(name);
    const out: [string, string][] = [];
    const walk = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
      for await (const [entry, handle] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
        if (handle.kind === 'directory') await walk(handle as FileSystemDirectoryHandle, `${prefix}${entry}/`);
        else {
          const bytes = new Uint8Array(await (await (handle as FileSystemFileHandle).getFile()).arrayBuffer());
          const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
          out.push([`${prefix}${entry}`, [...digest].map((b) => b.toString(16).padStart(2, '0')).join('')]);
        }
      }
    };
    await walk(folder, '');
    return out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, FOLDER);
}

async function folderText(page: Page, path: string): Promise<string> {
  return page.evaluate(
    async ({ name, path }) => {
      let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(name);
      const parts = path.split('/');
      const file = parts.pop() as string;
      for (const part of parts) dir = await dir.getDirectoryHandle(part);
      return (await (await dir.getFileHandle(file)).getFile()).text();
    },
    { name: FOLDER, path },
  );
}

test('a folder: only the changed file written in place; after a reload the session is offered, and dropped on Start afresh', async ({ page }) => {
  const errors = watchErrors(page);
  await opfsFolder(page);
  await page.getByTestId('open-folder').click();
  await expect(page.getByTestId('pack-status')).toHaveAttribute('data-kind', 'fs-access');
  await editMass(page, '45');

  await page.getByTestId('save').click();
  const dialog = page.getByTestId('save-dialog');
  await expect(dialog.getByTestId('save-where')).toHaveAttribute('data-target', 'folder');
  await expect(dialog.locator('[data-path]')).toHaveCount(1);
  const downloaded = page.waitForEvent('download', { timeout: 1000 }).then(() => true, () => false);
  await dialog.getByTestId('save-folder').click();
  await expect(dialog).toHaveCount(0);
  expect(await downloaded, 'a folder is saved in place').toBe(false);
  await expect(page.getByTestId('save')).toHaveAttribute('data-dirty', 'false');
  const after = await folderHashes(page);
  expect(after.map(([path]) => path)).toEqual(FILES);
  for (const [path, hash] of after) if (path !== COACH) expect(hash, path).toBe(sha(readFileSync(join(PACK, path))));
  expect(await folderText(page, COACH)).toContain('"mass_t": 45.0,');

  // saved: a reload offers nothing
  await expect(page.getByTestId('save')).toHaveAttribute('data-session', 'saved');
  await page.reload();
  await expect(page.getByTestId('open-folder')).toBeVisible();
  await expect(page.getByTestId('restore-dialog')).toHaveCount(0);

  // edited again and reloaded: the offer names the folder and says the browser will ask for it again
  await page.getByTestId('open-folder').click();
  await editMass(page, '47');
  await reload(page);
  const restore = page.getByTestId('restore-dialog');
  await expect(restore.getByTestId('restore-text')).toContainText(`“${FOLDER}”`);
  await expect(restore).toContainText('asks again for permission to open the folder');
  // Restoring reads the folder's handle back from IndexedDB, which crashes this headless Chromium
  // for a handle of the private file system (a page of ten lines does it): the restore from a
  // handle is the unit tests' (app/save/session.test.ts, a fake folder). Start afresh reads nothing.
  await restore.getByTestId('restore-discard').click();
  await expect(restore).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('open-folder')).toBeVisible();
  await expect(page.getByTestId('restore-dialog')).toHaveCount(0);
  expect(await folderText(page, COACH)).toContain('"mass_t": 45.0,');
  expect(errors).toEqual([]);
});
