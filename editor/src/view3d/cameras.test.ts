import { Box3, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  CAMERA_VIEWS,
  FOV,
  frameOrtho,
  framePerspective,
  pixelsPerBlock,
  placeOrtho,
  placePerspective,
  setOrthoAspect,
  VIEW_PRESETS,
  type CameraView,
} from './cameras';

/** A coach-like box: 20 long along X, 3 wide, 4.3 tall. */
const COACH = new Box3(new Vector3(-10, -0.03, -1.5), new Vector3(10, 4.3, 1.5));
const ASPECT = 16 / 9;

function camera(view: CameraView, box = COACH, aspect = ASPECT): PerspectiveCamera | OrthographicCamera {
  const preset = VIEW_PRESETS[view];
  if (preset.ortho) {
    const ortho = new OrthographicCamera();
    placeOrtho(ortho, frameOrtho(box, preset.towardsCamera, preset.up, aspect), aspect);
    return ortho;
  }
  const perspective = new PerspectiveCamera(FOV);
  placePerspective(perspective, framePerspective(box, preset.towardsCamera, preset.up, FOV, aspect), aspect);
  return perspective;
}

/** Where a point of the scene lands on the screen, in normalised device coordinates (−1…1, +y up). */
function onScreen(cam: PerspectiveCamera | OrthographicCamera, x: number, y: number, z: number): Vector3 {
  return new Vector3(x, y, z).project(cam);
}

function corners(box: Box3): Vector3[] {
  return [0, 1, 2, 3, 4, 5, 6, 7].map(
    (i) => new Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z),
  );
}

describe('the cameras', () => {
  it('show the top with the front (−X) on the left and the left side (+Z) at the bottom, as Blender', () => {
    const top = camera('top');
    expect(top).toBeInstanceOf(OrthographicCamera);
    expect(onScreen(top, -5, 1, 0).x).toBeLessThan(0);
    expect(onScreen(top, 5, 1, 0).x).toBeGreaterThan(0);
    expect(onScreen(top, 0, 1, 1).y).toBeLessThan(0);
    // looking down: the roof is nearer than the floor
    expect(onScreen(top, 0, 4, 0).z).toBeLessThan(onScreen(top, 0, 0, 0).z);
  });

  it('show the side from +Z with the front on the left, and the front from −X with the left side on the right', () => {
    const side = camera('side');
    expect(onScreen(side, -5, 1, 0).x).toBeLessThan(0);
    expect(onScreen(side, 0, 3, 0).y).toBeGreaterThan(onScreen(side, 0, 1, 0).y);
    expect(onScreen(side, 0, 1, 1).z).toBeLessThan(onScreen(side, 0, 1, -1).z);
    const front = camera('front');
    expect(onScreen(front, 0, 1, 1).x).toBeGreaterThan(0);
    expect(onScreen(front, -9, 1, 0).z).toBeLessThan(onScreen(front, 9, 1, 0).z);
  });

  it('orbit from three quarters: in front, on the left side, above, in perspective', () => {
    const orbit = camera('orbit');
    expect(orbit).toBeInstanceOf(PerspectiveCamera);
    expect(orbit.position.x).toBeLessThan(0);
    expect(orbit.position.z).toBeGreaterThan(0);
    expect(orbit.position.y).toBeGreaterThan(COACH.max.y);
  });

  it('frame the whole box in every view and aspect, and fill the view along one side', () => {
    for (const view of CAMERA_VIEWS) {
      for (const aspect of [ASPECT, 0.6]) {
        const cam = camera(view, COACH, aspect);
        let widest = 0;
        for (const corner of corners(COACH)) {
          const p = onScreen(cam, corner.x, corner.y, corner.z);
          expect([view, aspect, Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && p.z > -1 && p.z < 1]).toEqual([view, aspect, true]);
          widest = Math.max(widest, Math.abs(p.x), Math.abs(p.y));
        }
        expect([view, aspect, widest]).toEqual([view, aspect, expect.closeTo(1 / 1.08, 2)]);
      }
    }
  });

  it('frame an empty box as a block at the origin and a flat one without failing', () => {
    const top = camera('top', new Box3());
    expect(Number.isFinite(top.position.y)).toBe(true);
    expect(onScreen(top, 0, 0, 0).x).toBeCloseTo(0, 9);
    const flat = camera('orbit', new Box3(new Vector3(-1, 0, -1), new Vector3(1, 0, 1)));
    expect(onScreen(flat, 1, 0, 1).x).toBeLessThanOrEqual(1);
  });

  it('keep an orthographic height when the view gets wider, and count the pixels a block spans', () => {
    const top = camera('top') as OrthographicCamera;
    const height = top.top - top.bottom;
    setOrthoAspect(top, 3);
    expect(top.top - top.bottom).toBeCloseTo(height, 12);
    expect(top.right - top.left).toBeCloseTo(height * 3, 12);
    expect(pixelsPerBlock(top, new Vector3(), 600)).toBeCloseTo(600 / height, 9);
    top.zoom = 2;
    expect(pixelsPerBlock(top, new Vector3(), 600)).toBeCloseTo(1200 / height, 9);
    const persp = new PerspectiveCamera(90);
    persp.position.set(0, 0, 5);
    expect(pixelsPerBlock(persp, new Vector3(), 1000)).toBeCloseTo(100, 9);
  });
});
