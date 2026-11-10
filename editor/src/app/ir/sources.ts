/**
 * Where an IR session's files come from (editor.md §2.6, step 1): the recipe and its
 * per-type files as a source the recipe model opens (ir/recipe `RecipeWorkspace`), and the
 * IR zips the recipe's `sources` name, matched to the zips the author picked.
 *
 * - **A new recipe** (the import's wizard): `packs/<name>.json` in memory, its per-type
 *   files in `packs/<name>/`; the zips are named as the repository lays them out, next to
 *   `packs/` (`../<zip>`, *decision of A6.3*: the MVP recipe's layout, so a recipe made here
 *   and one of the repository read the same way). Never saved: its first save writes all.
 * - **A recipe file** with its per-type files picked as a folder or a zip: put together in
 *   memory as `packs/<recipe>` and `packs/<overrides_dir>/<id>.json`, the bytes as they
 *   were (a save writes only what changed, as a zip of the markup).
 * - **A folder** (File System Access, Chromium): the recipe and its per-type files where
 *   they are; saving writes the changed files back into it.
 *
 * Zips are matched by file name: a recipe's `../MVP-IR-1.8-….zip` is the picked
 * `MVP-IR-1.8-….zip`. Nothing of a zip is read here but its central directory (is it one).
 */

import { dumpBytes, isJsonObject } from '../../core/json';
import { joinPath } from '../../ir/recipe';
import { MemoryPack, openZipSource, type PackSource } from '../../io';
import { loadZipJs, NO_WORKERS } from '../../io/zipjs';

/** A zip the author picked: its file name and its bytes, never read whole (a `File`). */
export interface NamedBlob {
  readonly name: string;
  readonly blob: Blob;
}

/** A picked file as a {@link NamedBlob}. */
export function named(file: File): NamedBlob {
  return { name: file.name, blob: file };
}

/** Why the recipe's files could not be put together, as an i18n key with its values. */
export class IrInputError extends Error {
  constructor(
    readonly key: string,
    readonly params: Record<string, string | number> = {},
  ) {
    super(`${key} ${JSON.stringify(params)}`);
    this.name = 'IrInputError';
  }
}

/** A file name of a path: its last part (`../a/b.zip` → `b.zip`, Windows separators too). */
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** The recipe's `sources[].zip`, as written. */
export function sourceZips(recipe: unknown): string[] {
  const sources = isJsonObject(recipe) ? recipe.sources : undefined;
  return Array.isArray(sources) ? sources.flatMap((source) => (isJsonObject(source) && typeof source.zip === 'string' ? [source.zip] : [])) : [];
}

/** The picked zips by the path the recipe gives each (`sources[].zip`), the recipe's zips no pick matches, the picks it names nowhere. */
export interface MatchedSources {
  sources: Map<string, NamedBlob>;
  missing: string[];
  unused: string[];
}

/** Matches the picked zips to the recipe's sources by file name (exactly, else in any case). */
export function matchSources(recipe: unknown, zips: readonly NamedBlob[]): MatchedSources {
  const sources = new Map<string, NamedBlob>();
  const missing: string[] = [];
  const used = new Set<NamedBlob>();
  for (const zip of sourceZips(recipe)) {
    const name = baseName(zip);
    const found = zips.find((pick) => pick.name === name) ?? zips.find((pick) => pick.name.toLowerCase() === name.toLowerCase());
    if (found === undefined) missing.push(zip);
    else {
      sources.set(zip, found);
      used.add(found);
    }
  }
  return { sources, missing, unused: zips.filter((pick) => !used.has(pick)).map((pick) => pick.name) };
}

/** Rejects with `ir.error.not-zip` for a pick that is no readable zip (only its central directory is read). */
export async function checkZips(zips: readonly NamedBlob[]): Promise<void> {
  const zip = await loadZipJs();
  for (const pick of zips) {
    try {
      await new zip.ZipReader(new zip.BlobReader(pick.blob), { ...NO_WORKERS, filenameValidation: 'tolerant' }).getEntries();
    } catch {
      throw new IrInputError('ir.error.not-zip', { file: pick.name });
    }
  }
}

/** A recipe's file name made of a pack's name: lower case, `a-z 0-9 _ -` (`My Pack` → `my_pack`). */
export function recipeStem(name: string): string {
  const stem = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return stem === '' ? 'recipe' : stem;
}

/** The folder of a new recipe: `packs/`. */
export const NEW_RECIPE_FOLDER = 'packs';

/** A recipe's `sources` for picked zips, laid out as the repository does: `../<zip>`, a root folder each, the zip's name for a label. */
export function sourcesFor(zips: readonly NamedBlob[]): { zip: string; root: string; label: string }[] {
  return zips.map((pick, i) => ({ zip: `../${pick.name}`, root: i === 0 ? 'stock' : `stock_${i + 1}`, label: pick.name.replace(/\.zip$/i, '') }));
}

/**
 * The first draft of a new recipe (the wizard's form starts from it): its name, folder and
 * namespace from the first zip's name, a source for each zip. Keys of schema/recipe.schema.json.
 */
export function draftRecipe(zips: readonly NamedBlob[]): Record<string, unknown> {
  const first = zips[0]?.name.replace(/\.zip$/i, '') ?? 'IR pack';
  const stem = recipeStem(first);
  const words = first.replace(/[^A-Za-z0-9]+/g, ' ').trim();
  return {
    name: words === '' ? 'IR pack' : words,
    pack_dir: words.replace(/ /g, '') || 'IrPack',
    namespace: stem.replace(/-/g, '_').slice(0, 32),
    sources: sourcesFor(zips),
  };
}

/** The source of a recipe made in the editor: `packs/<stem>.json` with `overrides_dir` = its stem, nothing else. */
export function newRecipeSource(recipe: Record<string, unknown>): { source: PackSource; recipePath: string } {
  const stem = recipeStem(typeof recipe.pack_dir === 'string' ? recipe.pack_dir : typeof recipe.name === 'string' ? recipe.name : 'recipe');
  const value = { ...recipe, overrides_dir: typeof recipe.overrides_dir === 'string' && recipe.overrides_dir !== '' ? recipe.overrides_dir : stem };
  const recipePath = `${NEW_RECIPE_FOLDER}/${stem}.json`;
  return { source: new MemoryPack(`${stem}.json`, { [recipePath]: dumpBytes(value) }), recipePath };
}

/** The per-type files among picked files: each `*.json` right inside the folder picked (a folder input gives `mvp/chme3.json`), by file name. */
function perTypeFiles(entries: readonly { path: string; read(): Promise<Uint8Array> }[]): typeof entries {
  const parts = entries.map((entry) => entry.path.split('/'));
  // a folder picked: every path starts with its name; a zip of the folder may do the same
  const prefix = parts.length > 0 && parts.every((p) => p.length > 1 && p[0] === parts[0]?.[0]) ? 1 : 0;
  return entries.filter((_entry, i) => {
    const rest = (parts[i] as string[]).slice(prefix);
    return rest.length === 1 && (rest[0] as string).endsWith('.json') && (rest[0] as string).length > '.json'.length;
  });
}

/**
 * A recipe file and its per-type files (a picked folder's files, or a zip of them; none:
 * only the recipe), put together as the recipe's folder `packs/` holds them. Rejects with
 * {@link IrInputError} for a recipe that is no JSON object, a zip that is none.
 */
export async function fileRecipeSource(recipe: File, overrides: { files: readonly File[] } | { zip: File } | null): Promise<{ source: PackSource; recipePath: string }> {
  const bytes = new Uint8Array(await recipe.arrayBuffer());
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch (error) {
    throw new IrInputError('ir.error.recipe-json', { file: recipe.name, detail: error instanceof Error ? error.message : String(error) });
  }
  if (!isJsonObject(value)) throw new IrInputError('ir.error.recipe-object', { file: recipe.name });
  const name = recipe.name.endsWith('.json') ? recipe.name : `${recipe.name}.json`;
  const recipePath = `${NEW_RECIPE_FOLDER}/${name}`;
  const files: [string, Uint8Array][] = [[recipePath, bytes]];
  const written = typeof value.overrides_dir === 'string' && value.overrides_dir !== '' ? value.overrides_dir : null;
  if (overrides !== null) {
    if (written === null) throw new IrInputError('ir.error.no-overrides-dir', { file: recipe.name });
    const dir = joinPath(NEW_RECIPE_FOLDER, written);
    if (dir === null || dir === '' || dir === NEW_RECIPE_FOLDER) throw new IrInputError('ir.error.overrides-dir-outside', { dir: written });
    let entries: { path: string; read(): Promise<Uint8Array> }[];
    if ('zip' in overrides) {
      let zip: PackSource;
      try {
        zip = await openZipSource(overrides.zip, overrides.zip.name);
      } catch {
        throw new IrInputError('ir.error.not-zip', { file: overrides.zip.name });
      }
      entries = (await zip.list()).map(({ path }) => ({ path, read: () => zip.read(path) }));
    } else {
      entries = overrides.files.map((file) => ({ path: (file.webkitRelativePath || file.name).replaceAll('\\', '/'), read: async () => new Uint8Array(await file.arrayBuffer()) }));
    }
    for (const entry of perTypeFiles(entries)) files.push([`${dir}/${baseName(entry.path)}`, await entry.read()]);
  }
  return { source: new MemoryPack(name, files), recipePath };
}

/** The recipes a folder holds: `*.json` files that read as a recipe (they name a `namespace` and `sources`), in path order. */
export async function findRecipes(source: PackSource): Promise<string[]> {
  const found: string[] = [];
  for (const { path, size } of await source.list()) {
    if (!path.endsWith('.json') || size > 1 << 20 || path.split('/').some((part) => part === 'node_modules' || part.startsWith('.'))) continue;
    try {
      const value = JSON.parse(new TextDecoder().decode(await source.read(path))) as unknown;
      if (isJsonObject(value) && typeof value.namespace === 'string' && Array.isArray(value.sources)) found.push(path);
    } catch {
      // no JSON: no recipe
    }
  }
  return found;
}
