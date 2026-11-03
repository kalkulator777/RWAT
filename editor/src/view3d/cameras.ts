/**
 * The cameras of the 3D view (docs/proposals/editor.md §3.8): a perspective camera that
 * orbits freely, starting from three quarters front-left and above; and orthographic
 * views from the top, the side and the front, like Blender's numeric keypad. The scene is
 * the OBJ frame: Y up, the car along X, its front towards −X, +Z its left side.
 *
 * - top: looks down −Y, the front (−X) on the left and the left side (+Z) at the bottom of
 *   the screen, as Blender's Top (7) shows an OBJ exported Y up;
 * - side: from +Z (the car's left side), the front on the left (Blender's Front, 1);
 * - front: from −X, facing the car's front end, its left side (+Z) on the right (3).
 *
 * Framing puts the box's centre in the middle and backs off just so far that all eight
 * corners are in the picture: exact for the box, not a sphere around it, so a long car
 * fills a wide view.
 */

import { Box3, Matrix4, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';

/** What the camera shows: the free orbit or one of the fixed orthographic views. */
export type CameraView = 'orbit' | 'top' | 'side' | 'front';

export const CAMERA_VIEWS: readonly CameraView[] = ['orbit', 'top', 'side', 'front'];

/** A view's direction: from the target towards the camera, the camera's up, and whether it is orthographic. */
export interface ViewPreset {
  readonly towardsCamera: Vector3;
  readonly up: Vector3;
  readonly ortho: boolean;
}

export const VIEW_PRESETS: Readonly<Record<CameraView, ViewPreset>> = {
  // three quarters: in front (−X), on the left side (+Z), above
  orbit: { towardsCamera: new Vector3(-0.75, 0.55, 1).normalize(), up: new Vector3(0, 1, 0), ortho: false },
  top: { towardsCamera: new Vector3(0, 1, 0), up: new Vector3(0, 0, -1), ortho: true },
  side: { towardsCamera: new Vector3(0, 0, 1), up: new Vector3(0, 1, 0), ortho: true },
  front: { towardsCamera: new Vector3(-1, 0, 0), up: new Vector3(0, 1, 0), ortho: true },
};

/** The perspective camera's vertical field of view, degrees. */
export const FOV = 40;

/** How much room framing leaves around the box: 1.08 is 8 % on the tighter side. */
export const FRAME_MARGIN = 1.08;

/** Where a camera goes: its place, what it looks at, its up, the clip planes, and for an orthographic one the half height of the view. */
export interface Placement {
  readonly position: Vector3;
  readonly target: Vector3;
  readonly up: Vector3;
  readonly near: number;
  readonly far: number;
  /** Orthographic only: half the height the view shows, blocks. */
  readonly halfHeight: number;
}

/** The corners of the box relative to its centre in the camera's axes (right, up, towards the camera). */
function cornersInView(box: Box3, towardsCamera: Vector3, up: Vector3): Vector3[] {
  const basis = new Matrix4().lookAt(towardsCamera, new Vector3(0, 0, 0), up);
  const right = new Vector3();
  const upward = new Vector3();
  const back = new Vector3();
  basis.extractBasis(right, upward, back);
  const centre = box.getCenter(new Vector3());
  const corners: Vector3[] = [];
  for (let i = 0; i < 8; i++) {
    const corner = new Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(centre);
    corners.push(new Vector3(corner.dot(right), corner.dot(upward), corner.dot(back)));
  }
  return corners;
}

/** A box with some size: an empty box becomes a block around the origin, a flat one gets a little depth. */
function usable(box: Box3): Box3 {
  if (box.isEmpty()) return new Box3(new Vector3(-0.5, -0.5, -0.5), new Vector3(0.5, 0.5, 0.5));
  const grown = box.clone();
  const size = grown.getSize(new Vector3());
  grown.expandByVector(new Vector3(size.x > 0 ? 0 : 0.05, size.y > 0 ? 0 : 0.05, size.z > 0 ? 0 : 0.05));
  return grown;
}

/** A perspective camera with the vertical `fov` (degrees) and `aspect` (width / height) looking along the view at the whole box. */
export function framePerspective(box: Box3, towardsCamera: Vector3, up: Vector3, fov: number, aspect: number, margin = FRAME_MARGIN): Placement {
  const frame = usable(box);
  const tanV = Math.tan((fov * Math.PI) / 360);
  const tanH = tanV * aspect;
  let distance = 0;
  for (const c of cornersInView(frame, towardsCamera, up)) {
    distance = Math.max(distance, c.z + (Math.abs(c.x) * margin) / tanH, c.z + (Math.abs(c.y) * margin) / tanV);
  }
  const radius = frame.getSize(new Vector3()).length() / 2;
  const target = frame.getCenter(new Vector3());
  return {
    position: target.clone().addScaledVector(towardsCamera.clone().normalize(), distance),
    target,
    up: up.clone(),
    near: Math.max(0.005, radius / 1000),
    far: distance + radius * 20 + 100,
    halfHeight: 0,
  };
}

/** An orthographic camera with `aspect` (width / height) looking along the view at the whole box. */
export function frameOrtho(box: Box3, towardsCamera: Vector3, up: Vector3, aspect: number, margin = FRAME_MARGIN): Placement {
  const frame = usable(box);
  let halfHeight = 0;
  for (const c of cornersInView(frame, towardsCamera, up)) halfHeight = Math.max(halfHeight, Math.abs(c.y), Math.abs(c.x) / aspect);
  const radius = frame.getSize(new Vector3()).length() / 2;
  const target = frame.getCenter(new Vector3());
  const distance = radius * 4 + 10;
  return {
    position: target.clone().addScaledVector(towardsCamera.clone().normalize(), distance),
    target,
    up: up.clone(),
    near: 0.01,
    far: distance * 2 + radius * 4,
    halfHeight: halfHeight * margin,
  };
}

/** Puts a perspective camera where the placement says. */
export function placePerspective(camera: PerspectiveCamera, placement: Placement, aspect: number): void {
  camera.up.copy(placement.up);
  camera.position.copy(placement.position);
  camera.near = placement.near;
  camera.far = placement.far;
  camera.aspect = aspect;
  camera.lookAt(placement.target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

/** Puts an orthographic camera where the placement says, its zoom back to 1. */
export function placeOrtho(camera: OrthographicCamera, placement: Placement, aspect: number): void {
  camera.up.copy(placement.up);
  camera.position.copy(placement.position);
  camera.near = placement.near;
  camera.far = placement.far;
  camera.zoom = 1;
  camera.top = placement.halfHeight;
  camera.bottom = -placement.halfHeight;
  setOrthoAspect(camera, aspect);
  camera.lookAt(placement.target);
  camera.updateMatrixWorld();
}

/** Fits an orthographic camera's width to a new aspect, keeping its height. */
export function setOrthoAspect(camera: OrthographicCamera, aspect: number): void {
  const half = (camera.top - camera.bottom) / 2;
  camera.left = -half * aspect;
  camera.right = half * aspect;
  camera.updateProjectionMatrix();
}

/** How many screen pixels one block spans at the target, for a view `heightPx` tall. */
export function pixelsPerBlock(camera: PerspectiveCamera | OrthographicCamera, target: Vector3, heightPx: number): number {
  if (camera instanceof OrthographicCamera) return (heightPx * camera.zoom) / (camera.top - camera.bottom);
  const distance = camera.position.distanceTo(target);
  return heightPx / (2 * distance * Math.tan((camera.fov * Math.PI) / 360));
}
