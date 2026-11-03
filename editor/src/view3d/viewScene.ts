/**
 * What the 3D view draws and how it answers the pointer, without the canvas: the three.js
 * scene (model, guides, overlays, light), the cameras and their framing, picking by ray,
 * the hover and the click. It follows {@link ViewState} and the shared selection signal;
 * ./viewport.ts adds the WebGL renderer, the orbit controls and the DOM events. Kept apart
 * so it is tested without WebGL.
 *
 * Pointer positions are normalised device coordinates: −1…1 across the canvas, +y up.
 */

import { effect, untracked, type Signal } from '@preact/signals';
import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  Group,
  OrthographicCamera,
  PerspectiveCamera,
  Ray,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
} from 'three';
import type { Link, OverlayShape, PickHit, Vec3 } from '../core/contracts';
import { FOV, frameOrtho, framePerspective, placeOrtho, placePerspective, VIEW_PRESETS, type CameraView } from './cameras';
import { GUIDE_LAYERS, Guides } from './guides';
import { ModelScene, type ModelLook, type ObjectHit } from './modelScene';
import { add, ordered, pickShape } from './overlayGeometry';
import { disposeLayer, layerObject } from './overlays';
import { VIEW_BACKGROUND } from './roleColors';
import { isSelected, objectLink, selectedObjects, selectionAfterClick } from './selection';
import { GHOSTS_LAYER, type ViewState } from './state';

/** The light, as a share of what shows a colour as it is (π in three.js's units): even light for the roles and textures… */
const LIGHT_DAY = { ambient: 0.62, sun: 0.42 };
/** …and night for the "lit" display, where only lit objects shine, against the dark background. */
const LIGHT_NIGHT = { ambient: 0.07, sun: 0.05 };
/** Where the light comes from, in the camera's axes: above and to the left of the eye. */
const SUN_FROM_CAMERA = new Vector3(-0.35, 0.6, 1);

/** What a click or the pointer is over: an object (with the point) or else an overlay shape's link. */
export interface ViewHit {
  readonly object?: ObjectHit;
  readonly link?: Link;
}

export class ViewScene {
  readonly scene = new Scene();
  readonly perspective = new PerspectiveCamera(FOV, 1, 0.01, 1000);
  readonly ortho = new OrthographicCamera(-1, 1, 1, -1, 0.01, 1000);
  /** What the camera looks at and orbits around; the orbit controls share this vector. */
  readonly target = new Vector3();
  readonly guides = new Guides();
  private readonly overlayRoot = new Group();
  private readonly overlayGroups = new Map<string, Group>();
  private readonly ambient = new AmbientLight(0xffffff);
  private readonly sun = new DirectionalLight(0xffffff);
  private modelScene: ModelScene | null = null;
  private aspectRatio = 1;
  private view: CameraView = 'orbit';
  private hovered: string | null = null;
  private dark = false;
  private night = false;
  private stops: (() => void)[] = [];

  constructor(
    readonly state: ViewState,
    readonly selection: Signal<readonly Link[]>,
    /** Asks for a new picture (the viewport draws on the next frame). */
    readonly invalidate: () => void = () => undefined,
  ) {
    this.scene.background = new Color(VIEW_BACKGROUND.light);
    this.overlayRoot.name = 'overlays';
    this.scene.add(this.ambient, this.guides.root, this.overlayRoot, this.perspective, this.ortho);
    this.perspective.add(this.sun, this.sun.target);
    this.sun.position.copy(SUN_FROM_CAMERA);
    this.sun.target.position.set(0, 0, -1);
  }

  /** The camera drawing now: the perspective one in the orbit, the orthographic one in the fixed views. */
  get camera(): PerspectiveCamera | OrthographicCamera {
    return VIEW_PRESETS[this.view].ortho ? this.ortho : this.perspective;
  }

  get cameraView(): CameraView {
    return this.view;
  }

  /** The model drawn now. */
  get model(): ModelScene | null {
    return this.modelScene;
  }

  /** Follows the state and the selection until the returned function is called (and `dispose`). */
  start(): () => void {
    const state = this.state;
    this.stops.push(
      state.attach({
        transformChanged: (object) => {
          this.modelScene?.setTransform(object, state.transforms.get(object) ?? null);
          this.invalidate();
        },
        visibilityChanged: (object) => {
          this.modelScene?.setVisible(object, !state.hidden.has(object));
          this.invalidate();
        },
        litChanged: (object) => {
          this.modelScene?.setLit(object, state.lit.has(object));
          this.invalidate();
        },
        overlayChanged: (layer) => {
          this.buildOverlay(layer);
          this.invalidate();
        },
      }),
      effect(() => {
        const model = state.model.value;
        untracked(() => this.setModel(model));
      }),
      effect(() => {
        const look: ModelLook = {
          display: state.display.value,
          wireframe: state.wireframe.value,
          ghosts: !state.hiddenLayers.value.has(GHOSTS_LAYER),
          hiddenRoles: state.hiddenRoles.value,
        };
        const night = look.display === 'lit';
        const light = night ? LIGHT_NIGHT : LIGHT_DAY;
        this.ambient.intensity = light.ambient * Math.PI;
        this.sun.intensity = light.sun * Math.PI;
        untracked(() => {
          this.night = night;
          this.paintBackground();
        });
        untracked(() => this.modelScene?.setLook(look));
        this.invalidate();
      }),
      effect(() => {
        const hidden = state.hiddenLayers.value;
        for (const layer of GUIDE_LAYERS) this.guides.setVisible(layer, !hidden.has(layer));
        for (const [name, group] of this.overlayGroups) group.visible = !hidden.has(name);
        this.invalidate();
      }),
      effect(() => {
        const frame = state.frame.value;
        untracked(() => this.guides.update(this.modelScene?.bounds() ?? new Box3(), frame));
        this.invalidate();
      }),
      effect(() => {
        const view = state.camera.value;
        void state.cameraSerial.value;
        untracked(() => this.setCameraView(view));
      }),
      effect(() => {
        const chosen = this.selection.value;
        untracked(() => {
          this.modelScene?.setHighlight(this.hovered, selectedObjects(chosen, this.modelScene.model.id));
          // a copy of the names: building a layer again puts it back into the map being walked
          for (const layer of [...this.overlayGroups.keys()]) this.buildOverlay(layer);
        });
        this.invalidate();
      }),
      effect(() => {
        const { serial, what } = state.framing.value;
        if (serial > 0) untracked(() => this.frame(what));
      }),
    );
    for (const layer of state.overlays.keys()) this.buildOverlay(layer);
    return () => this.stop();
  }

  private stop(): void {
    for (const stop of this.stops.splice(0)) stop();
  }

  private setModel(model: ViewState['model']['value']): void {
    this.modelScene?.dispose();
    this.modelScene = null;
    this.hovered = null;
    if (model !== null) {
      const scene = new ModelScene(model);
      const state = this.state;
      scene.setLook({
        display: state.display.peek(),
        wireframe: state.wireframe.peek(),
        ghosts: !state.hiddenLayers.peek().has(GHOSTS_LAYER),
        hiddenRoles: state.hiddenRoles.peek(),
      });
      for (const [object, matrix] of state.transforms) scene.setTransform(object, matrix);
      for (const object of state.hidden) scene.setVisible(object, false);
      for (const object of state.lit) scene.setLit(object, true);
      scene.setHighlight(null, selectedObjects(this.selection.peek(), model.id));
      this.scene.add(scene.root);
      this.modelScene = scene;
    }
    this.guides.update(this.modelScene?.bounds() ?? new Box3(), this.state.frame.peek());
    this.frame('all');
  }

  private buildOverlay(layer: string): void {
    const old = this.overlayGroups.get(layer);
    if (old !== undefined) {
      this.overlayRoot.remove(old);
      disposeLayer(old);
      this.overlayGroups.delete(layer);
    }
    const shapes = this.state.overlays.get(layer);
    if (shapes === undefined) return;
    const chosen = this.selection.peek();
    const group = layerObject(layer, shapes, (link) => isSelected(chosen, link));
    group.visible = !this.state.hiddenLayers.peek().has(layer);
    this.overlayGroups.set(layer, group);
    this.overlayRoot.add(group);
  }

  /** The background for the colour scheme: dark in the dark scheme, and at night (the "lit" display) in either. */
  setDark(dark: boolean): void {
    this.dark = dark;
    this.paintBackground();
  }

  private paintBackground(): void {
    (this.scene.background as Color).set(this.dark || this.night ? VIEW_BACKGROUND.dark : VIEW_BACKGROUND.light);
    this.invalidate();
  }

  /** The drawing's width over its height. */
  setAspect(aspect: number): void {
    if (!(aspect > 0) || !Number.isFinite(aspect)) return;
    this.aspectRatio = aspect;
    this.perspective.aspect = aspect;
    this.perspective.updateProjectionMatrix();
    const half = (this.ortho.top - this.ortho.bottom) / 2;
    this.ortho.left = -half * aspect;
    this.ortho.right = half * aspect;
    this.ortho.updateProjectionMatrix();
    this.invalidate();
  }

  get aspect(): number {
    return this.aspectRatio;
  }

  /** Switches to a view: the orbit starts from three quarters, the fixed views look along their axis; then frames the model. */
  setCameraView(view: CameraView): void {
    const camera = VIEW_PRESETS[view].ortho ? this.ortho : this.perspective;
    this.view = view;
    camera.add(this.sun, this.sun.target);
    this.place(this.modelBox(), VIEW_PRESETS[view].towardsCamera);
  }

  /** Frames the whole model, or the selection (its objects and its overlay shapes; the whole model when nothing of it is shown). */
  frame(what: 'all' | 'selected'): void {
    let box = what === 'selected' ? this.selectionBox() : new Box3();
    if (box.isEmpty()) box = this.modelBox();
    const preset = VIEW_PRESETS[this.view];
    // the fixed views keep their axis; the orbit keeps the direction the user turned it to
    const towards = preset.ortho ? preset.towardsCamera : this.perspective.position.clone().sub(this.target).normalize();
    this.place(box, towards.lengthSq() > 0 ? towards : preset.towardsCamera);
  }

  private place(box: Box3, towardsCamera: Vector3): void {
    const preset = VIEW_PRESETS[this.view];
    if (preset.ortho) {
      const placement = frameOrtho(box, towardsCamera, preset.up, this.aspectRatio);
      placeOrtho(this.ortho, placement, this.aspectRatio);
      this.target.copy(placement.target);
    } else {
      const placement = framePerspective(box, towardsCamera, preset.up, FOV, this.aspectRatio);
      placePerspective(this.perspective, placement, this.aspectRatio);
      this.target.copy(placement.target);
    }
    this.invalidate();
  }

  /** The model's box, or a car's room around the origin when there is none. */
  private modelBox(): Box3 {
    const box = this.modelScene?.bounds() ?? new Box3();
    return box.isEmpty() ? new Box3(new Vector3(-6, 0, -2), new Vector3(6, 4, 2)) : box;
  }

  private selectionBox(): Box3 {
    const chosen = this.selection.peek();
    const box = this.modelScene?.bounds(selectedObjects(chosen, this.modelScene.model.id)) ?? new Box3();
    for (const shapes of this.state.overlays.values()) {
      for (const shape of shapes) {
        if (shape.link === undefined || !isSelected(chosen, shape.link)) continue;
        for (const corner of shapeCorners(shape)) box.expandByPoint(new Vector3(...corner));
      }
    }
    return box;
  }

  /** The ray from the camera through a point of the drawing. */
  rayAt(x: number, y: number): Ray {
    const raycaster = new Raycaster();
    this.camera.updateMatrixWorld();
    raycaster.setFromCamera(new Vector2(x, y), this.camera);
    return raycaster.ray;
  }

  /** What is under a point of the drawing: the nearest object drawn, else the nearest overlay shape with a link in a shown layer. */
  hitAt(x: number, y: number): ViewHit {
    const ray = this.rayAt(x, y);
    const object = this.modelScene?.pick(ray) ?? null;
    if (object !== null) return { object };
    const hidden = this.state.hiddenLayers.peek();
    const shown = [...this.state.overlays].filter(([layer]) => !hidden.has(layer)).map(([, shapes]) => shapes);
    const shape = pickShape({ origin: ray.origin.toArray(), direction: ray.direction.toArray() }, shown);
    return shape === null ? {} : { link: shape.link };
  }

  /** The pointer moved to a point of the drawing (null: it left): tints the object under it and tells the status line. */
  hoverAt(point: { x: number; y: number } | null): void {
    const hit = point === null ? {} : this.hitAt(point.x, point.y);
    const object = hit.object?.object ?? null;
    const hover: PickHit | null = hit.object === undefined ? null : { object: hit.object.object, point: hit.object.point };
    if (!sameHit(this.state.hover.peek(), hover)) this.state.hover.value = hover;
    if (object !== this.hovered) {
      this.hovered = object;
      const model = this.modelScene;
      model?.setHighlight(object, selectedObjects(this.selection.peek(), model.model.id));
      this.invalidate();
    }
  }

  /**
   * A click at a point of the drawing: tells the pick listeners what it hit, then selects
   * it (Shift: adds it, or takes it out); a click on nothing keeps the selection. Returns
   * the hit.
   */
  clickAt(x: number, y: number, additive: boolean): ViewHit {
    const hit = this.hitAt(x, y);
    const model = this.modelScene?.model.id ?? null;
    this.state.emitPick(hit.object === undefined ? {} : { object: hit.object.object, point: hit.object.point });
    const link = hit.object !== undefined && model !== null ? objectLink(model, hit.object.object) : (hit.link ?? null);
    const next = selectionAfterClick(this.selection.peek(), link, additive);
    if (next !== this.selection.peek()) this.selection.value = next;
    return hit;
  }

  /** Where a point of the OBJ frame lands in the drawing, in normalised device coordinates. */
  project(point: Vec3): { x: number; y: number } {
    const p = new Vector3(...point).project(this.camera);
    return { x: p.x, y: p.y };
  }

  dispose(): void {
    this.stop();
    this.modelScene?.dispose();
    this.modelScene = null;
    for (const group of this.overlayGroups.values()) disposeLayer(group);
    this.overlayGroups.clear();
    this.guides.dispose();
  }
}

function sameHit(a: PickHit | null, b: PickHit | null): boolean {
  if (a === null || b === null) return a === b;
  return a.object === b.object && (a.point ?? []).join() === (b.point ?? []).join();
}

/** The corners of a shape's extent, for framing it. */
function shapeCorners(shape: OverlayShape): Vec3[] {
  switch (shape.shape) {
    case 'box':
    case 'rect':
      return ordered(shape.min, shape.max);
    case 'arrow':
      return [shape.from, shape.to];
    case 'arc':
      return [shape.centre, shape.from];
    case 'circle':
      return [add(shape.centre, [-shape.radius, 0, -shape.radius]), add(shape.centre, [shape.radius, 0, shape.radius])];
  }
}
