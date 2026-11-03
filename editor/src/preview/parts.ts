/**
 * What the preview needs to know of a model: the moving things of its OBJ as the engine's
 * reading of the model (`convention/ModelParts.java`) finds them, plus the frames of its
 * `.anim` files. The preview moves, shows and lights objects by name through the view
 * (core/contracts `ViewApi`), so everything here leads back to object names.
 *
 * The shapes mirror `ModelParts`' output field for field (golden
 * fixtures/golden/model_parts/, where the same lists are written out), and the places are
 * in the engine's model frame, as `ModelParts` gives them; ./pose.ts turns them into the
 * OBJ frame the view draws in (editor.md §3.8).
 *
 * Until the port of `ModelParts` (ports/modelParts.ts, agent A3.1) is merged, the tests build
 * these lists from that golden folder (./testing.node.ts). After the merge the port's
 * output is handed over as it is or through a one-to-one adapter: nothing in it is
 * recomputed here.
 */

import type { Vec3 } from '../core/contracts';
import type { Control, CouplerShown } from '../ports/objectRole';

/** Where a part of the OBJ is drawn, or why not (`ModelParts.Place`). */
export type Place =
  | 'HIDDEN'
  | 'SKIPPED'
  | 'UNTEXTURED'
  | 'BODY'
  | 'INTERIOR'
  | 'BOGIE'
  | 'WHEEL'
  | 'ANIMATED'
  | 'DOOR_LEAF'
  | 'CONTROL'
  | 'COUPLER';

/** How a drawn part's faces are lit (`ModelParts.Light`). */
export interface PartLight {
  /** Index into {@link PreviewParts.lightGroups}; −1 for none. */
  group: number;
  /** Glows at full brightness while lit (`FULLBRIGHT`). */
  fullbright: boolean;
  /** In the cabin lamps' light (the raw `INTERIOR` token). */
  interior: boolean;
  /** Lit while its group is off (`LINVERT`). */
  invert: boolean;
}

/** What one part (one run of faces of one object and one material) is (`ModelParts.Role`). */
export interface PartRole {
  /** Its object, as the OBJ names it: the name the view knows it by. */
  object: string;
  place: Place;
  /** Of the front bogie or end (a bogie, wheelset or coupler head). */
  front: boolean;
  /** A control's or leaf's key, an animated door's id, a wheelset's object; else null. */
  owner: string | null;
  /** Where its owner is in its list ({@link PreviewParts.controls}, `doorLeaves`, `doors`, `couplers`); −1 if none. */
  index: number;
  light: PartLight;
}

/** A cab control or a door leaf moved by name (`ModelParts.Control`), model frame. */
export interface MovingPart {
  /** The control as all its objects' names together declare it (flags merged). */
  role: Control;
  /** One of its objects has the raw `INTERIOR` token. */
  interior: boolean;
  /** The hinge; null when no object of it is its `…_ROT…` marker (no turn). */
  pivot: Vec3 | null;
  /** The hinge axis, unit. */
  axis: Vec3;
  /** The swing at full travel, degrees. */
  degrees: number;
  /** The slide at full travel (`TL_`). */
  slide: Vec3;
  /** The least corner of its drawn faces at rest. */
  boxMin: Vec3;
  /** The greatest corner of its drawn faces at rest. */
  boxMax: Vec3;
}

/** A door its `.anim` moves (`ModelParts.Door`): the animation's id (a door id of the type) and its drawn objects. */
export interface AnimatedDoor {
  id: string;
  objects: string[];
}

/** A coupler head in one state (`ModelParts.Coupler`): its end and when it shows. */
export interface CouplerHead {
  front: boolean;
  shown: CouplerShown;
  /** Where all heads of its end turn, model frame (the preview draws them straight). */
  pivot: Vec3;
}

/** A cabin lamp (`ModelParts.Lamp`): the centre of a glowing island, model frame. */
export interface Lamp {
  at: Vec3;
  group: number;
  invert: boolean;
}

/** A headlight (`ModelParts.Headlight`): its lens centre, model frame, and which way it shines along the model. */
export interface Headlight {
  at: Vec3;
  /** +1 forward (model +Z, OBJ −X), −1 back. */
  dirZ: number;
  radius: number;
  /** `0xRRGGBB`. */
  rgb: number;
  group: number;
  invert: boolean;
}

/** The moving things of one model, as `ModelParts` lists them, and its doors' animation frames. */
export interface PreviewParts {
  /** Every part of the OBJ in file order: an object made of several runs comes several times. */
  parts: readonly PartRole[];
  /** The light groups in the order the drawn parts first name them. */
  lightGroups: readonly string[];
  controls: readonly MovingPart[];
  doorLeaves: readonly MovingPart[];
  doors: readonly AnimatedDoor[];
  couplers: readonly CouplerHead[];
  lamps: readonly Lamp[];
  headlights: readonly Headlight[];
  /**
   * Object → its frames, as ports/anim `parse` reads the model's `.anim` files (row by
   * row, OBJ frame); of an object two files name, the later file's, as the engine loads them
   * (`IrStockModel.loadAnimations`). Tracks without frames are left out.
   */
  tracks: ReadonlyMap<string, readonly Float32Array[]>;
}

/**
 * The objects of the parts at `place` that belong to item `index` of its list, each once,
 * in file order — what the engine draws as that control, leaf, door or head.
 */
export function objectsAt(parts: PreviewParts, place: Place, index: number): string[] {
  const objects: string[] = [];
  for (const part of parts.parts) {
    if (part.place === place && part.index === index && !objects.includes(part.object)) objects.push(part.object);
  }
  return objects;
}
