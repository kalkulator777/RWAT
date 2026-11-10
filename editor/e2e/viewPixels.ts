/**
 * What the browser tests read of the 3D view's picture: the colour drawn at points of the
 * OBJ frame, through the test hook the page exposes when asked before it starts
 * (src/view3d/testHook.ts), and the brightness of a colour.
 */

import type { Page } from '@playwright/test';
import type { ViewTestHook } from '../src/view3d/testHook';

/** The page's window as the tests see it: the flag that asks for the hook, and the hook. */
export type HookWindow = { __RWAT_E2E__?: boolean; __rwatView?: ViewTestHook | null };

type Vec3 = [number, number, number];

/** Draws now and reads the drawing's colour at each point of the OBJ frame, as `[r, g, b]`. */
export async function coloursAt(page: Page, points: readonly Vec3[]): Promise<Vec3[]> {
  return page.evaluate(async (points) => {
    const hook = (window as HookWindow).__rwatView;
    const canvas = document.querySelector<HTMLCanvasElement>('.view3d-gl');
    if (!hook || !canvas) throw new Error('no view');
    hook.renderNow();
    // read in the same task as the drawing: the canvas keeps no copy of it
    const image = new Image();
    image.src = canvas.toDataURL('image/png');
    await image.decode();
    const copy = document.createElement('canvas');
    copy.width = image.width;
    copy.height = image.height;
    const context = copy.getContext('2d');
    if (!context) throw new Error('no 2d');
    context.drawImage(image, 0, 0);
    const rect = canvas.getBoundingClientRect();
    return points.map((point) => {
      const at = hook.pointOnPage(point);
      const x = Math.round(((at.x - rect.left) / rect.width) * image.width);
      const y = Math.round(((at.y - rect.top) / rect.height) * image.height);
      const pixel = context.getImageData(x, y, 1, 1).data;
      return [pixel[0] ?? 0, pixel[1] ?? 0, pixel[2] ?? 0] as Vec3;
    });
  }, points);
}

/** Relative luminance 0…255 of an sRGB pixel, near enough. */
export function luminance(pixel: readonly number[]): number {
  return 0.2126 * pixel[0]! + 0.7152 * pixel[1]! + 0.0722 * pixel[2]!;
}
