/**
 * The 3D view on the screen: a WebGL canvas drawing {@link ViewScene}, orbit controls, and
 * the pointer and keys (docs/proposals/editor.md §3.8, §6.3).
 *
 * - Drawn on demand: a change of the state, the controls or the size asks for one frame;
 *   nothing is drawn while nothing changes.
 * - Mouse: left button orbits (pans in the fixed views), right button pans, the wheel
 *   zooms where it points. A press and release in one place is a click: it picks.
 *   Moving without a button pressed hovers, once a frame at most.
 * - Keys, with the view focused: 1 side, 3 front, 7 top (Blender's keypad), 5 the orbit
 *   from three quarters, Home frames everything, `.` frames the selection; the arrows pan.
 * - No animation: views and framing jump, so `prefers-reduced-motion` has nothing to stop.
 *
 * Without WebGL 2 (a browser that lacks it, the DOM of the unit tests) there is no
 * viewport: {@link Viewport.create} answers null and the panel says so.
 */

import type { Signal } from '@preact/signals';
import { MOUSE, WebGLRenderer, type OrthographicCamera, type PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Link } from '../core/contracts';
import { pixelsPerBlock, VIEW_PRESETS, type CameraView } from './cameras';
import { MINOR_GRID_MIN_PX } from './guides';
import type { ViewState } from './state';
import { ViewScene } from './viewScene';

export interface ViewportOptions {
  /** Called after each picture, with the camera it was drawn from (the panel turns its axis legend by it). */
  onRender?: (camera: PerspectiveCamera | OrthographicCamera) => void;
}

/** How far the pointer may move between press and release and the press still be a click, CSS pixels. */
const CLICK_SLOP = 4;

/** The view keys: Blender's keypad for the fixed views, 5 for the orbit. */
const VIEW_KEYS: Readonly<Record<string, CameraView>> = { '1': 'side', '3': 'front', '7': 'top', '5': 'orbit' };

export class Viewport {
  /** A viewport in `host`, or null where the browser gives no WebGL 2. */
  static create(host: HTMLElement, state: ViewState, selection: Signal<readonly Link[]>, options: ViewportOptions = {}): Viewport | null {
    const canvas = host.ownerDocument.createElement('canvas');
    let context: WebGL2RenderingContext | null;
    try {
      context = canvas.getContext('webgl2', { antialias: true, alpha: false });
    } catch {
      context = null;
    }
    if (context === null) return null;
    return new Viewport(host, canvas, context, state, selection, options);
  }

  readonly renderer: WebGLRenderer;
  readonly scene: ViewScene;
  readonly controls: OrbitControls;
  private frame = 0;
  private dirty = true;
  private pendingHover: { x: number; y: number } | null | undefined = undefined;
  private press: { x: number; y: number; button: number } | null = null;
  private readonly cleanups: (() => void)[] = [];

  private constructor(
    readonly host: HTMLElement,
    readonly canvas: HTMLCanvasElement,
    context: WebGL2RenderingContext,
    state: ViewState,
    selection: Signal<readonly Link[]>,
    private readonly options: ViewportOptions,
  ) {
    this.renderer = new WebGLRenderer({ canvas, context, antialias: true });
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    canvas.classList.add('view3d-gl');
    host.append(canvas);

    this.scene = new ViewScene(state, selection, () => this.requestRender());
    this.controls = new OrbitControls(this.scene.camera, canvas);
    // one vector: framing moves the target, the controls orbit around it
    this.controls.target = this.scene.target;
    this.controls.zoomToCursor = true;
    this.controls.screenSpacePanning = true;
    this.controls.listenToKeyEvents(host);
    const onChange = (): void => this.requestRender();
    this.controls.addEventListener('change', onChange);
    this.cleanups.push(() => this.controls.removeEventListener('change', onChange));

    this.cleanups.push(this.scene.start());
    this.listen();
    this.resize();
  }

  private on<K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K, handler: (event: HTMLElementEventMap[K]) => void): void {
    target.addEventListener(type, handler);
    this.cleanups.push(() => target.removeEventListener(type, handler));
  }

  private listen(): void {
    const canvas = this.canvas;
    this.on(canvas, 'pointermove', (event) => {
      if (event.buttons !== 0) return;
      this.pendingHover = this.toDevice(event.clientX, event.clientY);
      this.schedule();
    });
    this.on(canvas, 'pointerleave', () => {
      this.pendingHover = null;
      this.schedule();
    });
    this.on(canvas, 'pointerdown', (event) => {
      this.press = { x: event.clientX, y: event.clientY, button: event.button };
    });
    this.on(canvas, 'pointerup', (event) => {
      const press = this.press;
      this.press = null;
      if (press === null || press.button !== 0 || event.button !== 0) return;
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK_SLOP) return;
      const at = this.toDevice(event.clientX, event.clientY);
      this.scene.clickAt(at.x, at.y, event.shiftKey);
    });
    this.on(this.host, 'keydown', (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const view = VIEW_KEYS[event.key];
      if (view !== undefined) this.scene.state.setCamera(view);
      else if (event.key === 'Home') this.scene.state.requestFraming('all');
      else if (event.key === '.' || event.code === 'NumpadDecimal') this.scene.state.requestFraming('selected');
      else return;
      event.preventDefault();
    });

    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.resize());
    observer?.observe(this.host);
    this.cleanups.push(() => observer?.disconnect());

    const dark = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
    if (dark !== undefined) {
      const follow = (): void => this.scene.setDark(dark.matches);
      follow();
      dark.addEventListener('change', follow);
      this.cleanups.push(() => dark.removeEventListener('change', follow));
    }
  }

  /** A point of the page as normalised device coordinates of the canvas. */
  toDevice(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      y: -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    };
  }

  /** A point of normalised device coordinates as a point of the page. */
  toClient(point: { x: number; y: number }): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + ((point.x + 1) / 2) * rect.width, y: rect.top + ((1 - point.y) / 2) * rect.height };
  }

  /** Fits the drawing to the host's size and draws at once. */
  resize(): void {
    const width = Math.max(1, Math.floor(this.host.clientWidth));
    const height = Math.max(1, Math.floor(this.host.clientHeight));
    this.renderer.setSize(width, height, false);
    this.scene.setAspect(width / height);
    this.renderNow();
  }

  /** Asks for a picture on the next frame. */
  requestRender(): void {
    this.dirty = true;
    this.schedule();
  }

  private schedule(): void {
    if (this.frame !== 0) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.pendingHover !== undefined) {
        const point = this.pendingHover;
        this.pendingHover = undefined;
        this.scene.hoverAt(point);
      }
      if (this.dirty) this.renderNow();
    });
  }

  /** Draws now. */
  renderNow(): void {
    this.dirty = false;
    const camera = this.scene.camera;
    if (this.controls.object !== camera) this.controls.object = camera;
    const ortho = VIEW_PRESETS[this.scene.cameraView].ortho;
    this.controls.enableRotate = !ortho;
    this.controls.mouseButtons.LEFT = ortho ? MOUSE.PAN : MOUSE.ROTATE;
    const height = this.renderer.domElement.clientHeight || this.host.clientHeight;
    this.scene.guides.setMinorGrid(pixelsPerBlock(camera, this.scene.target, height) >= MINOR_GRID_MIN_PX);
    this.renderer.render(this.scene.scene, camera);
    this.options.onRender?.(camera);
  }

  dispose(): void {
    if (this.frame !== 0) cancelAnimationFrame(this.frame);
    this.frame = 0;
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.controls.stopListenToKeyEvents();
    this.controls.dispose();
    this.scene.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
