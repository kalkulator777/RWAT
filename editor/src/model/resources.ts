/**
 * Where the files a wagon model names are in the pack, as the engine finds them
 * (`IrStockModel.load`, `materialTextures`, `liveries`, `loadAnimations`): a resource
 * location `ns:path` is the pack file `assets/<ns>/<path>`, and Minecraft takes only
 * lower-case letters, digits and `_ . -` in a namespace, and `/` besides in a path
 * (`ResourceLocation`): a location it refuses names no file. The same rule as the loader
 * checks' resource paths (checks/loader.ts); a file under `assets/` the rule refuses is
 * not loaded by the game, and the model is read as the game reads it.
 */

import * as Mtl from '../ports/mtl';

const NAMESPACE = /^[a-z0-9_.-]+$/;
const PATH = /^[a-z0-9_./-]+$/;

/** The pack file of a resource location `ns:path` (`ResourceLocation.tryParse`); null when Minecraft refuses it. */
export function resourceFile(location: string): string | null {
  const { namespace, path } = splitLocation(location);
  return assetFile(namespace, path);
}

/** `assets/<namespace>/<path>` (`ResourceLocation.tryBuild`); null when Minecraft refuses the namespace or the path. */
export function assetFile(namespace: string, path: string): string | null {
  return NAMESPACE.test(namespace) && PATH.test(path) ? `assets/${namespace}/${path}` : null;
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

/** The namespace and the path of a location `ns:path` (no colon: `minecraft`). */
export function splitLocation(location: string): { namespace: string; path: string } {
  const colon = location.indexOf(':');
  return colon < 0 ? { namespace: 'minecraft', path: location } : { namespace: location.slice(0, colon), path: location.slice(colon + 1) };
}
