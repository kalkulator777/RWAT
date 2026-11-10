/**
 * One wagon model, read and built for the view (docs/proposals/editor.md §3.11): the
 * pipeline the model worker runs (../workers/model.worker.ts), pure but for the texture
 * decoder it is handed, so it runs in Node too.
 *
 * As the engine loads a model (`IrStockModel.load`):
 * 1. the declaration's model fields (ports/modelParts `modelDeclaration`);
 * 2. the OBJ (ports/obj), its `mtllib`s relative to its folder (ports/mtl): a material
 *    has a texture when its `map_Kd`, relative to the OBJ's folder too, is a resource
 *    location Minecraft takes — whether or not the file is there;
 * 3. the doors' `.anim`s (ports/anim): their objects with frames move with their door; a
 *    file missing or broken moves nothing, as in the game;
 * 4. what every part is (ports/modelParts `modelParts`);
 * 5. the triangles of each object × material pair in the OBJ frame: positions, normals
 *    and UVs as the file has them (V not turned: the bitmaps are decoded upside down);
 *    a quad is two triangles, a triangle (a quad with its last corner twice) one;
 * 6. the textures the parts use, decoded; the liveries' textures that are there;
 * 7. what the pack check says of the model's files (ports/modelCheck, `ModelCheck`): a
 *    missing library or texture, faces without a texture, a group too long, an animation
 *    that doesn't read, a livery that replaces nothing — as the model's findings
 *    (checks/model: source `model`, one system of codes).
 *
 * A model that can't be read — a declaration the engine refuses, an OBJ path it refuses,
 * no OBJ, an OBJ it can't read — is no exception: it comes back empty with one finding,
 * the one the check stops at. {@link checkModel} is the check alone, without the model
 * ("Check all models", checks/model).
 */

import { badDeclaration, modelProblem, type CheckedModel } from '../checks/model/problems';
import type { LoadedModel, ObjectInfo, PartBuffers, Problem, Vec3 } from '../core/contracts';
import * as Anim from '../ports/anim';
import { checkObj, modelCheck, modelFinding, objOf, type ModelCheckFiles, type ModelFinding } from '../ports/modelCheck';
import { CORNER_FLOATS, type ObjModel } from '../ports/obj';
import * as Mtl from '../ports/mtl';
import {
  animatedBy,
  drawn,
  fitGroups,
  modelDeclaration,
  modelParts,
  partsOf,
  type ModelDeclaration,
  type ModelParts,
  type Place,
  type Role,
} from '../ports/modelParts';
import { door, parseRole } from '../ports/objectRole';
import { PackJsonError } from '../ports/packJson';
import { relativeFile, resourceFile, splitLocation, validLocation } from './resources';
import type { ModelReader, ModelRequest, TextureDecoder } from './types';

/** A built model and what to transfer with it: its buffers and bitmaps. */
export interface Built {
  model: LoadedModel;
  transfer: Transferable[];
}

/** The role id of schema/obj-conventions.json `roles` for a part of this place. */
export function roleId(place: Place, front: boolean): string {
  switch (place) {
    case 'HIDDEN':
      return 'hidden';
    case 'SKIPPED':
      return 'skip';
    case 'UNTEXTURED':
      return 'untextured';
    case 'BODY':
      return 'body';
    case 'INTERIOR':
      return 'interior';
    case 'BOGIE':
      return front ? 'bogie_front' : 'bogie_rear';
    case 'WHEEL':
      return 'wheelset';
    case 'ANIMATED':
      return 'anim_object';
    case 'DOOR_LEAF':
      return 'door_leaf';
    case 'CONTROL':
      return 'control';
    case 'COUPLER':
      return 'coupler_head';
  }
}

/** The OBJ's text as Java reads a UTF-8 file: a byte-order mark is kept (no blank to Java). */
const decoder = new TextDecoder('utf-8', { ignoreBOM: true });

/** A model with nothing in it: no parts, no objects, nothing the engine makes of it, no findings. */
export function emptyModel(id: string, file: string, obj: string | null = null): LoadedModel {
  return { id, file, obj, parts: [], objects: [], textures: {}, materials: {}, skip: [], animated: {}, animations: {}, engine: null, liveries: {}, problems: [] };
}

/** A model that can't be read: empty, with one finding. */
function unreadable(request: ModelRequest, obj: string | null, problem: Problem): Built {
  return { model: { ...emptyModel(request.id, request.file, obj), problems: [problem] }, transfer: [] };
}

/**
 * The pack's files as the model check reads them (ports/modelCheck): locations `ns:path`
 * are the pack files `assets/<ns>/<path>` (./resources.ts), a location Minecraft refuses
 * or takes with an empty path names nothing, a file is read as UTF-8 with its byte-order
 * mark kept.
 */
export function checkFiles(files: ModelReader): ModelCheckFiles {
  return {
    valid: validLocation,
    exists: async (location) => {
      const path = resourceFile(location);
      return path !== null && (await files.has(path));
    },
    read: async (location) => {
      const path = resourceFile(location);
      const bytes = path === null ? null : await files.read(path);
      if (bytes === null) throw new Error(`no file ${location}`);
      return decoder.decode(bytes);
    },
  };
}

/** The declaration of a request as the engine reads it, or the finding of one it refuses. */
function declarationOf(request: ModelRequest): ModelDeclaration | Problem {
  try {
    return modelDeclaration(splitLocation(request.id).namespace, request.declaration);
  } catch (error) {
    if (!(error instanceof PackJsonError)) throw error;
    return badDeclaration(request, error.message);
  }
}

/**
 * What the pack check says of a request's model (ports/modelCheck `modelCheck`), read
 * through `files`, as findings: the model itself is not built, nothing is kept.
 */
export async function checkModel(request: ModelRequest, files: ModelReader): Promise<Problem[]> {
  const decl = declarationOf(request);
  if (!('obj' in decl)) return [decl];
  const subject: CheckedModel = request;
  return (await modelCheck(decl, checkFiles(files))).map((finding) => modelProblem(finding, subject));
}

/** The bytes of a file, or null when it is missing or its reading fails. */
async function readOrNull(files: ModelReader, path: string): Promise<Uint8Array | null> {
  try {
    return await files.read(path);
  } catch {
    return null;
  }
}

/**
 * Material → texture (pack path), from every `mtllib` of the OBJ in order, the first
 * map of a material winning (`IrStockModel.materialTextures`). A library missing or
 * unreadable, or a map Minecraft refuses, gives nothing.
 */
async function materialTextures(obj: ObjModel, namespace: string, folder: string, files: ModelReader): Promise<Map<string, string>> {
  const libraries = await Promise.all(
    obj.materialLibraries.map(async (library) => {
      const path = relativeFile(namespace, folder, library);
      const bytes = path === null ? null : await readOrNull(files, path);
      return bytes === null ? null : Mtl.parse(decoder.decode(bytes));
    }),
  );
  const textures = new Map<string, string>();
  for (const maps of libraries) {
    if (maps === null) continue;
    for (const [material, map] of maps) {
      const texture = relativeFile(namespace, folder, map);
      if (texture !== null && !textures.has(material)) textures.set(material, texture);
    }
  }
  return textures;
}

/** Door id → its tracks, for every declared `.anim` that reads (`IrStockModel.loadAnimations`). */
async function animations(decl: ModelDeclaration, files: ModelReader): Promise<[string, Map<string, Float32Array[]>][]> {
  const read = await Promise.all(
    [...decl.animations].map(async ([id, location]): Promise<[string, Map<string, Float32Array[]>] | null> => {
      const path = resourceFile(location);
      const bytes = path === null ? null : await readOrNull(files, path);
      if (bytes === null) return null;
      try {
        return [id, Anim.parse(decoder.decode(bytes))];
      } catch {
        return null; // a broken animation: its objects stay part of the body, as in the game
      }
    }),
  );
  return read.filter((entry) => entry !== null);
}

/** True if corner `b` of a quad repeats corner `a` (all eight floats): the quad is a triangle. */
function sameCorner(quads: Float32Array, a: number, b: number): boolean {
  for (let i = 0; i < CORNER_FLOATS; i++) if (quads[a + i] !== quads[b + i]) return false;
  return true;
}

const QUAD = 4 * CORNER_FLOATS;

/** The triangles of each object × material pair, in the order the pairs first come; the parts of a pair share its role. */
function buffers(obj: ObjModel, roles: readonly Role[], textures: ReadonlyMap<string, string>): PartBuffers[] {
  const groups = new Map<string, { object: string; material: string; role: Role; parts: Float32Array[]; triangles: number }>();
  obj.parts.forEach((part, i) => {
    const key = `${part.object}\u0000${part.material}`;
    let group = groups.get(key);
    if (group === undefined) {
      group = { object: part.object, material: part.material, role: roles[i]!, parts: [], triangles: 0 };
      groups.set(key, group);
    }
    group.parts.push(part.quads);
    for (let q = 0; q < part.quads.length; q += QUAD) group.triangles += sameCorner(part.quads, q + 2 * CORNER_FLOATS, q + 3 * CORNER_FLOATS) ? 1 : 2;
  });
  const out: PartBuffers[] = [];
  for (const group of groups.values()) {
    const positions = new Float32Array(group.triangles * 9);
    const normals = new Float32Array(group.triangles * 9);
    const uvs = new Float32Array(group.triangles * 6);
    let p = 0;
    let t = 0;
    const corner = (quads: Float32Array, at: number): void => {
      positions[p] = quads[at]!;
      positions[p + 1] = quads[at + 1]!;
      positions[p + 2] = quads[at + 2]!;
      normals[p] = quads[at + 5]!;
      normals[p + 1] = quads[at + 6]!;
      normals[p + 2] = quads[at + 7]!;
      uvs[t] = quads[at + 3]!;
      uvs[t + 1] = 1 - quads[at + 4]!; // ports/obj keeps V as Minecraft samples it; the view takes the file's
      p += 3;
      t += 2;
    };
    for (const quads of group.parts) {
      for (let q = 0; q < quads.length; q += QUAD) {
        const c = [q, q + CORNER_FLOATS, q + 2 * CORNER_FLOATS, q + 3 * CORNER_FLOATS] as const;
        corner(quads, c[0]);
        corner(quads, c[1]);
        corner(quads, c[2]);
        if (!sameCorner(quads, c[2], c[3])) {
          corner(quads, c[0]);
          corner(quads, c[2]);
          corner(quads, c[3]);
        }
      }
    }
    const { role } = group;
    out.push({
      object: group.object,
      material: group.material,
      positions,
      normals,
      uvs,
      texture: textures.get(group.material) ?? null,
      role: roleId(role.place, role.front),
      drawn: drawn(role.place),
    });
  }
  return out;
}

/** Each object once, in the order it first comes: its role (its first drawn part's, else its first part's), control, light group and box. */
function objects(obj: ObjModel, parts: ModelParts): ObjectInfo[] {
  const byName = new Map<string, { role: Role; min: Vec3; max: Vec3 }>();
  obj.parts.forEach((part, i) => {
    const role = parts.roles[i]!;
    let entry = byName.get(part.object);
    if (entry === undefined) {
      entry = { role, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      byName.set(part.object, entry);
    } else if (!drawn(entry.role.place) && drawn(role.place)) {
      entry.role = role;
    }
    const { min, max } = entry;
    for (let q = 0; q < part.quads.length; q += CORNER_FLOATS) {
      for (let axis = 0; axis < 3; axis++) {
        const v = part.quads[q + axis]!;
        if (v < min[axis]!) min[axis] = v;
        if (v > max[axis]!) max[axis] = v;
      }
    }
  });
  const controls = new Map([...parts.controls, ...parts.doorLeaves].map((control) => [control.role.key, control.role]));
  return [...byName].map(([name, { role, min, max }]): ObjectInfo => {
    // the control as the engine has it (its objects' flags merged, the handbrake), else as the name reads
    const owned = role.owner !== null && (role.place === 'CONTROL' || role.place === 'DOOR_LEAF' || role.place === 'UNTEXTURED') ? controls.get(role.owner) : undefined;
    // a hinge marker of a leaf drawn by nothing still names its door
    const leaf = role.owner !== null ? door(name) : null;
    const control = owned ?? fitGroups(parseRole(name)).control ?? (leaf?.control?.key === role.owner ? leaf.control : null) ?? undefined;
    const lightGroup = role.light.group >= 0 ? parts.lightGroups[role.light.group] : undefined;
    const info: ObjectInfo = { name, role: roleId(role.place, role.front), engine: role, bbox: [min, max] };
    if (control !== undefined) info.control = control;
    if (lightGroup !== undefined) info.lightGroup = lightGroup;
    return info;
  });
}

/** Decodes each texture once; a missing or broken one is null. */
export async function decodeTextures(paths: Iterable<string>, files: ModelReader, decode: TextureDecoder): Promise<Map<string, ImageBitmap | null>> {
  const unique = [...new Set(paths)];
  const bitmaps = await Promise.all(
    unique.map(async (path) => {
      const bytes = await readOrNull(files, path);
      if (bytes === null) return null;
      try {
        return await decode(bytes, path);
      } catch {
        return null;
      }
    }),
  );
  return new Map(unique.map((path, i) => [path, bitmaps[i] ?? null]));
}

/**
 * Livery id → base texture → the livery's texture: a texture of the same file name in the
 * livery's folder next to the OBJ replaces the base one (IR `tex_variants`;
 * `IrStockModel.liveries`). Only the files that are there.
 */
async function liveries(decl: ModelDeclaration, namespace: string, folder: string, textures: Iterable<string>, files: ModelReader): Promise<Record<string, Record<string, string>>> {
  const bases = [...new Set(textures)];
  const out = new Map<string, Record<string, string>>();
  for (const [livery, liveryFolder] of decl.liveries) {
    const swaps = await Promise.all(
      bases.map(async (base): Promise<[string, string] | null> => {
        const swap = relativeFile(namespace, folder, `${liveryFolder}/${Mtl.fileNameOf(base)}`);
        return swap !== null && (await files.has(swap)) ? [base, swap] : null;
      }),
    );
    out.set(livery, Object.fromEntries(swaps.filter((swap) => swap !== null)));
  }
  return Object.fromEntries(out);
}

/**
 * The model of a request, read through `files`; the textures through `decode`. Its
 * findings are the pack check's (ports/modelCheck): of the OBJ that can't be read, the one
 * the check stops at; else everything the check says of the files.
 */
export async function buildModel(request: ModelRequest, files: ModelReader, decode: TextureDecoder): Promise<Built> {
  const decl = declarationOf(request);
  if (!('obj' in decl)) return unreadable(request, null, decl);
  const subject: CheckedModel = request;
  const stop = (finding: ModelFinding, obj: string | null): Built => unreadable(request, obj, modelProblem(finding, subject));
  if (!validLocation(decl.obj)) return stop(modelFinding('bad-path', { path: decl.obj }), null);
  // a location Minecraft takes with an empty path (`t:`) names no file: missing
  const objFile = resourceFile(decl.obj);
  let bytes: Uint8Array | null = null;
  try {
    if (objFile !== null) bytes = await files.read(objFile);
  } catch (error) {
    return stop(modelFinding('unreadable', { path: decl.obj, error: String(error) }), objFile);
  }
  if (bytes === null) return stop(modelFinding('missing', { path: decl.obj }), null);
  const read = objOf(decl.obj, decoder.decode(bytes));
  if ('finding' in read) return stop(read.finding, objFile);
  const obj: ObjModel = read.model;

  const { namespace, path } = splitLocation(decl.obj);
  const folder = Mtl.folderOf(path);
  const [textures, anims] = await Promise.all([materialTextures(obj, namespace, folder, files), animations(decl, files)]);
  const animated = animatedBy(anims);
  const parts = modelParts(
    partsOf(obj, (material) => textures.has(material)),
    { bogies: decl.bogies, skip: decl.skip, animated, handbrake: decl.handbrake },
  );
  const { roles, ...engine } = parts;
  const partBuffers = buffers(obj, roles, textures);
  const used = partBuffers.flatMap((part) => (part.texture === null ? [] : [part.texture]));
  const [bitmaps, liveryTextures, checked] = await Promise.all([
    decodeTextures(used, files, decode),
    liveries(decl, namespace, folder, textures.values(), files),
    checkObj(decl, obj, checkFiles(files)),
  ]);
  const transfer: Transferable[] = partBuffers.flatMap((part) => [part.positions.buffer, part.normals.buffer, part.uvs.buffer] as ArrayBuffer[]);
  for (const bitmap of bitmaps.values()) if (bitmap !== null) transfer.push(bitmap);
  return {
    model: {
      id: request.id,
      file: request.file,
      obj: objFile,
      parts: partBuffers,
      objects: objects(obj, parts),
      textures: Object.fromEntries(bitmaps),
      problems: checked.map((finding) => modelProblem(finding, subject)),
      engine,
      materials: Object.fromEntries(textures),
      skip: decl.skip,
      animated: Object.fromEntries(animated),
      animations: Object.fromEntries(anims.map(([id, tracks]) => [id, Object.fromEntries([...tracks].filter(([, frames]) => frames.length > 0))])),
      liveries: liveryTextures,
    },
    transfer,
  };
}
