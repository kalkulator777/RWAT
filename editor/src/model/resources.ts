/**
 * Where the files a wagon model names are in the pack, as the engine finds them
 * (`IrStockModel.load`, `materialTextures`, `liveries`, `loadAnimations`): a resource
 * location `ns:path` is the pack file `assets/<ns>/<path>`, taken as Minecraft takes it
 * (`ResourceLocation.tryParse`) by the model check's rule (ports/modelCheck
 * `validLocation`, `splitLocation`; golden `model_check/locations`): lower-case letters,
 * digits and `_ . -` in a namespace, and `/` besides in a path; an empty namespace or none
 * is `minecraft` (`:a` and `a` are `minecraft:a`); an empty path (`t:`) is taken but names
 * no file. A location Minecraft refuses names no file either, and the model is read as the
 * game reads it. The loader's checks take a pack path by the same rule (core/paths
 * `isResourcePath`).
 */

import { splitLocation, validLocation } from '../ports/modelCheck';
import * as Mtl from '../ports/mtl';

export { splitLocation, validLocation };

/** The pack file of a resource location `ns:path`; null when Minecraft refuses it, or takes it with an empty path (`t:`), which no file has. */
export function resourceFile(location: string): string | null {
  if (!validLocation(location)) return null;
  const { namespace, path } = splitLocation(location);
  return path === '' ? null : `assets/${namespace}/${path}`;
}

/** `assets/<namespace>/<path>` (`ResourceLocation.tryBuild`); null when Minecraft refuses the namespace or the path, or the path is empty. */
export function assetFile(namespace: string, path: string): string | null {
  return resourceFile(`${namespace}:${path}`);
}

/**
 * A path an OBJ or its MTL writes, relative to the OBJ's folder (`../` allowed), as the
 * pack file it names (`IrStockModel.relative`); null when it climbs out or Minecraft
 * refuses it.
 *
 * @param folder the OBJ's folder inside its namespace (`stock/coach`)
 */
export function relativeFile(namespace: string, folder: string, path: string): string | null {
  const resolved = Mtl.resolve(folder, path);
  return resolved === null ? null : assetFile(namespace, resolved);
}
