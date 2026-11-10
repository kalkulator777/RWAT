/**
 * A conversion recipe as the editor holds it (editor.md §2.6, §3.5–3.6): the recipe file
 * `packs/<name>.json` and its per-type files `<overrides_dir>/<id>.json` — the markup of an
 * IR pack, no assets (R10). It is the journal's {@link OpTarget}: every edit is an op, undo
 * gives the text back byte for byte, saving writes only the files that changed, and a
 * changed file is its own text with only the changed places edited (core/json/edit.ts),
 * so a `_comment` key and the file's layout stay as the author wrote them.
 *
 * The files are kept by the pack model (core/pack `Pack`), which already does all of
 * that for a pack's JSON files: the recipe's files are handed to it as a source of their
 * own, with an empty `pack.mcmeta` it needs to open (it finds a pack by that file); the
 * stand-in is never listed, written or exported here.
 *
 * Paths are those of the source the recipe was opened from (`packs/mvp.json`,
 * `packs/mvp/chme3.json`): the same layout comes out of a save and of the export.
 *
 * The per-type files are read as the converter reads them: every `*.json` right inside
 * the recipe's `overrides_dir` (relative to the recipe's folder), the file's stem the
 * type's id. A folder elsewhere than under the source's root cannot be opened from it.
 */

import type { FileChange, Op, OpTarget, PackSink, PackSource, Problem } from '../../core/contracts';
import { MCMETA, Pack } from '../../core/pack';
import { isJsonObject } from '../../core/json';
import { packPathProblem } from '../../core/paths';

/** The stand-in `pack.mcmeta` the pack model needs to open the recipe's files. */
const STAND_IN = new TextEncoder().encode('{}\n');

/** The folder part of a path (`packs/mvp.json` → `packs`), `''` at the root. */
function folderOf(path: string): string {
  const at = path.lastIndexOf('/');
  return at < 0 ? '' : path.slice(0, at);
}

/** `folder/relative` with `.` and `..` worked out, or null when it leaves the root (or is absolute). */
export function joinPath(folder: string, relative: string): string | null {
  if (relative.startsWith('/') || relative.includes('\\') || /^[A-Za-z]:/.test(relative)) return null;
  const parts = folder === '' ? [] : folder.split('/');
  for (const part of relative.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join('/');
}

/** The source as the pack model sees it: the recipe's files and the stand-in `pack.mcmeta`, nothing else. */
class RecipeSource implements PackSource {
  readonly kind;
  readonly writable;
  readonly name;

  constructor(
    private readonly source: PackSource,
    private readonly files: readonly { path: string; size: number }[],
  ) {
    this.kind = source.kind;
    this.writable = source.writable;
    this.name = source.name;
  }

  list(): Promise<{ path: string; size: number }[]> {
    return Promise.resolve([{ path: MCMETA, size: STAND_IN.length }, ...this.files]);
  }

  read(path: string): Promise<Uint8Array> {
    return path === MCMETA ? Promise.resolve(STAND_IN.slice()) : this.source.read(path);
  }
}

export type RecipeErrorCode =
  /** No recipe file at the path given. */
  | 'no-recipe'
  /** The path given is no `.json` path inside the source, or no field an edit can write. */
  | 'bad-path'
  /** A door id that can't be one (a comment key), a door that isn't there or is already. */
  | 'bad-door'
  /** A conversion that would change what the converter makes of the file. */
  | 'not-lossless'
  /** A per-type file whose text is no JSON object: an edit would write over it. */
  | 'broken-file';

export class RecipeError extends Error {
  constructor(
    readonly code: RecipeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RecipeError';
  }
}

export class RecipeWorkspace implements OpTarget {
  private constructor(
    private readonly pack: Pack,
    /** The recipe's path in the source: `packs/mvp.json`. */
    readonly recipePath: string,
  ) {}

  /**
   * Opens a recipe: the file at `recipePath` of the source and the per-type files of its
   * `overrides_dir`. Rejects with {@link RecipeError} when there is no such recipe; a
   * recipe whose text is not JSON opens, with a problem ({@link problems}).
   */
  static async open(source: PackSource, recipePath: string): Promise<RecipeWorkspace> {
    if (packPathProblem(recipePath) !== null || !recipePath.endsWith('.json') || recipePath === MCMETA) {
      throw new RecipeError('bad-path', `${JSON.stringify(recipePath)} is no path of a recipe (a .json file inside the folder opened)`);
    }
    const entries = await source.list();
    const recipe = entries.find((entry) => entry.path === recipePath);
    if (recipe === undefined) throw new RecipeError('no-recipe', `no recipe ${recipePath} in ${source.name}`);
    let dir: string | null = null;
    try {
      const value = JSON.parse(new TextDecoder().decode(await source.read(recipePath))) as unknown;
      dir = isJsonObject(value) ? overridesFolder(recipePath, value) : null;
    } catch {
      // not JSON: the pack model reports it; no per-type files are read
    }
    const files = [recipe, ...entries.filter((entry) => dir !== null && isOverrideFile(dir, entry.path))];
    const pack = await Pack.open(new RecipeSource(source, files.map(({ path, size }) => ({ path, size }))));
    return new RecipeWorkspace(pack, recipePath);
  }

  /** Grows with every change: a cheap key for caches. */
  get version(): number {
    return this.pack.version;
  }

  // ------------------------------------------------------------ reading

  /** The recipe's value as it stands; `{}` when its text is not JSON or no object. */
  recipe(): Record<string, unknown> {
    const value = this.pack.json(this.recipePath);
    return isJsonObject(value) ? value : {};
  }

  /**
   * The folder of the per-type files, a path in the source (`packs/mvp`): the recipe's
   * `overrides_dir` as it stands, or null without one or when it leaves the source.
   */
  get overridesDir(): string | null {
    return overridesFolder(this.recipePath, this.recipe());
  }

  /** The folder a recipe without `overrides_dir` gets with its first per-type file: named as the recipe (`packs/mine.json` → `mine`). */
  get defaultOverridesDir(): string {
    const name = this.recipePath.slice(this.recipePath.lastIndexOf('/') + 1, -'.json'.length);
    return name;
  }

  /** The per-type file of a type: `<overrides_dir>/<id>.json` (with the default folder when the recipe names none). */
  overridePath(id: string): string {
    const dir = this.overridesDir ?? joinPath(folderOf(this.recipePath), this.defaultOverridesDir);
    return `${dir === null || dir === '' ? '' : `${dir}/`}${id}.json`;
  }

  /** The ids of the types with a per-type file, in id order. */
  overrideIds(): string[] {
    const dir = this.overridesDir;
    if (dir === null) return [];
    return this.pack
      .paths()
      .filter((path) => isOverrideFile(dir, path))
      .map((path) => path.slice(dir.length + 1, -'.json'.length))
      .sort();
  }

  /** The per-type file's value as it stands, comments and all; undefined when the type has none (or its text is not JSON). */
  override(id: string): Record<string, unknown> | undefined {
    const value = this.pack.json(this.overridePath(id));
    return isJsonObject(value) ? value : undefined;
  }

  /** The recipe's own `overrides.<id>`, if any. */
  inline(id: string): Record<string, unknown> | undefined {
    const overrides = this.recipe().overrides;
    const value = isJsonObject(overrides) ? overrides[id] : undefined;
    return isJsonObject(value) ? value : undefined;
  }

  has(path: string): boolean {
    return path !== MCMETA && this.pack.has(path);
  }

  /** The recipe and its per-type files as they stand, in path order. */
  paths(): string[] {
    return this.pack.paths().filter((path) => path !== MCMETA);
  }

  /** The file's JSON value as it stands (shared: never change it in place). */
  json(path: string): unknown {
    return path === MCMETA ? undefined : this.pack.json(path);
  }

  /** The file's text as saving would write it. */
  text(path: string): Promise<string> {
    return this.pack.text(path);
  }

  bytes(path: string): Promise<Uint8Array> {
    return this.pack.bytes(path);
  }

  /** Files whose text is not JSON, an `overrides_dir` that leaves the folder opened. */
  problems(): Problem[] {
    const problems = this.pack.problems().filter((problem) => !problem.at.some((link) => link.kind === 'file' && link.file === MCMETA));
    const dir = this.recipe().overrides_dir;
    if (typeof dir === 'string' && this.overridesDir === null) {
      problems.push({
        severity: 'warning',
        source: 'loader',
        code: 'recipe.overrides-outside',
        params: { dir },
        text: `${this.recipePath}: "overrides_dir" ${JSON.stringify(dir)} is outside the folder opened: no per-type files read`,
        at: [{ kind: 'field', file: this.recipePath, at: '/overrides_dir' }],
      });
    }
    return problems;
  }

  // ------------------------------------------------------------ edits (OpTarget)

  /** Applies one op to the recipe's files (the journal's target); the stand-in `pack.mcmeta` is not one of them. */
  apply(op: Op): Op[] {
    if (op.file === MCMETA || (op.op === 'renameFile' && op.to === MCMETA)) {
      throw new RecipeError('bad-path', `${MCMETA} is no file of a recipe`);
    }
    return this.pack.apply(op);
  }

  prepare(ops: readonly Op[]): Promise<void> {
    return this.pack.prepare(ops);
  }

  // ------------------------------------------------------------ saving

  /** What saving would do to the file: `unchanged`, `changed`, `new`, `deleted`. */
  status(path: string): ReturnType<Pack['status']> {
    return this.pack.status(path);
  }

  /** The file's bytes as opened or last saved (what saving compares with, the save dialog's "before"); null for a file there was not then. */
  originalBytes(path: string): Promise<Uint8Array | null> {
    return this.pack.originalBytes(path);
  }

  /**
   * Takes every file as never saved: a recipe the editor made (the IR import's wizard) is
   * in no folder yet, so its first save writes each of its files as new. Call it before
   * the first edit.
   */
  async markUnsaved(): Promise<void> {
    for (const path of this.paths()) await this.pack.rebase(path, null);
  }

  /** The files saving would write or delete, in path order. */
  dirtyPaths(): string[] {
    return this.pack.dirtyPaths();
  }

  /** What saving writes: each changed file's bytes (its own text, minimally edited), or its deletion. */
  changes(): Promise<FileChange[]> {
    return this.pack.changes();
  }

  /** Writes the changes to the sink; what was written becomes the state as opened. */
  save(sink: PackSink): Promise<FileChange[]> {
    return this.pack.save(sink);
  }

  /** The recipe and its per-type files as they stand, in path order: what the export packs. */
  async snapshot(): Promise<{ path: string; bytes: Uint8Array }[]> {
    const files: { path: string; bytes: Uint8Array }[] = [];
    for (const path of this.paths()) files.push({ path, bytes: await this.pack.bytes(path) });
    return files;
  }
}

/** The per-type files' folder of a recipe value, a path in the source, or null. */
function overridesFolder(recipePath: string, recipe: Record<string, unknown>): string | null {
  const dir = recipe.overrides_dir;
  if (typeof dir !== 'string' || dir === '') return null;
  const folder = joinPath(folderOf(recipePath), dir);
  return folder === '' ? null : folder; // the source's root itself: not a folder of per-type files here
}

/** True for a per-type file of the folder: a `.json` right inside it, as `folder.glob("*.json")` finds them. */
function isOverrideFile(dir: string, path: string): boolean {
  if (!path.startsWith(`${dir}/`) || !path.endsWith('.json')) return false;
  const name = path.slice(dir.length + 1);
  return !name.includes('/') && name.length > '.json'.length;
}
