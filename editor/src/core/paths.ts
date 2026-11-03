/**
 * Paths inside a pack (docs/proposals/editor.md §3.2, `core/contracts.ts` `FileEntry`).
 * A pure module that both core/ (the pack model checks the paths of its ops) and io/
 * (sources and sinks check the names they list and write) import.
 *
 * A pack path is '/'-separated, relative, spelled as the file spells it (the case is
 * kept) and never leaves the pack: no leading '/', no drive letter, no '.' or '..'
 * part, no empty part. Every source checks the names it lists and every sink the names
 * it is asked to write, so a crafted zip (`../../x`, "zip slip") or a changed path can
 * neither be read into the editor nor be written outside the pack folder. The rule is
 * the converter's (`tools/ir2rwat.py` `safe_relative`), plus control characters.
 */

/** Why a name is not a path inside a pack. */
export type PathProblem =
  /** Nothing, or only '.' and empty parts. */
  | 'empty'
  /** Starts with '/' (or '\\' in an archive: root-relative and UNC paths on Windows). */
  | 'absolute'
  /** Starts with a drive letter, `C:`. */
  | 'drive'
  /** Has a `..` part: climbs out of the pack. */
  | 'parent'
  /** Has a '.' part or an empty one (`a//b`, `a/./b`): not the spelling of a pack path, though the same file. */
  | 'not-normal'
  /** Has a backslash. */
  | 'backslash'
  /** Has a control character (code below 32, or 127). */
  | 'control';

// eslint-disable-next-line no-control-regex -- control characters are exactly what this looks for
const CONTROL = /[\u0000-\u001f\u007f]/;
const DRIVE = /^[A-Za-z]:/;

/**
 * Why `path` is not an already normal pack path (the spelling a source lists and a sink
 * accepts), or null when it is one.
 */
export function packPathProblem(path: string): PathProblem | null {
  if (path === '') return 'empty';
  if (path.startsWith('/')) return 'absolute';
  if (DRIVE.test(path)) return 'drive';
  if (path.includes('\\')) return 'backslash';
  if (CONTROL.test(path)) return 'control';
  for (const part of path.split('/')) {
    if (part === '..') return 'parent';
    if (part === '' || part === '.') return 'not-normal';
  }
  return null;
}

/** True for a normal pack path (see {@link packPathProblem}). */
export function isPackPath(path: string): boolean {
  return packPathProblem(path) === null;
}

/** The result of {@link normalizeEntryName}: the pack path, or why the name is unsafe. */
export type NormalizedName = { path: string } | { problem: PathProblem };

/**
 * A name as an archive or a file picker spells it → the pack path it means. More
 * tolerant than {@link packPathProblem}, as the converter is with the IR zips it reads:
 * backslashes (some Windows zippers write them) are slashes, and '.' and empty parts are
 * dropped (`./a//b` is `a/b`). A name that is absolute, has a drive letter or a `..`
 * part, or a control character, is never a path inside the pack.
 */
export function normalizeEntryName(name: string): NormalizedName {
  const slashed = name.replaceAll('\\', '/');
  if (slashed.startsWith('/')) return { problem: 'absolute' };
  if (DRIVE.test(slashed)) return { problem: 'drive' };
  if (CONTROL.test(slashed)) return { problem: 'control' };
  const parts = slashed.split('/').filter((part) => part !== '' && part !== '.');
  if (parts.includes('..')) return { problem: 'parent' };
  if (parts.length === 0) return { problem: 'empty' };
  return { path: parts.join('/') };
}

/**
 * Order of paths in every list and every archive: by Unicode code point, which is how
 * Python sorts the converter's `str` paths (`sorted(contents, key=path)` in
 * `write_zip`); JavaScript's own `<` compares UTF-16 units and differs above U+FFFF.
 */
export function comparePaths(a: string, b: string): number {
  if (a === b) return 0;
  const left = a[Symbol.iterator]();
  const right = b[Symbol.iterator]();
  for (;;) {
    const x = left.next();
    const y = right.next();
    if (x.done || y.done) return x.done ? (y.done ? 0 : -1) : 1;
    const delta = (x.value.codePointAt(0) ?? 0) - (y.value.codePointAt(0) ?? 0);
    if (delta !== 0) return delta;
  }
}

/** The pack's metadata file; the converter writes it last, so a folder cut short is not yet a pack (`ir2rwat.Converter.contents`). */
export const MCMETA = 'pack.mcmeta';

/** `comparePaths`, but `pack.mcmeta` after everything else: the order a folder is written in. */
export function compareForWriting(a: string, b: string): number {
  const last = Number(a === MCMETA) - Number(b === MCMETA);
  return last !== 0 ? last : comparePaths(a, b);
}

/** The folder part of a pack path (`a/b/c.json` → `a/b`); '' for a file at the top. */
export function parentPath(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

/** A namespace Minecraft takes in a resource location (`ResourceLocation`): lower-case letters, digits and `_ . -`. */
export const RESOURCE_NAMESPACE = /^[a-z0-9_.-]+$/;

/** A path Minecraft takes in a resource location (`ResourceLocation`): as a namespace, and `/` besides. */
export const RESOURCE_PATH = /^[a-z0-9_./-]+$/;

/**
 * True for a pack path Minecraft loads as a resource: `assets/<namespace>/<path>` or
 * `data/<namespace>/<path>`, the namespace and the path as {@link RESOURCE_NAMESPACE} and
 * {@link RESOURCE_PATH} take them. The loader's checks (checks/loader) say which files the
 * game will not load; the model pipeline (model/resources) reads a location the game takes
 * only.
 */
export function isResourcePath(path: string): boolean {
  const match = /^(?:assets|data)\/([^/]+)\/(.+)$/.exec(path);
  return match !== null && RESOURCE_NAMESPACE.test(match[1] as string) && RESOURCE_PATH.test(match[2] as string);
}
