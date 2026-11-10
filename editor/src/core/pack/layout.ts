/**
 * Where things live in an RWAT pack (schema/pack-layout.json `files` and `lang_keys`):
 * which file is a declaration of what id, which is a lang file, how the lang keys are
 * spelled, where the pack's root is when it was zipped inside a folder.
 */

import { MCMETA } from '../paths';

/** The pack's metadata file at its root (pack-layout.json `files`); the constant is core/paths.ts's. */
export { MCMETA };

/** The file tools/ir2rwat.py writes into a pack it generated (`MARKER`): such a pack is edited through its recipe. */
export const CONVERSION_MARKER = 'RWAT_CONVERSION.txt';

/** The newest `rwat.format` this editor writes and the engine reads (`pack/RwatPackMeta.SUPPORTED_FORMAT`, `ir2rwat.RWAT_FORMAT`). */
export const SUPPORTED_FORMAT = 1;

/** How a file is held: JSON is read and parsed when the pack opens, the rest when asked for. */
export type FileKind = 'json' | 'text' | 'binary';

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'obj', 'mtl', 'anim']);

/** The kind of a file by its name: `.json` and `.mcmeta` are JSON; OBJ, MTL, `.anim` and plain text are text; the rest binary. */
export function fileKind(path: string): FileKind {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  const extension = dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
  if (extension === 'json' || extension === 'mcmeta') return 'json';
  return TEXT_EXTENSIONS.has(extension) ? 'text' : 'binary';
}

/** The three declarations of pack-layout.json and the lang files. */
export type DeclarationKind = 'wagon_type' | 'wagon_model' | 'rail_model' | 'lang';

/** A file the mod reads as a declaration or a lang file. */
export interface Declaration {
  kind: DeclarationKind;
  path: string;
  namespace: string;
  /** `<namespace>:<id>` of a type, model or rail style; the id may hold folders (`ns:sub/coach`), as Minecraft's resource ids do. */
  id?: string;
  /** The language of a lang file: `en_us`, `ru_ru`. */
  lang?: string;
}

const DECLARATIONS: [RegExp, DeclarationKind][] = [
  [/^data\/([^/]+)\/wagon_types\/(.+)\.json$/, 'wagon_type'],
  [/^assets\/([^/]+)\/wagon_models\/(.+)\.json$/, 'wagon_model'],
  [/^assets\/([^/]+)\/rail_models\/(.+)\.json$/, 'rail_model'],
];

const LANG = /^assets\/([^/]+)\/lang\/([^/]+)\.json$/;

/** What the file is to the mod (its folders as tools/validate_pack.py reads them), or null for anything else. */
export function classify(path: string): Declaration | null {
  for (const [pattern, kind] of DECLARATIONS) {
    const match = pattern.exec(path);
    if (match !== null) return { kind, path, namespace: match[1] as string, id: `${match[1]}:${match[2]}` };
  }
  const lang = LANG.exec(path);
  if (lang !== null) return { kind: 'lang', path, namespace: lang[1] as string, lang: lang[2] as string };
  return null;
}

function splitId(id: string): [string, string] {
  const colon = id.indexOf(':');
  if (colon <= 0 || colon === id.length - 1) throw new RangeError(`not a namespaced id: ${JSON.stringify(id)}`);
  return [id.slice(0, colon), id.slice(colon + 1)];
}

/** The file of a wagon type: `data/<ns>/wagon_types/<id>.json`. */
export function typePath(id: string): string {
  const [namespace, name] = splitId(id);
  return `data/${namespace}/wagon_types/${name}.json`;
}

/** The file of a wagon model: `assets/<ns>/wagon_models/<id>.json`. */
export function modelPath(id: string): string {
  const [namespace, name] = splitId(id);
  return `assets/${namespace}/wagon_models/${name}.json`;
}

/** The file of a rail style: `assets/<ns>/rail_models/<id>.json`. */
export function railPath(id: string): string {
  const [namespace, name] = splitId(id);
  return `assets/${namespace}/rail_models/${name}.json`;
}

/** The lang file of a namespace: `assets/<ns>/lang/<lang>.json`. */
export function langPath(namespace: string, lang: string): string {
  return `assets/${namespace}/lang/${lang}.json`;
}

/** The lang key of a wagon type's name: `wagon.<ns>.<id>` (`RollingStockItem.stockName`). */
export function wagonNameKey(typeId: string): string {
  return `wagon.${typeId.replace(':', '.')}`;
}

/** The lang key of a rail style's name: `rail.<ns>.<id>`. */
export function railNameKey(styleId: string): string {
  return `rail.${styleId.replace(':', '.')}`;
}

/** The lang key of a light group's name on a type: `light.<ns>.<id>.<group>` (`LightNames.of`; the group as the OBJ spells it). */
export function lightNameKey(typeId: string, group: string): string {
  return `light.${typeId.replace(':', '.')}.${group}`;
}

/** Where the pack is in what was opened: its root folder (`''` at the top, `MyPack/` when zipped inside a folder). */
export type PackRoot = { root: string } | { problem: 'not-a-pack' } | { problem: 'several-packs'; roots: string[] };

/**
 * The pack's root among the paths a source lists. `pack.mcmeta` at the top: the top.
 * Otherwise the folder of the one `pack.mcmeta` nearest the top, when every other one
 * lies inside it (a pack zipped in its folder, a backup inside it), as tools/ir2rwat.py
 * `pack_wrapper` finds an IR pack in its zip; two side by side are two packs.
 */
export function findPackRoot(paths: Iterable<string>): PackRoot {
  const roots: string[] = [];
  for (const path of paths) {
    if (path === MCMETA) return { root: '' };
    if (path.endsWith(`/${MCMETA}`)) roots.push(path.slice(0, -MCMETA.length));
  }
  if (roots.length === 0) return { problem: 'not-a-pack' };
  const nearest = roots.reduce((a, b) => (b.length < a.length ? b : a));
  if (roots.every((root) => root.startsWith(nearest))) return { root: nearest };
  const outermost = roots.filter((root) => !roots.some((other) => other !== root && root.startsWith(other)));
  return { problem: 'several-packs', roots: [...new Set(outermost)].sort() };
}
