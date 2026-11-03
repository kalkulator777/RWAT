/**
 * Where the objects tab gets the model to list: the wagon the selection points at, read
 * from the open pack. Until the model worker (A3.1, `editor/src/model/**`) hands over
 * models, the tab reads the OBJ itself (`buildModel`); once the worker's model is put in
 * {@link workerModel} the tab shows that one for the same wagon and reads nothing.
 */

import { signal } from '@preact/signals';
import type { Link } from '../../core/contracts';
import type { Pack, StockEntry } from '../../core/pack';
import { parse as parseAnim } from '../../ports/anim';
import { ObjError, loadModel } from '../../ports/obj';
import { fileNameOf, folderOf, parse as parseMtl, resolve } from '../../ports/mtl';
import { buildLoadedModel, type BuiltModel } from './buildModel';

/**
 * The model the worker built for the wagon it names (`model.id` is the wagon's `namespace:id`),
 * with the materials that have a texture and the declaration's `skip`. Null: the tab builds
 * its own. The conductor wires the worker's result into this signal.
 */
export const workerModel = signal<BuiltModel | null>(null);

/** Why a wagon has no model to list. */
export type ModelFailure =
  /** The wagon has a type but no model declaration: the game draws a box. */
  | { failure: 'no-model' }
  /** The declaration names no OBJ, or the file is not in the pack. */
  | { failure: 'no-obj'; path: string }
  /** The engine's loader refuses the OBJ. */
  | { failure: 'bad-obj'; detail: string };

export type ModelResult = { built: BuiltModel } | ModelFailure;

/** The wagon (`namespace:id`) the links point at: through its type or model file, or through one of its objects; null when they point at none. */
export function stockIdOf(links: readonly Link[], stock: readonly StockEntry[]): string | null {
  for (const link of links) {
    if (link.kind === 'file' || link.kind === 'field') {
      const entry = stock.find((candidate) => candidate.model === link.file || candidate.type === link.file);
      if (entry !== undefined) return entry.id;
    } else if (link.kind === 'object') {
      if (stock.some((candidate) => candidate.id === link.model)) return link.model;
    }
  }
  return null;
}

/** The model declaration's text-bearing parts the tab uses, read defensively: a pack's JSON may be anything. */
function declared(json: unknown): { obj: string | null; skip: string[]; animations: string[] } {
  const record = typeof json === 'object' && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
  const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
  const animations =
    typeof record.animations === 'object' && record.animations !== null && !Array.isArray(record.animations)
      ? Object.values(record.animations).filter((item): item is string => typeof item === 'string')
      : [];
  return { obj: typeof record.obj === 'string' ? record.obj : null, skip: strings(record.skip), animations };
}

/** A key that changes when the model's declaration does: what the tab reads again the model for. */
export function declarationKey(pack: Pack, entry: StockEntry): string {
  return entry.model === null ? '' : JSON.stringify(pack.json(entry.model) ?? null);
}

/**
 * Reads a wagon's OBJ, MTL and `.anim` files from the pack and builds the model to list.
 * A resource path of the declaration is relative to `assets/<namespace>/`, the folder the
 * model declaration sits in.
 */
export async function loadWagonModel(pack: Pack, entry: StockEntry): Promise<ModelResult> {
  if (entry.model === null) return { failure: 'no-model' };
  const base = `assets/${entry.model.split('/')[1] ?? ''}/`;
  const { obj, skip, animations } = declared(pack.json(entry.model));
  const objPath = obj === null ? '' : resolve('', base + obj);
  if (objPath === null || objPath === '' || !pack.has(objPath)) return { failure: 'no-obj', path: obj ?? '' };

  let parsed;
  try {
    parsed = loadModel(await pack.text(objPath));
  } catch (error) {
    if (error instanceof ObjError) return { failure: 'bad-obj', detail: error.message };
    throw error;
  }

  // a material has a texture when its MTL gives a map_Kd whose file is in the pack
  const textured = new Set<string>();
  for (const library of parsed.materialLibraries) {
    const mtlPath = resolve(folderOf(objPath), library);
    if (mtlPath === null || !pack.has(mtlPath)) continue;
    for (const [material, map] of parseMtl(await pack.text(mtlPath))) {
      const texture = resolve(folderOf(mtlPath), map);
      if (texture !== null && fileNameOf(texture) !== '' && pack.has(texture)) textured.add(material);
    }
  }

  const animObjects = new Set<string>();
  for (const animation of animations) {
    const path = resolve('', base + animation);
    if (path === null || !pack.has(path)) continue;
    try {
      for (const [name, frames] of parseAnim(await pack.text(path))) if (frames.length > 0) animObjects.add(name);
    } catch {
      // a broken .anim is the model check's finding, not the tab's
    }
  }

  return { built: buildLoadedModel({ id: entry.id, obj: parsed, skip, animObjects, texturedMaterials: textured }) };
}
