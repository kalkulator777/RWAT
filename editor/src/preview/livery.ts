/**
 * Liveries (paint schemes) in the preview. A livery is the model drawn against other
 * textures: which texture it swaps for which the model worker finds as the engine does
 * (model/types `ParsedModel.liveries`, `IrStockModel.liveries`); the livery's own pictures
 * are decoded on demand (model/client `ModelLoader.textures`), as the base ones are with
 * the model.
 */

import type { LoadedModel } from '../core/contracts';

/** Base texture → the livery's texture, pack paths (`assets/<ns>/…`). */
export type LiverySwaps = Readonly<Record<string, string>>;

/** The livery's textures that neither the model nor `decoded` holds a picture (or a known absence) for. */
export function undecoded(model: LoadedModel, swaps: LiverySwaps, decoded: ReadonlyMap<string, ImageBitmap | null>): string[] {
  return [...new Set(Object.values(swaps))].filter((path) => !(path in model.textures) && !decoded.has(path));
}

/**
 * The model drawn in a livery: the same model with each swapped texture's place holding
 * the livery's picture, from the model's own or from `decoded` — null if neither has one,
 * and the view draws that texture as missing. The base model itself for no swaps.
 */
export function inLivery<M extends LoadedModel>(model: M, swaps: LiverySwaps | undefined, decoded: ReadonlyMap<string, ImageBitmap | null> = new Map()): M {
  if (swaps === undefined || Object.keys(swaps).length === 0) return model;
  const textures = { ...model.textures };
  for (const [base, swap] of Object.entries(swaps)) textures[base] = model.textures[swap] ?? decoded.get(swap) ?? null;
  return { ...model, textures };
}
