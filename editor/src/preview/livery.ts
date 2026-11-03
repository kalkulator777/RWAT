/**
 * Liveries (paint schemes) in the preview. A livery is the model drawn against other
 * textures: which texture it swaps for which the model worker finds as the engine does
 * (core/contracts `LoadedModel.liveries`, `IrStockModel.liveries`); the livery's own
 * pictures are decoded on demand (model/client `ModelLoader.textures`), as the base ones
 * are with the model, and the view is told to draw each swapped texture with the livery's
 * picture (`ViewApi.setTexture`): the camera, the selection and the preview's state stay.
 */

import type { LoadedModel } from '../core/contracts';

/** Base texture → the livery's texture, pack paths (`assets/<ns>/…`). */
export type LiverySwaps = Readonly<Record<string, string>>;

/** The livery's textures that neither the model nor `decoded` holds a picture (or a known absence) for. */
export function undecoded(model: LoadedModel, swaps: LiverySwaps, decoded: ReadonlyMap<string, ImageBitmap | null>): string[] {
  return [...new Set(Object.values(swaps))].filter((path) => !(path in model.textures) && !decoded.has(path));
}

/**
 * What the view is to draw the textures with when the model goes from the swaps `from`
 * to the swaps `to` (undefined: the base textures): each base texture either swaps
 * touches, with the picture of `to`'s texture — the model's own or one in `decoded`; null
 * when neither has one, and the view draws that texture as missing — or, when `to` keeps
 * it, with the model's own picture again. In the order the swaps list them.
 */
export function liveryTextures(
  model: LoadedModel,
  from: LiverySwaps | undefined,
  to: LiverySwaps | undefined,
  decoded: ReadonlyMap<string, ImageBitmap | null> = new Map(),
): [string, ImageBitmap | null][] {
  const bases = new Set([...Object.keys(from ?? {}), ...Object.keys(to ?? {})]);
  return [...bases].map((base) => {
    const swap = to?.[base];
    return [base, swap === undefined ? (model.textures[base] ?? null) : (model.textures[swap] ?? decoded.get(swap) ?? null)];
  });
}
