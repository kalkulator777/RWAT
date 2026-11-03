/**
 * Liveries (paint schemes) in the preview, as the engine reads them
 * (`IrStockModel.liveries`, IR `tex_variants`): a livery is a folder next to the OBJ, and a
 * texture there with the same file name as one of the model's textures replaces it; the
 * textures it does not carry stay. The meshes are the same — a livery is the model drawn
 * against other textures.
 *
 * The same rule is in the engine's pack check too (`pack/ModelCheck.checkLiveries`: a
 * livery that replaces nothing is warned), whose port comes in M4 (ports/modelCheck.ts):
 * the two should then share one function — this one moved into ports/, or the port's.
 */

import { isBadResourcePath } from '../checks/loader';
import type { LoadedModel } from '../core/contracts';
import { fileNameOf, folderOf, resolve } from '../ports/mtl';

/** Base texture → the livery's texture, pack paths (`assets/<ns>/…`). */
export type LiverySwaps = ReadonlyMap<string, string>;

/** `assets/<ns>/<path>` → namespace and path; null for a path elsewhere. */
function splitAsset(packPath: string): { namespace: string; path: string } | null {
  const m = /^assets\/([^/]+)\/(.+)$/.exec(packPath);
  return m === null ? null : { namespace: m[1]!, path: m[2]! };
}

/**
 * Each livery's texture swaps (`IrStockModel.liveries`): for every base texture, the file
 * of the same name in the livery's folder — relative to the OBJ's folder, `..` allowed —
 * if the pack has it and Minecraft takes its path. A livery that replaces nothing has no
 * swaps (the engine warns and draws the base textures).
 *
 * @param obj the model's OBJ, pack path (`assets/<ns>/stock/coach/coach.obj`)
 * @param liveries livery id → folder, as the model declares them (`liveries`), in order
 * @param textures the model's base textures, pack paths (what its MTL files name)
 * @param exists whether the pack has the file
 */
export function liverySwaps(
  obj: string,
  liveries: Readonly<Record<string, string>>,
  textures: Iterable<string>,
  exists: (packPath: string) => boolean,
): Map<string, LiverySwaps> {
  const at = splitAsset(obj);
  const bases = [...textures];
  const swapsOf = new Map<string, LiverySwaps>();
  for (const [livery, folder] of Object.entries(liveries)) {
    const swaps = new Map<string, string>();
    if (at !== null) {
      const objFolder = folderOf(at.path);
      for (const base of bases) {
        const relative = resolve(objFolder, `${folder}/${fileNameOf(base)}`);
        if (relative === null) continue;
        const swap = `assets/${at.namespace}/${relative}`;
        if (!isBadResourcePath(swap) && exists(swap)) swaps.set(base, swap);
      }
    }
    swapsOf.set(livery, swaps);
  }
  return swapsOf;
}

/**
 * The model drawn in a livery: the same model with each swapped texture's place holding
 * the livery's picture (null if the model has none decoded for it — the view then draws
 * the texture as missing). The base model for no swaps.
 */
export function inLivery(model: LoadedModel, swaps: LiverySwaps | undefined): LoadedModel {
  if (swaps === undefined || swaps.size === 0) return model;
  const textures = { ...model.textures };
  for (const [base, swap] of swaps) textures[base] = model.textures[swap] ?? null;
  return { ...model, textures };
}
