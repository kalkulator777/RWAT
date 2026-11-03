/**
 * The preview's state and what it shows: from the model as the model worker reads it
 * (core/contracts `LoadedModel`: the engine's reading of its parts, `engine`, in the model
 * frame; its objects with their engine roles; its `.anim` frames), its wagon type and the state
 * of the doors, controls, light groups and couplers — the transform, visibility and light
 * of every object the preview drives, computed the way the engine draws them
 * (`WagonRenderer.drawDoors`, `drawControls`, `drawCouplers`; the light rule of
 * `ModelParts.lit`, ports/lights). Pure: the controller (./controller.ts) hands the result
 * to the view.
 *
 * Nothing here is written to the pack (editor.md §3.3: the preview edits nothing).
 */

import type { LoadedModel, ObjectInfo, OverlayShape, Vec3 } from '../core/contracts';
import { controlValue, controlVisible } from '../ports/controlPose';
import { litMask, shines } from '../ports/lights';
import { drawn, type Coupler, type Headlight, type Lamp, type Light, type ModelControl, type Place } from '../ports/modelParts';
import { headShownAt, type Control } from '../ports/objectRole';
import { equalsIgnoreCase, type WagonType } from '../ports/wagonType';
import { animatedDoor, doorCount, leafDoor, progressOf } from './doors';
import { controlInput, controlPosition } from './inputs';
import { animMatrix, movingMatrix, objDirection, objPoint } from './pose';

/** What the preview shows a model in. Immutable: every change makes a new state. */
export interface PreviewState {
  /** Each swinging door of the type (./doors.ts `doorCount`), 0 shut … 1 open, in the type's order. */
  doors: readonly number[];
  /** Where each door is swinging to (0 or 1), null for a door standing still. */
  heading: readonly (number | null)[];
  /** Each control's slider by its key (`<KIND>_<n>`): a notch, a reverser step, a reading, a travel (./inputs.ts); group-driven controls read {@link groups}. */
  inputs: ReadonlyMap<string, number>;
  /** Control groups' values 0…1: switches, windows, buttons — and the light groups of the same names. */
  groups: ReadonlyMap<string, number>;
  /** Whether the front and the rear end are coupled to another car. */
  coupled: { readonly front: boolean; readonly rear: boolean };
  /** The livery shown, or null for the base textures. */
  livery: string | null;
}

/** A control or a door leaf with the objects it is drawn as. */
export interface RigPart {
  part: ModelControl;
  objects: readonly string[];
}

/** A door leaf and the type's door it swings with (−1: none, drawn shut). */
export interface RigLeaf extends RigPart {
  door: number;
}

/** An animated door: its pieces with their frames and the type's door it follows (−1: none, at rest). */
export interface RigDoor {
  id: string;
  door: number;
  pieces: readonly { object: string; frames: readonly Float32Array[] }[];
}

/** A coupler head and the objects it is drawn as. */
export interface RigCoupler {
  head: Coupler;
  objects: readonly string[];
}

/** One model's moving things ready for the preview: worked out once per model and type. */
export interface Rig {
  type: WagonType | null;
  /** The light groups, in the model's order (`ModelParts.lightGroups`). */
  lightGroups: readonly string[];
  controls: readonly RigPart[];
  leaves: readonly RigLeaf[];
  doors: readonly RigDoor[];
  couplers: readonly RigCoupler[];
  lamps: readonly Lamp[];
  headlights: readonly Headlight[];
  /** Every drawn object of a light group or glowing, and how it is lit. */
  lights: ReadonlyMap<string, Light>;
}

/** What the view is told: per object, and the light shapes. */
export interface PreviewScene {
  /** Every moving object at its place (column-major, OBJ frame). */
  transforms: Map<string, Float32Array>;
  /** Objects shown or hidden by their state: controls (`HIDE` at value 1), coupler heads by coupling. */
  visible: Map<string, boolean>;
  /** Every object of a light group or glowing: whether it is lit. */
  lit: Map<string, boolean>;
  /** The cabin lamps and headlights that shine, for the overlay layer {@link LIGHTS_LAYER}. */
  lights: OverlayShape[];
}

/** The overlay layer the preview draws its shining lamps and headlights in. */
export const LIGHTS_LAYER = 'preview.lights';
/** Overlay style of a shining cabin lamp (a small horizontal circle). */
export const LAMP_STYLE = 'preview.lamp';
/** Overlay style of a shining headlight (an arrow out of the lens, the way it shines). */
export const HEADLIGHT_STYLE = 'preview.headlight';
/** Radius of a lamp's circle, blocks. */
const LAMP_RADIUS = 0.15;
/** Length of a headlight's arrow, blocks. */
const BEAM_LENGTH = 1.5;

/** The objects the engine draws as item `index` of the list of `place`, in the order they come. */
function objectsAt(objects: readonly ObjectInfo[], place: Place, index: number): string[] {
  return objects.filter((o) => o.engine.place === place && o.engine.index === index).map((o) => o.name);
}

/** The model's moving things matched up with its objects and its type's doors; nothing moves in a model that can't be read. */
export function rig(model: LoadedModel, type: WagonType | null): Rig {
  const engine = model.engine;
  const objects = model.objects;
  const lights = new Map<string, Light>();
  for (const { name, engine: role } of objects) if (drawn(role.place) && (role.light.group >= 0 || role.light.fullbright)) lights.set(name, role.light);
  return {
    type,
    lightGroups: engine?.lightGroups ?? [],
    controls: (engine?.controls ?? []).map((part, i) => ({ part, objects: objectsAt(objects, 'CONTROL', i) })),
    leaves: (engine?.doorLeaves ?? []).map((part, i) => ({ part, objects: objectsAt(objects, 'DOOR_LEAF', i), door: leafDoor(type, part.boxMin, part.boxMax) })),
    doors: (engine?.doors ?? []).map((door) => ({
      id: door.id,
      door: animatedDoor(type, door.id),
      pieces: door.objects.flatMap((object) => {
        // the track of the door the object moves with: the engine draws each piece by its own track
        const frames = model.animations[door.id]?.[object];
        return frames === undefined || frames.length === 0 ? [] : [{ object, frames }];
      }),
    })),
    couplers: (engine?.couplers ?? []).map((head, i) => ({ head, objects: objectsAt(objects, 'COUPLER', i) })),
    lamps: engine?.lamps ?? [],
    headlights: engine?.headlights ?? [],
    lights,
  };
}

/** The state of a model nobody has touched: doors shut, controls at rest, groups off, both ends free, base livery. */
export function initialState(r: Rig): PreviewState {
  const n = doorCount(r.type);
  return {
    doors: new Array<number>(n).fill(0),
    heading: new Array<number | null>(n).fill(null),
    inputs: new Map(r.controls.map(({ part }) => [part.role.key, controlInput(part.role).rest])),
    groups: new Map(),
    coupled: { front: false, rear: false },
    livery: null,
  };
}

/**
 * The state of the same model once its type is edited (`after`, the rig of the type as it
 * is now; `before`, the one `state` was of): each door of the type keeps where it stood and
 * where it was heading by its id, as the engine keeps which doors stand open (case aside,
 * the first of an id); a door new to the type, or renamed, stands shut. The controls, the
 * groups, the couplers and the livery are the model's and stay as they are.
 */
export function retypedState(state: PreviewState, before: Rig, after: Rig): PreviewState {
  const fresh = initialState(after);
  const old = before.type?.doors ?? [];
  const was = (i: number): number => {
    const id = after.type?.doors[i]?.id;
    return id === undefined ? -1 : old.findIndex((door) => equalsIgnoreCase(door.id, id));
  };
  const inputs = new Map(fresh.inputs);
  for (const key of inputs.keys()) {
    const value = state.inputs.get(key);
    if (value !== undefined) inputs.set(key, value);
  }
  return {
    doors: fresh.doors.map((shut, i) => state.doors[was(i)] ?? shut),
    heading: fresh.heading.map((still, i) => state.heading[was(i)] ?? still),
    inputs,
    groups: state.groups,
    coupled: state.coupled,
    livery: state.livery,
  };
}

/** The slider value a control stands at in the state: its own, or its group's for a group-driven one. */
export function inputIn(state: PreviewState, role: Control): number {
  const slider = controlInput(role);
  return slider.kind === 'group' ? (state.groups.get(role.group) ?? 0) : (state.inputs.get(role.key) ?? slider.rest);
}

/** The raw position 0…1 a control stands at in the state (`ControlValue.position`). */
export function positionIn(state: PreviewState, role: Control): number {
  return controlPosition(role, inputIn(state, role));
}

/** The model's lit groups in the state (`ModelParts.litMask`): a group is on while its control group's value is above 0. */
export function litIn(r: Rig, state: PreviewState): bigint {
  return litMask(r.lightGroups, (group) => state.groups.get(group) ?? 0);
}

/** Everything the view shows of the rig in this state. */
export function previewScene(r: Rig, state: PreviewState): PreviewScene {
  const transforms = new Map<string, Float32Array>();
  const visible = new Map<string, boolean>();
  for (const door of r.doors) {
    const progress = progressOf(state.doors, door.door);
    for (const piece of door.pieces) transforms.set(piece.object, animMatrix(piece.frames, progress));
  }
  for (const leaf of r.leaves) {
    const matrix = movingMatrix(leaf.part, progressOf(state.doors, leaf.door));
    for (const object of leaf.objects) transforms.set(object, matrix);
  }
  for (const control of r.controls) {
    const role = control.part.role;
    const position = positionIn(state, role);
    const matrix = movingMatrix(control.part, controlValue(role, position));
    const shown = controlVisible(role, position);
    for (const object of control.objects) {
      transforms.set(object, matrix);
      visible.set(object, shown);
    }
  }
  for (const coupler of r.couplers) {
    const shown = headShownAt(coupler.head.shown, coupler.head.front ? state.coupled.front : state.coupled.rear);
    for (const object of coupler.objects) visible.set(object, shown);
  }
  const mask = litIn(r, state);
  const lit = new Map<string, boolean>();
  for (const [object, light] of r.lights) lit.set(object, shines(light, mask));
  const lights: OverlayShape[] = [];
  for (const lamp of r.lamps) {
    if (shines(lamp, mask)) lights.push({ shape: 'circle', centre: objPoint([lamp.x, lamp.y, lamp.z]), radius: LAMP_RADIUS, style: LAMP_STYLE });
  }
  for (const headlight of r.headlights) {
    if (!shines(headlight, mask)) continue;
    const from = objPoint([headlight.x, headlight.y, headlight.z]);
    const way = objDirection([0, 0, headlight.dirZ]);
    const to: Vec3 = [from[0] + way[0] * BEAM_LENGTH, from[1] + way[1] * BEAM_LENGTH, from[2] + way[2] * BEAM_LENGTH];
    lights.push({ shape: 'arrow', from, to, style: HEADLIGHT_STYLE });
  }
  return { transforms, visible, lit, lights };
}
