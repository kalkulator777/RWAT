/**
 * The model pipeline (docs/proposals/editor.md §3.2, §3.11): a wagon model of the open
 * pack read in a worker, its parts' roles as the engine has them, buffers for the view,
 * textures decoded, the last few models kept.
 *
 * On the main thread: `startModelWorker()`, then `new ModelLoader(worker.api)` and
 * `loader.load(packFiles(pack), { id, file, declaration })` → a `LoadedModel` of
 * core/contracts.
 */

export { createModelApi, decodeImage } from './api';
export { buildModel, checkFiles, checkModel, emptyModel, roleId, type Built } from './build';
export { ModelCache, type Stamp } from './cache';
export { checkModelFiles, lazyModelWorker, ModelLoader, startModelWorker, type ModelWorker } from './client';
export { MISSING, packFiles, sourceFiles, type EditedPack, type ModelFiles } from './files';
export { assetFile, relativeFile, resourceFile } from './resources';
export type { ModelCheckApi, ModelReader, ModelRequest, ModelWorkerApi, TextureDecoder } from './types';
