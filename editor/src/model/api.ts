/**
 * The model worker's interface (./types.ts `ModelWorkerApi`) as an object: what
 * ../workers/model.worker.ts exposes through comlink, and what the tests call directly
 * or through a MessageChannel. The worker keeps no state of the pack: each call gets the
 * request and a reader of the pack's files and gives back the result, its buffers and
 * bitmaps marked for transfer (`comlink.transfer`), so they move to the main thread
 * instead of being copied; a check ("Check all models") gives back only its findings.
 */

import { transfer } from 'comlink';
import { buildModel, checkModel, decodeTextures } from './build';
import type { ModelCheckApi, ModelWorkerApi, TextureDecoder } from './types';

/**
 * A PNG as the view samples it: decoded off the main thread, upside down (`flipY`), so
 * the file's UVs (V up, ./build.ts) need no turning; alpha not premultiplied, so cut-out
 * edges stay as drawn. Null when the bytes are no image this browser decodes.
 */
export const decodeImage: TextureDecoder = async (bytes) => {
  try {
    return await createImageBitmap(new Blob([bytes.slice()], { type: 'image/png' }), { imageOrientation: 'flipY', premultiplyAlpha: 'none' });
  } catch {
    return null;
  }
};

/** The worker's interface, decoding textures with `decode` ({@link decodeImage} in the browser). */
export function createModelApi(decode: TextureDecoder = decodeImage): ModelWorkerApi & ModelCheckApi {
  return {
    async load(request, files) {
      const built = await buildModel(request, files, decode);
      return transfer(built.model, built.transfer);
    },
    async textures(paths, files) {
      const bitmaps = await decodeTextures(paths, files, decode);
      const decoded = [...bitmaps.values()].filter((bitmap) => bitmap !== null);
      return transfer(Object.fromEntries(bitmaps), decoded);
    },
    check: (request, files) => checkModel(request, files),
  };
}
