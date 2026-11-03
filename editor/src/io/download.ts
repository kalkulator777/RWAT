/**
 * Handing a result to the user as a file download: a zip of the pack, or a single file
 * (the recipe of an IR pack, a lang file). Call it from a click.
 */

/** How long the object URL of a download stays valid; browsers start the download after the click, not during it. */
const REVOKE_AFTER_MS = 60_000;

/** Starts the download of the blob under the name. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}

/** Starts the download of the bytes under the name. */
export function downloadBytes(bytes: Uint8Array<ArrayBuffer>, fileName: string, type = 'application/octet-stream'): void {
  downloadBlob(new Blob([bytes], { type }), fileName);
}

/**
 * A file name for the download of a pack made from `packName` (a folder's or a zip's
 * name): characters that file systems refuse become '_', and `.zip` is added unless the
 * name has it. An empty name becomes `pack.zip`.
 */
export function zipFileName(packName: string): string {
  // eslint-disable-next-line no-control-regex -- control characters are not allowed in a file name
  const clean = packName.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '_').trim();
  const base = clean.replace(/\.zip$/i, '');
  return `${base === '' ? 'pack' : base}.zip`;
}
