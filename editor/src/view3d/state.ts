/**
 * The 3D view as the other modules drive it (core/contracts `ViewApi`, docs/proposals/
 * editor.md §3.8, §3.13): {@link view} keeps what they asked for — the model, the display,
 * the wireframe, the type's frame, each object's transform, visibility and light, the
 * pictures of swapped textures, the overlay layers — whether or not the view is on the
 * screen; the drawing (./viewport.ts) reads it when it starts and is told of each change
 * after. The view's own choices (camera, layers, roles shown) live here too, as signals
 * the view's bar reads.
 *
 * `show` starts a model afresh: the transforms, visibility, light and texture swaps of the
 * one before are forgotten (the preview sets them again for the new one). The frame and
 * the overlays stay: the frame is the wagon's, set with its model; the layers belong to
 * the tools, which clear them themselves.
 *
 * Beyond `ViewApi`, a markup tool may take the presses of the left button
 * ({@link ViewDragger}, `setDragger`): it draws and drags its shapes where the camera
 * would otherwise turn or pan.
 */

import { batch, signal } from '@preact/signals';
import type { DisplayMode, LoadedModel, OverlayShape, PickHit, Vec3, ViewApi, WagonFrame } from '../core/contracts';
import type { CameraView } from './cameras';

/** What the drawing does with a change the state cannot give it as a signal: one object's, one texture's or one layer's. */
export interface ViewSink {
  transformChanged(object: string): void;
  visibilityChanged(object: string): void;
  litChanged(object: string): void;
  textureChanged(path: string): void;
  overlayChanged(layer: string): void;
}

/** What is under the pointer: the object and the point where the ray meets it. */
export interface Hover {
  object: string;
  point: Vec3;
}

/** Where the pointer is, as a tool that takes the view's presses reads it (./viewport.ts, {@link ViewDragger}). */
export interface ViewPointer {
  /** The ray from the eye through the pointer, OBJ frame. */
  readonly origin: Vec3;
  /** The ray's direction, of length 1. */
  readonly direction: Vec3;
  /** How many blocks one CSS pixel spans at the camera's target: a tolerance in pixels made one in blocks. */
  readonly pixel: number;
  /** The camera's view: a tool may take the presses of some views only (the floor's, from the top). */
  readonly view: CameraView;
  readonly shift: boolean;
  /** Ctrl, or ⌘ on a Mac. */
  readonly ctrl: boolean;
  readonly alt: boolean;
}

/**
 * A tool that takes presses of the left button in the view instead of the camera: the
 * markup tools draw, move and stretch their shapes by dragging (docs/proposals/editor.md
 * §3.9). The view asks it at every press of the left button; a press it takes moves no
 * camera and, unless {@link click} gives it back, picks nothing. One at a time
 * ({@link ViewState.setDragger}).
 */
export interface ViewDragger {
  /** The left button went down: true takes the press — its drag, and its click unless {@link click} gives it back. */
  press(at: ViewPointer): boolean;
  /** The pointer moved, the button held, once it is past the click's slop. */
  drag(at: ViewPointer): void;
  /** The button went up after a drag. */
  release(at: ViewPointer): void;
  /** The button went up where it went down: true if the tool took the click, false for the view's own (pick and select). */
  click(at: ViewPointer): boolean;
  /** The press ended without a release (the pointer was cancelled or lost). */
  cancel(): void;
  /** The pointer moves with no button held (null: it left the view): the CSS cursor to show, null for the view's own. */
  hover?(at: ViewPointer | null): string | null;
}

/** The layer switch of the ghosts: the roles the engine drops. */
export const GHOSTS_LAYER = 'ghosts';

export class ViewState implements ViewApi {
  /** The model shown, null for none. */
  readonly model = signal<LoadedModel | null>(null);
  readonly display = signal<DisplayMode>('roles');
  /** A wireframe over the display. */
  readonly wireframe = signal(false);
  readonly camera = signal<CameraView>('orbit');
  /** Grows each time a view is asked for, the same one again included: asking again lines the camera up afresh. */
  readonly cameraSerial = signal(0);
  /** The wagon type's frame for the guides (hull, pivots, couplers); null while no type is known. */
  readonly frame = signal<WagonFrame | null>(null);
  /** Roles whose objects are not drawn. */
  readonly hiddenRoles = signal<ReadonlySet<string>>(new Set());
  /** Layers switched off: guide layers (./guides.ts), {@link GHOSTS_LAYER}, overlay layers by name. */
  readonly hiddenLayers = signal<ReadonlySet<string>>(new Set());
  /** The overlay layers that have shapes, sorted: the bar lists their switches. */
  readonly overlayLayers = signal<readonly string[]>([]);
  /** What is under the pointer: the object and the point, or null. */
  readonly hover = signal<Hover | null>(null);
  /** Asks the drawing to frame something: a counter that grows with each request, and what to frame. */
  readonly framing = signal<{ serial: number; what: 'all' | 'selected' }>({ serial: 0, what: 'all' });

  /** Each object's transform, column-major in the OBJ frame; an object without one stands at rest. */
  readonly transforms = new Map<string, Float32Array>();
  /** Objects the preview hid. */
  readonly hidden = new Set<string>();
  /** Objects the preview lit. */
  readonly lit = new Set<string>();
  /** The pictures textures are drawn with instead of the model's own, by pack path (null: none, drawn as missing). */
  readonly textures = new Map<string, ImageBitmap | null>();
  /** The overlay layers by name; a layer with no shapes is not kept. */
  readonly overlays = new Map<string, readonly OverlayShape[]>();

  private sink: ViewSink | null = null;
  private readonly listeners = new Set<(hit: PickHit) => void>();
  private draggerOf: ViewDragger | null = null;

  show(model: LoadedModel | null): void {
    this.transforms.clear();
    this.hidden.clear();
    this.lit.clear();
    this.textures.clear();
    this.hover.value = null;
    this.model.value = model;
  }

  setDisplay(mode: DisplayMode): void {
    this.display.value = mode;
  }

  setWireframe(on: boolean): void {
    this.wireframe.value = on;
  }

  setFrame(frame: WagonFrame | null): void {
    this.frame.value = frame;
  }

  setTransform(object: string, matrix4: Float32Array | null): void {
    if (matrix4 === null) this.transforms.delete(object);
    else if (matrix4.length >= 16) this.transforms.set(object, new Float32Array(matrix4.subarray(0, 16)));
    else return;
    this.sink?.transformChanged(object);
  }

  setVisible(object: string, visible: boolean): void {
    if (visible) this.hidden.delete(object);
    else this.hidden.add(object);
    this.sink?.visibilityChanged(object);
  }

  setLit(object: string, lit: boolean): void {
    if (lit) this.lit.add(object);
    else this.lit.delete(object);
    this.sink?.litChanged(object);
  }

  setTexture(path: string, bitmap: ImageBitmap | null): void {
    this.textures.set(path, bitmap);
    this.sink?.textureChanged(path);
  }

  /** The picture texture `path` is drawn with now: a swapped one, else the model's own; null for none. */
  textureOf(path: string): ImageBitmap | null {
    return this.textures.has(path) ? (this.textures.get(path) ?? null) : (this.model.peek()?.textures[path] ?? null);
  }

  overlay(layer: string, shapes: OverlayShape[]): void {
    if (shapes.length === 0) this.overlays.delete(layer);
    else this.overlays.set(layer, [...shapes]);
    const names = [...this.overlays.keys()].sort();
    const before = this.overlayLayers.value;
    if (names.length !== before.length || names.some((name, i) => name !== before[i])) this.overlayLayers.value = names;
    this.sink?.overlayChanged(layer);
  }

  onPick(listener: (hit: PickHit) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Tells every pick listener what a click hit (the drawing calls it). */
  emitPick(hit: PickHit): void {
    for (const listener of [...this.listeners]) listener(hit);
  }

  /** Gives the presses of the left button to a tool, or back to the camera (null). One tool at a time: the last set wins. */
  setDragger(dragger: ViewDragger | null): void {
    this.draggerOf = dragger;
  }

  /** The tool that takes the presses now, or null (./viewport.ts asks it at each press). */
  get dragger(): ViewDragger | null {
    return this.draggerOf;
  }

  /** Switches the camera to a view, or lines it up afresh if it is that view already. */
  setCamera(camera: CameraView): void {
    batch(() => {
      this.camera.value = camera;
      this.cameraSerial.value++;
    });
  }

  /** Asks the drawing to frame the whole model or the selection. */
  requestFraming(what: 'all' | 'selected'): void {
    this.framing.value = { serial: this.framing.value.serial + 1, what };
  }

  /** Switches a layer (guide, ghosts or overlay) on or off. */
  setLayerShown(layer: string, shown: boolean): void {
    const next = new Set(this.hiddenLayers.value);
    if (shown) next.delete(layer);
    else next.add(layer);
    this.hiddenLayers.value = next;
  }

  /** Shows or hides the objects of a role. */
  setRoleShown(role: string, shown: boolean): void {
    const next = new Set(this.hiddenRoles.value);
    if (shown) next.delete(role);
    else next.add(role);
    this.hiddenRoles.value = next;
  }

  /** The drawing that is told of each change; one at a time. Returns the function that detaches it. */
  attach(sink: ViewSink): () => void {
    this.sink = sink;
    return () => {
      if (this.sink === sink) this.sink = null;
    };
  }
}

/** The editor's one 3D view: preview and tools drive it through this (`ViewApi`). */
export const view = new ViewState();
