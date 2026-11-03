/**
 * The editor's one preview (the "Preview" tab drives it, panels/preview/).
 *
 * Wiring, done where the open model and the view are wired (app/, by the conductor):
 * - the 3D view, once it exists: `preview.view.value = view`;
 * - each model opened and shown in it (`view.show(model)` first): `preview.load({ model,
 *   parts, type, liveries })` — its moving things (./parts.ts, from ports/modelParts), the
 *   paired wagon type (ports/wagonType) and the livery swaps (./livery.ts `liverySwaps`);
 *   `preview.load(null)` when it closes.
 */

import { PreviewController } from './controller';

export const preview = new PreviewController();
