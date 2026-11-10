/**
 * "Export the recipe" (editor.md §1.3, §2.6 step 5, §2.7; R10): the markup of an IR pack
 * for sharing — the recipe and its per-type files, as they stand, comments and all, and
 * not one asset. Whoever has the same IR zips puts them where the recipe's `sources` say
 * (relative to the recipe) and converts the same pack: the recipe names everything else
 * the converter reads (the sources, `sound_defaults`, `copy_root_files` — files of the
 * zips — and `overrides_dir`). The geometry digests (`--geometry`) are the converter's
 * output, not its input: they are not part of it.
 *
 * The zip is deterministic (io/zip.ts `buildZip`, laid out as `ir2rwat --zip`): the same
 * markup gives the same bytes. The button is the interface's (A6.3).
 */

import { buildZip } from '../../io/zip';
import { isJsonObject } from '../../core/json';
import type { RecipeWorkspace } from './workspace';

export interface RecipeExport {
  /** The files, in path order, as in the folder the recipe was opened from (`packs/mvp.json`, `packs/mvp/chme3.json`). */
  files: { path: string; bytes: Uint8Array }[];
  /** The zip of the files. */
  zip: Uint8Array;
  /** The IR zips the recipe's `sources` name, as written (relative to the recipe): what the receiver needs besides. */
  sources: string[];
}

/** True for a file of the markup: JSON, no model, texture or sound. */
export function isMarkupFile(path: string): boolean {
  return path.endsWith('.json');
}

/** The recipe's markup as files and as a zip; refuses (throws) if anything but JSON would go in. */
export async function exportRecipe(workspace: RecipeWorkspace): Promise<RecipeExport> {
  const files = await workspace.snapshot();
  const strays = files.filter((file) => !isMarkupFile(file.path)).map((file) => file.path);
  if (strays.length > 0) throw new Error(`not markup, not exported: ${strays.join(', ')}`);
  const sources = workspace.recipe().sources;
  const zips = Array.isArray(sources) ? sources.flatMap((source) => (isJsonObject(source) && typeof source.zip === 'string' ? [source.zip] : [])) : [];
  return { files, zip: await buildZip(files), sources: zips };
}
