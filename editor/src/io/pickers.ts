/**
 * Asking the user for a zip or a folder through a file input, which every browser has.
 * Each function must be called from a click (or another user gesture), or the browser
 * shows no dialog. They resolve to null when the user cancels.
 */

import type { PackSource } from '../core/contracts';
import { openDirInputSource } from './dirInput';
import { openZipSource } from './zip';

/**
 * Shows the browser's file dialog through a hidden input and resolves to the chosen
 * files, or null when the dialog is cancelled (browsers without the `cancel` event of
 * file inputs never resolve a cancelled dialog).
 */
export function pickFiles(options: { accept?: string; directory?: boolean; multiple?: boolean }): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.hidden = true;
    if (options.accept !== undefined) input.accept = options.accept;
    if (options.multiple === true) input.multiple = true;
    if (options.directory === true) input.webkitdirectory = true;
    const done = (files: File[] | null): void => {
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => done(input.files && input.files.length > 0 ? [...input.files] : null));
    input.addEventListener('cancel', () => done(null));
    // Some browsers only open the dialog of an input that is in the page.
    document.body.append(input);
    input.click();
  });
}

/** Asks for a zip; resolves to the pack in it, or null when the user cancels. Rejects with a PackIoError for a zip that is no pack. */
export async function pickZipPack(): Promise<PackSource | null> {
  const files = await pickFiles({ accept: '.zip,application/zip' });
  const file = files?.[0];
  return file === undefined ? null : openZipSource(file, file.name);
}

/** Asks for a folder to read (no writing back); resolves to the pack in it, or null when the user cancels. */
export async function pickFolderPack(): Promise<PackSource | null> {
  const files = await pickFiles({ directory: true });
  return files === null ? null : openDirInputSource(files);
}
