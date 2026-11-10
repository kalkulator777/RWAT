/**
 * «Переименовать и переписать ссылки» (docs/proposals/editor.md §2.1, M6): the files whose
 * paths Minecraft refuses as resource locations (a capital, a space, anything outside
 * `a-z 0-9 _ . -`: the loader's `loader.resource-path` finding) renamed the way the
 * converter names the files it copies (`ir2rwat.resource_part`: lower case, every other
 * character `_`, per part of the path), and the references to them rewritten to follow:
 *
 * - an OBJ's `mtllib` and an MTL's `map_Kd`, paths relative to the OBJ's folder, rewritten
 *   by the converter's own `rewrite_references` (through the bridge: the lines it touches
 *   and every other byte as it was) — only where a renamed file, or the folder the OBJ
 *   moved to, breaks one (`ir2rwat.relink`);
 * - the declarations' (`wagon_models/`, `rail_models/`) references to files, a resource
 *   location each (`obj`, `animations`, the sounds' `.ogg`), and the livery folders (relative
 *   to the OBJ, as the engine finds them) — JSON edits through the journal.
 *
 * {@link planRename} works out what would change without any Python and without changing
 * anything: that list is what the author reads before applying. {@link renameCommand} turns
 * the plan and the rewritten files into one command of the journal, undone in one step, the
 * pack back byte for byte.
 *
 * What is **not** renamed, and is told: files with a namespace Minecraft refuses (renaming it
 * renames every id), declarations, lang files and everything under `data/` (their names are
 * ids of wagons: renaming a wagon is another action), a file whose new name is taken by another
 * file, and two files that would get the same name. (A new name never reads as another kind of
 * file: `fileKind` goes by an extension in lower case, which only ASCII letters make a kind of.)
 */

import { isBadResourcePath } from '../../checks/loader';
import type { Command, Op } from '../../core/contracts';
import { childPointer, isJsonObject } from '../../core/json';
import type { Pack } from '../../core/pack';
import * as Mtl from '../../ports/mtl';

/** What of the pack the plan reads. */
export type RenamePack = Pick<Pack, 'paths' | 'has' | 'json' | 'text' | 'version'>;

/** A character Minecraft doesn't take in a resource path (`ir2rwat.NOT_IN_PATH`); by code point, as Python's `re` is. */
const NOT_IN_PATH = /[^a-z0-9_.-]/gu;
/** A namespace Minecraft takes. */
const NAMESPACE = /^[a-z0-9_.-]+$/;

/** One part of a path as Minecraft takes it: lower case, `a-z 0-9 _ . -` only (`ir2rwat.resource_part`). */
export function resourcePart(part: string): string {
  return part.toLowerCase().replace(NOT_IN_PATH, '_');
}

/** The path from folder `folder` to `path`, both inside the namespace (`posixpath.relpath(path, folder)`). */
export function relativeTo(folder: string, path: string): string {
  const from = folder === '' ? [] : folder.split('/');
  const to = path.split('/');
  let common = 0;
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++;
  return [...from.slice(common).map(() => '..'), ...to.slice(common)].join('/');
}

/** Why a file with a bad path is left as it is. */
export type SkipReason =
  /** Its namespace is one Minecraft refuses: renaming it renames every id of the pack. */
  | 'namespace'
  /** A declaration, a lang file or data: its name is an id. */
  | 'declaration'
  /** Another file would get the same name. */
  | 'clash'
  /** A file of the new name is there. */
  | 'exists';

/** A file left as it is. */
export interface Skipped {
  readonly path: string;
  readonly reason: SkipReason;
  /** The name it would get; absent for a namespace and a declaration. */
  readonly to?: string;
}

/** An OBJ's or MTL's references to rewrite: the text rewritten by the converter's `rewrite_references`. */
export interface TextRewrite {
  /** The file's path now (its bytes are read from there). */
  readonly file: string;
  /** Its path once the renames are done (the rewritten bytes are put there). */
  readonly target: string;
  /** The line keyword whose path is rewritten: `mtllib` (OBJ) or `map_Kd` (MTL). */
  readonly keyword: 'mtllib' | 'map_Kd';
  /** The path as written → the path to write. */
  readonly moved: Readonly<Record<string, string>>;
}

/** A declaration's reference to rewrite. */
export interface JsonRewrite {
  readonly file: string;
  /** The place of the string in the file (JSON pointer). */
  readonly at: string;
  readonly from: string;
  readonly to: string;
}

/** A thing the plan can't do for the author, or can't be sure of. */
export type RenameNote =
  /** An MTL shared by OBJs in folders that need different paths in it: left as it is. */
  | { readonly kind: 'shared'; readonly file: string }
  /** `sounds.json` mentions the renamed sound: its event is the author's to rewrite. */
  | { readonly kind: 'sounds'; readonly file: string; readonly sound: string };

/** What renaming would do; nothing is changed by making it. */
export interface RenamePlan {
  /** The pack's {@link Pack.version} it was made for. */
  readonly version: number;
  readonly renames: readonly { readonly from: string; readonly to: string }[];
  readonly skipped: readonly Skipped[];
  readonly texts: readonly TextRewrite[];
  readonly jsons: readonly JsonRewrite[];
  readonly notes: readonly RenameNote[];
}

/** The name a file with a bad path would get, or why it keeps its own. */
function newName(path: string): { to: string } | { reason: SkipReason } {
  const [root = '', namespace = '', ...rest] = path.split('/');
  if (root !== 'assets') return { reason: 'declaration' };
  if (!NAMESPACE.test(namespace)) return { reason: 'namespace' };
  if (['wagon_models', 'rail_models', 'lang'].includes(rest[0] ?? '')) return { reason: 'declaration' };
  return { to: `assets/${namespace}/${rest.map(resourcePart).join('/')}` };
}

/** The `mtllib` paths of an OBJ's text as the converter's `rewrite_references` reads them (`mtllib <path>` lines), in order, each once. */
export function mtllibs(text: string): string[] {
  const found = new Set<string>();
  for (const line of Mtl.javaLines(text)) {
    const trimmed = Mtl.javaTrim(line);
    if (trimmed.startsWith('mtllib ')) found.add(Mtl.javaTrim(trimmed.slice('mtllib '.length)));
  }
  return [...found];
}

/** `assets/<ns>/<rest>` → [`<ns>`, `<rest>`]; null for any other path. */
function inNamespace(path: string): [string, string] | null {
  const match = /^assets\/([^/]+)\/(.+)$/.exec(path);
  return match === null ? null : [match[1] as string, match[2] as string];
}

/**
 * What renaming the pack's bad paths would do (see the file's head): the renames, the files
 * left as they are with the reason, the references to rewrite in OBJ and MTL texts and in
 * the declarations. Reads the OBJ, MTL and declaration files; changes nothing.
 */
export async function planRename(pack: RenamePack): Promise<RenamePlan> {
  const paths = pack.paths();
  const have = new Set(paths);
  const skipped: Skipped[] = [];
  const wanted: { from: string; to: string }[] = [];
  for (const path of paths) {
    if (!isBadResourcePath(path)) continue;
    const name = newName(path);
    if ('reason' in name) skipped.push({ path, reason: name.reason });
    else wanted.push({ from: path, to: name.to });
  }
  const renames: { from: string; to: string }[] = [];
  for (const entry of wanted) {
    if (wanted.some((other) => other !== entry && other.to === entry.to)) skipped.push({ path: entry.from, reason: 'clash', to: entry.to });
    else if (have.has(entry.to)) skipped.push({ path: entry.from, reason: 'exists', to: entry.to });
    else renames.push(entry);
  }
  const moved = new Map(renames.map(({ from, to }) => [from, to]));
  const after = (path: string): string => moved.get(path) ?? path;

  const texts: TextRewrite[] = [];
  const jsons: JsonRewrite[] = [];
  const notes: RenameNote[] = [];
  // nothing moves, so no reference breaks: the OBJs are not even read
  if (renames.length === 0) return { version: pack.version, renames, skipped, texts, jsons, notes };

  // OBJ → MTL (`mtllib`) and MTL → texture (`map_Kd`), both relative to the OBJ's folder
  const mtlNeeds = new Map<string, { written: string; needs: (string | null)[] }[]>();
  for (const obj of paths) {
    const place = inNamespace(obj);
    if (place === null || !obj.toLowerCase().endsWith('.obj')) continue;
    const [namespace, rel] = place;
    const folder = Mtl.folderOf(rel);
    const target = inNamespace(after(obj)) as [string, string];
    const newFolder = Mtl.folderOf(target[1]);
    /** The path to write for `written` (a path relative to the OBJ's folder) once its file is renamed; null when the path still leads there. */
    const follow = (written: string): { file: string; now: string | null } | null => {
      const resolved = Mtl.resolve(folder, written);
      const file = resolved === null ? null : `assets/${namespace}/${resolved}`;
      if (file === null || !have.has(file)) return null;
      const rewritten = inNamespace(after(file)) as [string, string];
      return { file, now: Mtl.resolve(newFolder, written) === rewritten[1] ? null : relativeTo(newFolder, rewritten[1]) };
    };
    const libraries: Record<string, string> = {};
    for (const written of mtllibs(await pack.text(obj))) {
      const next = follow(written);
      if (next === null) continue;
      if (next.now !== null) libraries[written] = next.now;
      const textures = mtlNeeds.get(next.file) ?? [];
      for (const texture of new Set(Mtl.parse(await pack.text(next.file)).values())) {
        const need = follow(texture);
        if (need === null) continue;
        const known = textures.find((entry) => entry.written === texture);
        if (known === undefined) textures.push({ written: texture, needs: [need.now] });
        else known.needs.push(need.now);
      }
      mtlNeeds.set(next.file, textures);
    }
    if (Object.keys(libraries).length > 0) texts.push({ file: obj, target: after(obj), keyword: 'mtllib', moved: libraries });
  }
  for (const [file, textures] of mtlNeeds) {
    const settled: Record<string, string> = {};
    let shared = false;
    for (const { written, needs } of textures) {
      if (needs.some((need) => need !== needs[0])) shared = true;
      else if (needs[0] !== null && needs[0] !== undefined) settled[written] = needs[0];
    }
    if (shared) notes.push({ kind: 'shared', file });
    else if (Object.keys(settled).length > 0) texts.push({ file, target: after(file), keyword: 'map_Kd', moved: settled });
  }

  // the declarations: a resource location each, and the livery folders next to the OBJ
  for (const file of paths) {
    const place = inNamespace(file);
    if (place === null || !/^(?:wagon_models|rail_models)\/.+\.json$/.test(place[1])) continue;
    const declaration = pack.json(file);
    if (!isJsonObject(declaration)) continue;
    const namespace = place[0];
    const reference = (value: string): { file: string; qualified: boolean } => {
      const colon = value.indexOf(':');
      return colon < 0 ? { file: `assets/${namespace}/${value}`, qualified: false } : { file: `assets/${value.slice(0, colon) || 'minecraft'}/${value.slice(colon + 1)}`, qualified: true };
    };
    const walk = (value: unknown, at: string): void => {
      if (typeof value === 'string') {
        if (at.startsWith('/liveries/')) return;
        const target = reference(value);
        const to = moved.get(target.file);
        if (to === undefined) return;
        const [targetNamespace, rest] = inNamespace(to) as [string, string];
        jsons.push({ file, at, from: value, to: target.qualified ? `${targetNamespace}:${rest}` : rest });
      } else if (Array.isArray(value)) {
        value.forEach((item, i) => walk(item, childPointer(at, i)));
      } else if (isJsonObject(value)) {
        for (const [key, item] of Object.entries(value)) walk(item, childPointer(at, key));
      }
    };
    walk(declaration, '');
    const model = typeof declaration.obj === 'string' ? reference(declaration.obj).file : null;
    const modelPlace = model === null || !have.has(model) ? null : inNamespace(model);
    if (modelPlace !== null && isJsonObject(declaration.liveries)) {
      const folder = Mtl.folderOf(modelPlace[1]);
      const newFolder = Mtl.folderOf((inNamespace(after(model as string)) as [string, string])[1]);
      for (const [id, value] of Object.entries(declaration.liveries)) {
        if (typeof value !== 'string') continue;
        const resolved = Mtl.resolve(folder, value);
        if (resolved === null) continue;
        // the folder is renamed with the files in it
        const prefix = `assets/${modelPlace[0]}/${resolved}/`;
        const inside = renames.find(({ from }) => from.startsWith(prefix));
        const renamed = inside === undefined ? resolved : resolved.split('/').map(resourcePart).join('/');
        if (Mtl.resolve(newFolder, value) === renamed) continue;
        jsons.push({ file, at: childPointer('/liveries', id), from: value, to: relativeTo(newFolder, renamed) });
      }
    }
  }

  // a sound that sounds.json may name by the old name
  for (const { from } of renames) {
    const place = inNamespace(from);
    if (place === null || !place[1].startsWith('sounds/')) continue;
    const events = `assets/${place[0]}/sounds.json`;
    const stem = from.slice(from.lastIndexOf('/') + 1).replace(/\.[^.]*$/, '');
    if (have.has(events) && JSON.stringify(pack.json(events) ?? null).includes(stem)) notes.push({ kind: 'sounds', file: events, sound: from });
  }

  return { version: pack.version, renames, skipped, texts, jsons, notes };
}

/** True when the plan changes nothing. */
export function isEmptyPlan(plan: RenamePlan): boolean {
  return plan.renames.length === 0 && plan.texts.length === 0 && plan.jsons.length === 0;
}

/** How many references the plan rewrites (the lines of the OBJs and MTLs, the strings of the declarations). */
export function referenceCount(plan: RenamePlan): number {
  return plan.texts.reduce((sum, text) => sum + Object.keys(text.moved).length, 0) + plan.jsons.length;
}

/**
 * The command that does the plan: the files renamed, the OBJ and MTL texts put (the
 * converter's rewrite of each, `rewritten` by the path of {@link TextRewrite.file}), the
 * declarations' strings set. One entry of the journal; its undo gives every file back
 * as it was, byte for byte. Apply it with `run` (what the undo needs is read first).
 */
export function renameCommand(plan: RenamePlan, rewritten: ReadonlyMap<string, Uint8Array>): Command {
  const ops: Op[] = plan.renames.map(({ from, to }) => ({ op: 'renameFile', file: from, to }));
  for (const text of plan.texts) {
    const bytes = rewritten.get(text.file);
    if (bytes !== undefined) ops.push({ op: 'putFile', file: text.target, bytes });
  }
  for (const json of plan.jsons) ops.push({ op: 'set', file: json.file, at: json.at, value: json.to });
  return { label: 'tools.suggest.cmd.rename', labelParams: { files: plan.renames.length, refs: referenceCount(plan) }, ops };
}
