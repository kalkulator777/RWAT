/**
 * What the browser tests reach of the view (e2e/): the view's state, a drawing made now,
 * and where an object is on the page. Given only to a page that asked for it before the
 * editor started — the test sets `window.__RWAT_E2E__ = true` in an init script — so the
 * editor a user opens exposes nothing. The model itself comes the way it comes to a user:
 * a pack opened, a wagon picked, read by the model worker (app/openModel.ts).
 */

import type { Vec3 } from '../core/contracts';
import type { WagonFrame } from './frame';
import { view, type ViewState } from './state';
import type { Viewport } from './viewport';

/** The hook as `window.__rwatView`. */
export interface ViewTestHook {
  readonly view: ViewState;
  /** Draws now (a read of the canvas right after sees this picture). */
  renderNow(): void;
  /** The centre of an object as it is drawn, in page pixels; null if the model has no such object drawn. */
  screenOf(object: string): { x: number; y: number } | null;
  /** Where a point of the OBJ frame is on the page. */
  pointOnPage(point: Vec3): { x: number; y: number };
  /** Gives the guides a wagon type's frame (null: none). */
  setFrame(frame: WagonFrame | null): void;
}

type HookGlobal = { __RWAT_E2E__?: unknown; __rwatView?: ViewTestHook | null };

/** Exposes the viewport to a test page that asked for it; null takes it back. */
export function exposeForTests(viewport: Viewport | null): void {
  const global = globalThis as HookGlobal;
  if (global.__RWAT_E2E__ !== true) return;
  if (viewport === null) {
    global.__rwatView = null;
    return;
  }
  const pointOnPage = (point: Vec3) => viewport.toClient(viewport.scene.project(point));
  global.__rwatView = {
    view,
    renderNow: () => viewport.renderNow(),
    screenOf: (object) => {
      const model = viewport.scene.model;
      if (model === null || !model.isDrawn(object)) return null;
      const box = model.bounds([object]);
      if (box.isEmpty()) return null;
      const centre = box.getCenter(box.min.clone());
      return pointOnPage([centre.x, centre.y, centre.z]);
    },
    pointOnPage,
    setFrame: (frame) => {
      view.frame.value = frame;
    },
  };
}
