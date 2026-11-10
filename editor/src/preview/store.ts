/**
 * The editor's one preview (the "Preview" tab drives it, panels/preview/).
 *
 * Wired by the shell (app/start.ts, app/openModel.ts):
 * - to the 3D view: `preview.view.value = view`;
 * - to each model opened and shown in it (`view.show(model)` first), with the files it was
 *   read from and its paired wagon type (ports/wagonType `loadWagonType(...).type`, null
 *   for none): `preview.load({ model, type, textures: (paths) => loader.textures(files,
 *   paths) })` — model/client `ModelLoader`, which decodes a livery's pictures on demand;
 *   `preview.load(null)` when it closes.
 */

import { PreviewController } from './controller';

export const preview = new PreviewController();
