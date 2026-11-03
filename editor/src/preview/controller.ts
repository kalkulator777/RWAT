/**
 * The preview of the open model (editor.md §2.3–2.4, §3.8): holds its state — doors,
 * controls, light groups, couplers, livery — as a signal, changes it on the panel's word,
 * swings doors over the engine's 40 ticks, and tells the 3D view what to move, hide and
 * light through `ViewApi` alone: the view knows nothing of doors or controls (§3.8).
 *
 * The view is told only what changed since it was last told: a slider drags one control
 * and only that control's objects get a new transform. When the view or the model changes,
 * everything is told again; a livery shows the model again with the livery's textures
 * (`ViewApi` has no call to swap a texture), after which everything is told again too.
 *
 * The preview writes nothing to the pack and nothing to the journal (§3.3).
 */

import { batch, effect, signal, untracked } from '@preact/signals';
import type { LoadedModel, ViewApi } from '../core/contracts';
import type { WagonType } from '../ports/wagonType';
import { doorsMovedWith, stepDoors, swinging, TICK_MS } from './doors';
import { controlInput } from './inputs';
import { inLivery, type LiverySwaps } from './livery';
import type { PreviewParts } from './parts';
import { initialState, LIGHTS_LAYER, previewScene, rig, type PreviewScene, type PreviewState, type Rig } from './scene';

/** What the preview shows: a model as the view has it, what it is made of, and its wagon type. */
export interface PreviewSubject {
  /** The model as the view was shown it (`ViewApi.show`), base textures. */
  model: LoadedModel;
  /** Its moving things, as `ModelParts` reads the model (./parts.ts). */
  parts: PreviewParts;
  /** The wagon type paired with the model, as the engine reads it; null without one (no doors swing). */
  type: WagonType | null;
  /** Livery id → its texture swaps (./livery.ts `liverySwaps`), in the model's order. */
  liveries: ReadonlyMap<string, LiverySwaps>;
}

/** Runs something every so often until stopped: the doors' swing ticks by it. */
export interface Ticker {
  every(ms: number, run: () => void): () => void;
}

/** The browser's (and Node's) interval timer. */
export const intervalTicker: Ticker = {
  every(ms, run) {
    const id = setInterval(run, ms);
    return () => clearInterval(id);
  },
};

/** What the view has been told, to tell it only what changes. */
interface Told {
  view: ViewApi;
  subject: PreviewSubject;
  livery: string | null;
  transforms: Map<string, Float32Array>;
  visible: Map<string, boolean>;
  lit: Map<string, boolean>;
  lights: string;
}

function sameMatrix(a: Float32Array | undefined, b: Float32Array): boolean {
  if (a === undefined) return false;
  for (let i = 0; i < 16; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

function clamp(value: number, min: number, max: number): number {
  return Number.isNaN(value) ? min : Math.min(Math.max(value, min), max);
}

export class PreviewController {
  /** The 3D view the preview drives; null until one is attached. */
  readonly view = signal<ViewApi | null>(null);
  /** The model previewed; null when none is open. */
  readonly subject = signal<PreviewSubject | null>(null);
  /** The model's moving things matched up with its objects and doors; null with no model. */
  readonly rig = signal<Rig | null>(null);
  /** The preview's state; null with no model. */
  readonly state = signal<PreviewState | null>(null);

  private told: Told | null = null;
  private stopTicking: (() => void) | null = null;
  private readonly stopTelling: () => void;

  constructor(private readonly ticker: Ticker = intervalTicker) {
    this.stopTelling = effect(() => {
      const view = this.view.value;
      const subject = this.subject.value;
      const r = this.rig.value;
      const state = this.state.value;
      // the view's own signals, if it reads any while drawing, are none of the preview's
      untracked(() => this.tell(view, subject, r, state));
    });
  }

  /** Previews another model (or none): its state starts over, at rest. */
  load(subject: PreviewSubject | null): void {
    this.stopSwing();
    const r = subject === null ? null : rig(subject.parts, subject.type);
    this.told = null;
    batch(() => {
      this.subject.value = subject;
      this.rig.value = r;
      this.state.value = r === null ? null : initialState(r);
    });
  }

  /** Every door shut, every control at rest, the groups off, both ends free, the base livery. */
  reset(): void {
    this.stopSwing();
    const r = this.rig.value;
    if (r !== null) this.state.value = initialState(r);
  }

  /** Puts door `index` at `progress` (0 shut … 1 open); it stops swinging. */
  setDoor(index: number, progress: number): void {
    this.update((state) => {
      if (index < 0 || index >= state.doors.length) return state;
      const doors = [...state.doors];
      const heading = [...state.heading];
      doors[index] = clamp(progress, 0, 1);
      heading[index] = null;
      return { ...state, doors, heading };
    });
  }

  /** True if door `index` is open or opening — what a click would undo. */
  isOpening(index: number): boolean {
    const state = this.state.value;
    if (state === null) return false;
    const heading = state.heading[index];
    return heading !== undefined && heading !== null ? heading === 1 : (state.doors[index] ?? 0) > 0;
  }

  /**
   * Opens door `index` if it is shut or shutting, else shuts it, swinging over the engine's
   * 40 ticks — and with it the leaves of its group, as a click in the game does
   * (`WagonType.doorsOpenedWith`).
   */
  toggleDoor(index: number): void {
    const type = this.rig.value?.type ?? null;
    if (type === null) return;
    const target = this.isOpening(index) ? 0 : 1;
    const moved = doorsMovedWith(type, index);
    if (moved.length === 0) return;
    this.update((state) => {
      const heading = [...state.heading];
      for (const door of moved) if (door < heading.length) heading[door] = state.doors[door] === target ? null : target;
      return { ...state, heading };
    });
    if (swinging(this.state.value?.heading ?? []) && this.stopTicking === null) {
      this.stopTicking = this.ticker.every(TICK_MS, () => this.tick());
    }
  }

  /** One game tick of the doors' swing; false once none is swinging (the ticking then stops). */
  tick(): boolean {
    const state = this.state.value;
    if (state === null || !swinging(state.heading)) {
      this.stopSwing();
      return false;
    }
    const next = stepDoors(state.doors, state.heading);
    this.state.value = { ...state, doors: next.doors, heading: next.heading };
    if (swinging(next.heading)) return true;
    this.stopSwing();
    return false;
  }

  /** Sets control `key`'s slider (./inputs.ts); a group-driven control sets its group. */
  setInput(key: string, value: number): void {
    const control = this.rig.value?.controls.find((c) => c.part.role.key === key);
    if (control === undefined) return;
    const role = control.part.role;
    const slider = controlInput(role);
    if (slider.kind === 'group') {
      this.setGroup(role.group, value);
      return;
    }
    this.update((state) => {
      const inputs = new Map(state.inputs);
      inputs.set(key, clamp(value, slider.min, slider.max));
      return { ...state, inputs };
    });
  }

  /** Sets a control group's value 0…1: its switches move, its light group is on above 0. */
  setGroup(group: string, value: number): void {
    this.update((state) => {
      const groups = new Map(state.groups);
      groups.set(group, clamp(value, 0, 1));
      return { ...state, groups };
    });
  }

  /** Couples or frees the front (or rear) end: its coupler heads show by it. */
  setCoupled(front: boolean, coupled: boolean): void {
    this.update((state) => ({ ...state, coupled: front ? { ...state.coupled, front: coupled } : { ...state.coupled, rear: coupled } }));
  }

  /** Shows the model in a livery of its own, or in the base textures (null or an unknown id). */
  setLivery(livery: string | null): void {
    const known = livery !== null && this.subject.value?.liveries.has(livery) === true ? livery : null;
    this.update((state) => ({ ...state, livery: known }));
  }

  /** Switches the view to its "light" display, where the light groups' state shows. */
  showLight(): void {
    this.view.value?.setDisplay('lit');
  }

  /** Stops the effect and the ticking: the controller is no longer used. */
  dispose(): void {
    this.stopSwing();
    this.stopTelling();
  }

  private update(change: (state: PreviewState) => PreviewState): void {
    const state = this.state.value;
    if (state !== null) this.state.value = change(state);
  }

  private stopSwing(): void {
    this.stopTicking?.();
    this.stopTicking = null;
  }

  /** Tells the view what changed since it was last told. */
  private tell(view: ViewApi | null, subject: PreviewSubject | null, r: Rig | null, state: PreviewState | null): void {
    if (view === null || subject === null || r === null || state === null) return;
    let told = this.told;
    if (told === null || told.view !== view || told.subject !== subject) {
      // the view was shown this model with its base textures and knows nothing of the preview yet
      told = this.fresh(view, subject, null);
    }
    if (told.livery !== state.livery) {
      view.show(inLivery(subject.model, state.livery === null ? undefined : subject.liveries.get(state.livery)));
      told = this.fresh(view, subject, state.livery);
    }
    this.told = told;
    const scene: PreviewScene = previewScene(r, state);
    for (const [object, matrix] of scene.transforms) {
      if (sameMatrix(told.transforms.get(object), matrix)) continue;
      view.setTransform(object, matrix);
      told.transforms.set(object, matrix);
    }
    for (const [object, shown] of scene.visible) {
      if (told.visible.get(object) === shown) continue;
      view.setVisible(object, shown);
      told.visible.set(object, shown);
    }
    for (const [object, lit] of scene.lit) {
      if (told.lit.get(object) === lit) continue;
      view.setLit(object, lit);
      told.lit.set(object, lit);
    }
    const lights = JSON.stringify(scene.lights);
    if (told.lights !== lights) {
      view.overlay(LIGHTS_LAYER, scene.lights);
      told.lights = lights;
    }
  }

  private fresh(view: ViewApi, subject: PreviewSubject, livery: string | null): Told {
    return { view, subject, livery, transforms: new Map(), visible: new Map(), lit: new Map(), lights: '' };
  }
}
