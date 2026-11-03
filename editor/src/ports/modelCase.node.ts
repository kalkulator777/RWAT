/**
 * Node only (tests): a wagon model of a golden case, read as `ModelPartsGolden.read` reads
 * it, for the runners of fixtures/golden/model_parts/ and lights/ (./modelParts.test.ts,
 * ./lights.test.ts). The case gives `obj` (OBJ text), `textured` (material names) and/or
 * `mtl` (MTL text: a material whose `map_Kd` stays inside the pack from the folder of the
 * declaration's `obj` has a texture), `model` (the declaration; `{"obj": "model.obj"}`
 * without it) and `anim_<door>` (the `.anim` of door `<door>`, lower-cased).
 */

import * as Anim from './anim';
import { loadModel } from './obj';
import * as Mtl from './mtl';
import { animatedBy, modelDeclaration, modelParts, partsOf, type ModelParts } from './modelParts';

/** A golden model case's input. */
export interface ModelCase {
  obj: string;
  textured?: string[];
  mtl?: string;
  model?: unknown;
  [anim: `anim_${string}`]: string;
}

/** A model read from a case: the names of its parts in order, and what the port makes of them. */
export interface ReadModel {
  objects: string[];
  parts: ModelParts;
}

/** The model of a case's input, through the ports as the engine reads it. */
export function readModelCase(input: ModelCase): ReadModel {
  const obj = loadModel(input.obj);
  const decl = modelDeclaration('golden', input.model ?? { obj: 'model.obj' });
  // a map is relative to the OBJ's folder, as the loader resolves it
  const folder = Mtl.folderOf(decl.obj.slice(decl.obj.indexOf(':') + 1));
  const textured = new Set(input.textured ?? []);
  if (input.mtl !== undefined) {
    for (const [material, map] of Mtl.parse(input.mtl)) if (Mtl.resolve(folder, map) !== null) textured.add(material);
  }
  const anims: [string, Map<string, Float32Array[]>][] = [];
  for (const [key, text] of Object.entries(input)) {
    if (key.startsWith('anim_') && typeof text === 'string') anims.push([key.slice('anim_'.length).toLowerCase(), Anim.parse(text)]);
  }
  const parts = modelParts(partsOf(obj, (material) => textured.has(material)), {
    bogies: decl.bogies,
    skip: decl.skip,
    animated: animatedBy(anims),
    handbrake: decl.handbrake,
  });
  return { objects: obj.parts.map((part) => part.object), parts };
}
