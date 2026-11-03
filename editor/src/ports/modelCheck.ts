/**
 * The files a wagon model declaration names, checked all at once: port of
 * `pack/ModelCheck.java` (`check`), the offline check of `/rwatc packs validate`, which the
 * game otherwise shows only when the wagon first comes into view. Golden:
 * fixtures/golden/model_check/ (reference Java, `ModelCheckGolden`).
 *
 * Read by the ports of the readers the game draws with (./obj.ts, ./mtl.ts, ./anim.ts).
 * Errors: the OBJ path is no resource location or the file is missing, a face index points
 * at no vertex, the model has no faces or none that draws (no textured material), a
 * material library, a texture or an animation is invalid, missing or unreadable.
 * Warnings: drawn faces whose material has no texture (`map_Kd`) — they aren't drawn — but
 * for a hinge marker (`<KEY>_ROT…` of a control or a door leaf), which the model loader
 * reads for its axis textured or not; a control group longer than {@link MAX_GROUP_LENGTH}
 * characters, which the loader drops; a livery that replaces no texture.
 *
 * The engine gives only a line of English (`PackProblem`). Here each finding has a stable
 * {@link ModelCode}, the params its line is made of and the line itself, built from them
 * ({@link modelFindingText}) word for word as the engine's — the JVM's own words of why a
 * file doesn't read included: the OBJ's and the `.anim`'s refusals (./obj.ts `ObjError`,
 * ./anim.ts `AnimError`) are put as the exception the engine's reader throws there
 * (`Index 8 out of bounds for length 4`, `java.lang.NumberFormatException: For input
 * string: "x"`); a file that fails to be read at all is the caller's error as it is.
 *
 * Order as the engine's: the OBJ (a finding here stops the check), each material library
 * in `mtllib` order with its materials, what draws, the control groups by the parts, the
 * animations, the liveries. The engine's animations and liveries come in no set order
 * (`WagonModelDecl` keeps them by `Map.copyOf`); here they come in the file's.
 *
 * Locations are `ns:path`, as the engine names resources; the caller's
 * {@link ModelCheckFiles} says which Minecraft takes and what is there. Pure: it runs in
 * the model worker (editor.md §3.11) and in Node.
 */

import type { ProblemParam } from '../core/contracts';
import { AnimError, parse as parseAnim } from './anim';
import { parseJavaFloat, parseJavaInt } from './javaNumbers';
import { DEFAULT_SKIP_PREFIXES, MAX_GROUP_LENGTH, dropped, tooLongGroups, type ModelDeclaration } from './modelParts';
import { fileNameOf, folderOf, javaLines, javaTrim, parse as parseMtl, resolve } from './mtl';
import { loadModel, ObjError, type ObjModel } from './obj';
import { door, parseRole } from './objectRole';

/** Where the files are read from (`ModelCheck.Files`): locations are `ns:path` strings. */
export interface ModelCheckFiles {
  /** True if `location` is a resource location Minecraft takes at all. */
  valid(location: string): boolean;
  exists(location: string): boolean | Promise<boolean>;
  /** The file's text, read as UTF-8 (a byte-order mark kept, as Java keeps it); rejects when it can't be read. */
  read(location: string): Promise<string>;
}

/** What the check finds, each with how bad it is: an error (the model, or the part named, doesn't load) or a warning. */
export const MODEL_CODES = {
  'bad-path': 'error',
  missing: 'error',
  'bad-face-index': 'error',
  unreadable: 'error',
  'no-faces': 'error',
  'bad-library-path': 'error',
  'missing-library': 'error',
  'unreadable-library': 'error',
  'bad-texture-path': 'error',
  'missing-texture': 'error',
  'draws-nothing': 'error',
  'untextured-faces': 'warning',
  'group-too-long': 'warning',
  'bad-animation-path': 'error',
  'missing-animation': 'error',
  'unreadable-animation': 'error',
  'livery-replaces-nothing': 'warning',
} as const satisfies Record<string, 'error' | 'warning'>;

export type ModelCode = keyof typeof MODEL_CODES;

/** One thing the check finds. */
export interface ModelFinding {
  severity: 'error' | 'warning';
  code: ModelCode;
  /**
   * The values the line is made of, by name: `path` (the OBJ's location, or an
   * animation's), `detail`/`error` (why a file doesn't read), `library`, `material`,
   * `texture`, `materials` (`a, b`), `group`, `limit`, `door` (an animation's key, lower
   * case, as the engine has it), `livery`, `folder`.
   */
  params: Record<string, ProblemParam>;
  /** The engine's line, made of the code and the params ({@link modelFindingText}). */
  text: string;
  /** The material library (location) a texture finding's material comes from: where it is fixed. */
  library?: string;
  /** The objects that carry a control group too long, in order. */
  objects?: string[];
}

function str(params: Readonly<Record<string, ProblemParam>>, name: string): string {
  return String(params[name]);
}

/** The engine's line of a finding, made of its code and params alone (`ModelCheck`'s messages). */
export function modelFindingText(code: ModelCode, params: Readonly<Record<string, ProblemParam>>): string {
  const p = (name: string): string => str(params, name);
  switch (code) {
    case 'bad-path':
      return `model path '${p('path')}' is not a valid resource location`;
    case 'missing':
      return `model file ${p('path')} not found`;
    case 'bad-face-index':
      return (
        `model ${p('path')}: a face refers to a vertex, texture coordinate or normal that isn't there (${p('detail')});` +
        " indices count from 1, negative ones aren't supported"
      );
    case 'unreadable':
      return `model ${p('path')} can't be read: ${p('error')}`;
    case 'no-faces':
      return `model ${p('path')} has no faces`;
    case 'bad-library-path':
      return `model ${p('path')}: material library path '${p('library')}' is invalid`;
    case 'missing-library':
      return `model ${p('path')}: material library ${p('library')} not found`;
    case 'unreadable-library':
      return `model ${p('path')}: material library ${p('library')} can't be read: ${p('error')}`;
    case 'bad-texture-path':
      return `model ${p('path')}: material ${p('material')} has an invalid texture path '${p('texture')}'`;
    case 'missing-texture':
      return `model ${p('path')}: texture ${p('texture')} of material ${p('material')} not found`;
    case 'draws-nothing':
      return `model ${p('path')} draws nothing: no face has a textured material`;
    case 'untextured-faces':
      return `model ${p('path')}: faces with no texture (map_Kd) aren't drawn, material(s) ${p('materials')}`;
    case 'group-too-long':
      return (
        `model ${p('path')}: control group '${p('group')}' is longer than ${p('limit')} characters and is dropped:` +
        " its switches can't be worked, its lights stay off (an LINVERT one on)"
      );
    case 'bad-animation-path':
      return `animation '${p('door')}': path '${p('path')}' is not a valid resource location`;
    case 'missing-animation':
      return `animation '${p('door')}': file ${p('path')} not found`;
    case 'unreadable-animation':
      return `animation '${p('door')}': ${p('path')} can't be read: ${p('error')}`;
    case 'livery-replaces-nothing':
      return `livery '${p('livery')}' replaces no texture (folder ${p('folder')} next to the model)`;
  }
}

/** A finding with its params in the line's order. */
export function modelFinding(code: ModelCode, params: Record<string, ProblemParam>, extra: Pick<ModelFinding, 'library' | 'objects'> = {}): ModelFinding {
  return { severity: MODEL_CODES[code], code, params, text: modelFindingText(code, params), ...extra };
}

/**
 * Every problem of the files `decl` names, in the engine's order (`ModelCheck.check`);
 * empty if none.
 */
export async function modelCheck(decl: ModelDeclaration, files: ModelCheckFiles): Promise<ModelFinding[]> {
  const read = await readObj(decl.obj, files);
  return 'finding' in read ? [read.finding] : checkObj(decl, read.model, files);
}

/** The OBJ at `location` as the check reads it, or the one finding that stops the check there. */
export async function readObj(location: string, files: ModelCheckFiles): Promise<{ model: ObjModel } | { finding: ModelFinding }> {
  if (!files.valid(location)) return { finding: modelFinding('bad-path', { path: location }) };
  if (!(await files.exists(location))) return { finding: modelFinding('missing', { path: location }) };
  let text: string;
  try {
    text = await files.read(location);
  } catch (error) {
    return { finding: modelFinding('unreadable', { path: location, error: String(error) }) };
  }
  return objOf(location, text);
}

/**
 * The OBJ text of `location` as the model loader reads it (`ObjLoader.loadModel`), or its
 * refusal as the check words it: a face index that is not there, or a file that can't be
 * read, with the exception the engine's reader throws.
 */
export function objOf(location: string, text: string): { model: ObjModel } | { finding: ModelFinding } {
  try {
    return { model: loadModel(text) };
  } catch (error) {
    if (!(error instanceof ObjError)) throw error;
    const refused = objRefusal(text, error);
    return {
      finding:
        refused.kind === 'index'
          ? modelFinding('bad-face-index', { path: location, detail: refused.detail })
          : modelFinding('unreadable', { path: location, error: refused.detail }),
    };
  }
}

/**
 * Everything the check says of a model whose OBJ reads (`ModelCheck.check` past the
 * reading): no faces (and nothing more), then the libraries and textures, what draws, the
 * control groups, the animations, the liveries.
 */
export async function checkObj(decl: ModelDeclaration, model: ObjModel, files: ModelCheckFiles): Promise<ModelFinding[]> {
  const out: ModelFinding[] = [];
  if (model.parts.length === 0) {
    out.push(modelFinding('no-faces', { path: decl.obj }));
    return out;
  }
  const textures = await materialTextures(decl.obj, model, files, out);
  checkDrawn(decl, model, textures, out);
  checkGroups(decl.obj, model, out);
  await checkAnimations(decl, files, out);
  await checkLiveries(decl, textures, files, out);
  return out;
}

/** Material → its texture's location, each library and texture checked on the way (`ModelCheck.textures`). */
async function materialTextures(obj: string, model: ObjModel, files: ModelCheckFiles, out: ModelFinding[]): Promise<Map<string, string>> {
  const { namespace, path } = split(obj);
  const folder = folderOf(path);
  const textures = new Map<string, string>();
  for (const library of model.materialLibraries) {
    const mtl = relative(namespace, folder, library);
    if (mtl === null || !files.valid(mtl)) {
      out.push(modelFinding('bad-library-path', { path: obj, library }));
      continue;
    }
    if (!(await files.exists(mtl))) {
      out.push(modelFinding('missing-library', { path: obj, library: mtl }));
      continue;
    }
    let maps: Map<string, string>;
    try {
      maps = parseMtl(await files.read(mtl));
    } catch (error) {
      out.push(modelFinding('unreadable-library', { path: obj, library: mtl, error: String(error) }));
      continue;
    }
    for (const [material, map] of maps) {
      const texture = relative(namespace, folder, map);
      if (texture === null || !files.valid(texture)) {
        out.push(modelFinding('bad-texture-path', { path: obj, material, texture: map }, { library: mtl }));
        continue;
      }
      if (!(await files.exists(texture))) {
        out.push(modelFinding('missing-texture', { path: obj, texture, material }, { library: mtl }));
      }
      if (!textures.has(material)) textures.set(material, texture);
    }
  }
  return textures;
}

/** Something must draw; faces left untextured are named, but for hinge markers (`ModelCheck.checkDrawn`). */
function checkDrawn(decl: ModelDeclaration, model: ObjModel, textures: ReadonlyMap<string, string>, out: ModelFinding[]): void {
  const skip = [...DEFAULT_SKIP_PREFIXES, ...decl.skip];
  let anyDrawn = false;
  const untextured = new Set<string>();
  for (const part of model.parts) {
    if (dropped(part.object, skip) !== null) continue; // never drawn, by the model loader's own rule
    if (textures.has(part.material)) anyDrawn = true;
    else if (!hingeMarker(part.object)) untextured.add(part.material === '' ? '(none)' : part.material);
  }
  if (!anyDrawn) out.push(modelFinding('draws-nothing', { path: decl.obj }));
  else if (untextured.size > 0) out.push(modelFinding('untextured-faces', { path: decl.obj, materials: [...untextured].join(', ') }));
}

/**
 * True if the object is the hinge marker of a control or a door leaf (`<KEY>_ROT…`, as
 * ./objectRole.ts reads it): untextured, it still gives the hinge (`ModelCheck.hingeMarker`).
 */
function hingeMarker(object: string): boolean {
  const leaf = door(object);
  return parseRole(object).pivotDegrees !== null || (leaf !== null && leaf.pivotDegrees !== null);
}

/**
 * A control group named longer than the wire takes: the model loader drops it. Each name
 * once, in the order the parts come, with the objects that carry it (`ModelCheck.checkGroups`).
 */
function checkGroups(obj: string, model: ObjModel, out: ModelFinding[]): void {
  const names = new Map<string, string[]>();
  for (const part of model.parts) {
    for (const name of tooLongGroups(parseRole(part.object))) {
      const objects = names.get(name) ?? [];
      if (!objects.includes(part.object)) objects.push(part.object);
      names.set(name, objects);
    }
  }
  for (const [group, objects] of names) out.push(modelFinding('group-too-long', { path: obj, group, limit: MAX_GROUP_LENGTH }, { objects }));
}

/** Every declared `.anim` is a resource location, there and readable (`ModelCheck.checkAnimations`). */
async function checkAnimations(decl: ModelDeclaration, files: ModelCheckFiles, out: ModelFinding[]): Promise<void> {
  for (const [group, anim] of decl.animations) {
    if (!files.valid(anim)) {
      out.push(modelFinding('bad-animation-path', { door: group, path: anim }));
    } else if (!(await files.exists(anim))) {
      out.push(modelFinding('missing-animation', { door: group, path: anim }));
    } else {
      let error: string | null = null;
      try {
        parseAnim(await files.read(anim));
      } catch (e) {
        error = e instanceof AnimError ? animRefusal(e) : String(e);
      }
      if (error !== null) out.push(modelFinding('unreadable-animation', { door: group, path: anim, error }));
    }
  }
}

/** A livery should swap at least one texture: one of the same file name in its folder next to the OBJ (`ModelCheck.checkLiveries`). */
async function checkLiveries(decl: ModelDeclaration, textures: ReadonlyMap<string, string>, files: ModelCheckFiles, out: ModelFinding[]): Promise<void> {
  const { namespace, path } = split(decl.obj);
  const folder = folderOf(path);
  for (const [livery, liveryFolder] of decl.liveries) {
    let swaps = false;
    for (const base of new Set(textures.values())) {
      const swap = relative(namespace, folder, `${liveryFolder}/${fileNameOf(split(base).path)}`);
      if (swap !== null && files.valid(swap) && (await files.exists(swap))) {
        swaps = true;
        break;
      }
    }
    if (!swaps) out.push(modelFinding('livery-replaces-nothing', { livery, folder: liveryFolder }));
  }
}

/** `relative` resolved against `folder` of `namespace`; null if it climbs out (`ModelCheck.relative`). */
function relative(namespace: string, folder: string, path: string): string | null {
  const resolved = resolve(folder, path);
  return resolved === null ? null : `${namespace}:${resolved}`;
}

/** The namespace (`minecraft` when none) and the path of a location (`ModelCheck.namespace`, `path`). */
function split(location: string): { namespace: string; path: string } {
  const colon = location.indexOf(':');
  return colon < 0 ? { namespace: 'minecraft', path: location } : { namespace: location.slice(0, colon), path: location.slice(colon + 1) };
}

// ---------------------------------------------------------------- the engine's exceptions

/** How the engine's reader refuses a file: an index out of an array or a list (the check's own line), or another exception. */
export interface Refusal {
  kind: 'index' | 'other';
  /** `e.getMessage()` of an index out of bounds, `e.toString()` of anything else. */
  detail: string;
}

/** Java's `ArrayList.get` and array index past the end: `IndexOutOfBoundsException.getMessage()`. */
function outOfBounds(index: number, length: number): Refusal {
  return { kind: 'index', detail: `Index ${index} out of bounds for length ${length}` };
}

/** `Float.parseFloat` refusing a text (`FloatingDecimal` words it trimmed). */
function floatRefused(text: string): string {
  const trimmed = javaTrim(text);
  return `java.lang.NumberFormatException: ${trimmed === '' ? 'empty String' : `For input string: "${trimmed}"`}`;
}

/** `Integer.parseInt` refusing a text. */
function intRefused(text: string): string {
  return `java.lang.NumberFormatException: For input string: "${text}"`;
}

/** Java's `\s`, as `line.split("\\s+")` parts an OBJ line. */
const BLANKS = /[ \t\n\v\f\r]+/;

/** The numbers `ObjLoader` reads of each vector line. */
const VECTOR_SIZES: Readonly<Record<string, number>> = { v: 3, vt: 2, vn: 3 };

function reasonOf(error: Error & { line: number }): string {
  const lead = `line ${error.line}: `;
  return error.message.startsWith(lead) ? error.message.slice(lead.length) : error.message;
}

/**
 * The exception `ObjLoader.loadModel` throws where ./obj.ts refuses the text: a corner
 * that names no vertex reads `idx[0]` of an empty split (`Index 0 out of bounds for length
 * 0`); a corner's index is `Integer.parseInt`, then a list's `get(index − 1)`; a `v`, `vt`
 * or `vn` line reads its numbers `t[1]`, `t[2]`… in order, each `Float.parseFloat`, so a
 * bad number before the line's end is refused as a number and a missing one as an index.
 */
export function objRefusal(text: string, error: ObjError): Refusal {
  const reason = reasonOf(error);
  if (/^the corner '[^ ]*' names no vertex$/.test(reason)) return outOfBounds(0, 0);
  const corner = /^the corner '[^ ]*' names ([^ ]*) of (\d+)$/.exec(reason);
  if (corner !== null) {
    const value = parseJavaInt(corner[1]!);
    return value === null ? { kind: 'other', detail: intRefused(corner[1]!) } : outOfBounds((value - 1) | 0, Number(corner[2]));
  }
  const t = javaTrim(javaLines(text)[error.line - 1] ?? '').split(BLANKS);
  const size = VECTOR_SIZES[t[0]!] ?? 0;
  for (let i = 1; i <= size; i++) {
    if (i >= t.length) return outOfBounds(i, t.length);
    if (parseJavaFloat(t[i]!) === null) return { kind: 'other', detail: floatRefused(t[i]!) };
  }
  return { kind: 'other', detail: reason }; // ./obj.ts refuses nothing else
}

/**
 * The exception `IrAnim.parse` throws where ./anim.ts refuses the text: a frame of other
 * than 16 values is an `IOException`, a bad value `Float.parseFloat`'s refusal of it trimmed.
 */
export function animRefusal(error: AnimError): string {
  const reason = reasonOf(error);
  const frame = /^a frame of (\d+) values, not \d+$/.exec(reason);
  if (frame !== null) return `java.io.IOException: anim frame with ${frame[1]} values, expected 16`;
  const value = /^'([^]*)' is no number$/.exec(reason);
  if (value !== null) return floatRefused(value[1]!);
  return reason; // ./anim.ts refuses nothing else
}
