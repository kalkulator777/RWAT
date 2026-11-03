/**
 * The preview's state and what it shows: from the model's moving things (./parts.ts), its
 * wagon type and the state of the doors, controls, light groups and couplers, the
 * transform, visibility and light of every object the preview drives — computed the way
 * the engine draws them (`WagonRenderer.drawDoors`, `drawControls`, `drawCouplers`; the
 * light rule of `ModelParts.lit`). Pure: the controller (./controller.ts) hands the result to
 * the view.
 *
 * Nothing here is written to the pack (editor.md §3.3: the preview edits nothing).
 */

import type { OverlayShape, Vec3 } from '../core/contracts';
import { controlValue, controlVisible } from '../ports/controlPose';
import { headShownAt, type Control } from '../ports/objectRole';
import type { WagonType } from '../ports/wagonType';
import { animatedDoor, doorCount, leafDoor, progressOf } from './doors';
import { controlInput, controlPosition } from './inputs';
import { groupsOn, lit } from './lights';
import { objectsAt, type CouplerHead, type MovingPart, type PartLight, type PreviewParts } from './parts';
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
  part: MovingPart;
  objects: readonly string[];
}

/** A door leaf and the type's door it swings with (−1: none, drawn shut). */
export interface RigLeaf extends RigPart {
  door: number;
}

/** An animated door: its pieces and the type's door it follows (−1: none, at rest). */
export interface RigDoor {
  id: string;
  door: number;
  pieces: readonly { object: string; frames: readonly Float32Array[] }[];
}

/** A coupler head and the objects it is drawn as. */
export interface RigCoupler {
  head: CouplerHead;
  objects: readonly string[];
}

/** One model's moving things ready for the preview: worked out once per model and type. */
export interface Rig {
  parts: PreviewParts;
  type: WagonType | null;
  controls: readonly RigPart[];
  leaves: readonly RigLeaf[];
  doors: readonly RigDoor[];
  couplers: readonly RigCoupler[];
  /** Every drawn object with a light group or a glow, and how it is lit. */
  lights: ReadonlyMap<string, PartLight>;
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

/** The drawn places of the OBJ, whose light the view shows (`ModelParts.Place.drawn`). */
const DRAWN = new Set(['BODY', 'INTERIOR', 'BOGIE', 'WHEEL', 'ANIMATED', 'DOOR_LEAF', 'CONTROL', 'COUPLER']);

/** The model's moving things matched up with its objects and its type's doors. */
export function rig(parts: PreviewParts, type: WagonType | null): Rig {
  const controls = parts.controls.map((part, i) => ({ part, objects: objectsAt(parts, 'CONTROL', i) }));
  const leaves = parts.doorLeaves.map((part, i) => ({
    part,
    objects: objectsAt(parts, 'DOOR_LEAF', i),
    door: leafDoor(type, part.boxMin, part.boxMax),
  }));
  const doors = parts.doors.map((door) => ({
    id: door.id,
    door: animatedDoor(type, door.id),
    pieces: door.objects.flatMap((object) => {
      const frames = parts.tracks.get(object);
      return frames === undefined || frames.length === 0 ? [] : [{ object, frames }];
    }),
  }));
  const couplers = parts.couplers.map((head, i) => ({ head, objects: objectsAt(parts, 'COUPLER', i) }));
  const lights = new Map<string, PartLight>();
  for (const part of parts.parts) {
    if (DRAWN.has(part.place) && (part.light.group >= 0 || part.light.fullbright) && !lights.has(part.object)) {
      lights.set(part.object, part.light);
    }
  }
  return { parts, type, controls, leaves, doors, couplers, lights };
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

/** The raw position 0…1 a control stands at in the state (`ControlValue.position`). */
export function positionIn(state: PreviewState, role: Control): number {
  const slider = controlInput(role);
  const input = slider.kind === 'group' ? (state.groups.get(role.group) ?? 0) : (state.inputs.get(role.key) ?? slider.rest);
  return controlPosition(role, input);
}

/** The light groups that are on: a group is on while its control group's value is above 0. */
export function lightGroupsOn(r: Rig, state: PreviewState): boolean[] {
  return groupsOn(r.parts.lightGroups, (group) => state.groups.get(group) ?? 0);
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
  const on = lightGroupsOn(r, state);
  const litObjects = new Map<string, boolean>();
  for (const [object, light] of r.lights) litObjects.set(object, lit(light.group, light.invert, on));
  const lights: OverlayShape[] = [];
  for (const lamp of r.parts.lamps) {
    if (lit(lamp.group, lamp.invert, on)) lights.push({ shape: 'circle', centre: objPoint(lamp.at), radius: LAMP_RADIUS, style: LAMP_STYLE });
  }
  for (const headlight of r.parts.headlights) {
    if (!lit(headlight.group, headlight.invert, on)) continue;
    const from = objPoint(headlight.at);
    const way = objDirection([0, 0, headlight.dirZ]);
    const to: Vec3 = [from[0] + way[0] * BEAM_LENGTH, from[1] + way[1] * BEAM_LENGTH, from[2] + way[2] * BEAM_LENGTH];
    lights.push({ shape: 'arrow', from, to, style: HEADLIGHT_STYLE });
  }
  return { transforms, visible, lit: litObjects, lights };
}
