/**
 * What the chairs tool edits, told so that more than one kind of place fits in it: a
 * place someone sits in, at a point of the OBJ frame and turned a yaw, read from the
 * wagon type's JSON and written back by journal commands. Today there is one kind, the
 * driver's chairs (`cab.seats`, ./chairs.ts); the passengers' seats and berths of phase 5
 * (docs/proposals/passenger-places.md, no format yet) are to be another {@link PlaceKind}
 * in {@link PLACE_KINDS}: the gestures (./gesture.ts), the overlays (./analysis.ts) and the
 * inspector's section go through the kinds and their {@link PlaceRef}s, never through
 * `cab.seats` itself.
 *
 * Yaws are degrees as the pack writes them: 0 faces forward (OBJ −X), +90 the right side
 * (OBJ −Z), 180 back. Pure: no DOM, no signals.
 */

import type { Command, JsonPointer, Link, Vec3 } from '../../core/contracts';
import type { WagonType } from '../../ports/wagonType';
import { DRIVER_CHAIRS } from './chairs';

/** A place as the file writes it: its point (the top of the cushion) and which way it faces. */
export interface Place {
  readonly at: Vec3;
  readonly yaw: number;
}

/** What the engine makes of a place: where one stands to sit down in it, and which cab it is in. */
export interface PlaceFacts {
  /** The nearest point a player's centre may stand at, OBJ frame, on the floor there; null without a floor. */
  readonly stand: Vec3 | null;
  /** How far that is from under the place, blocks; infinite without a floor. */
  readonly reach: number;
  /** The cushion's height over the floor there; NaN without a floor. */
  readonly height: number;
  /** False when the engine's check finds nobody can sit down in it (reach, height). */
  readonly sittable: boolean;
  /** The driver's cab it is in (`CabArea`), −1 for none. */
  readonly cab: number;
}

/** What a gesture edits a place with: the journal's label of the gesture and the key that merges a drag's commands. */
export interface EditOptions {
  readonly label?: string;
  readonly coalesceKey?: string;
}

/** A kind of place: where the type's JSON keeps them, how they are edited, what the engine makes of them. */
export interface PlaceKind {
  /** Unique among the kinds: `driver`. */
  readonly id: string;
  /** The kind of link a place of this kind is selected by (core/contracts `Link`). */
  readonly link: 'seat';
  /** How many places of this kind a type may have. */
  readonly limit: number;
  /** i18n key of the kind's name in the inspector (the tool's own strings). */
  readonly title: string;
  /** A place a driver drives from: its yaw says which way the train goes (more than 90° off forward: backward). */
  readonly drives: boolean;
  /** The places of a type's JSON in the file's order; one that cannot be read is null, so the indices stay the file's. */
  places(typeJson: unknown): (Place | null)[];
  /** Where place `index` is in the file (the inspector's form goes there). */
  pointer(typeJson: unknown, index: number): JsonPointer;
  add(file: string, typeJson: unknown, place: Place, options?: EditOptions): Command;
  set(file: string, typeJson: unknown, index: number, place: Place, options?: EditOptions): Command;
  remove(file: string, typeJson: unknown, index: number): Command;
  /** Moves place `from` to `to` in the list (the order is the pack's: the first manned chair drives). */
  reorder(file: string, typeJson: unknown, from: number, to: number): Command;
  /** What the engine makes of each place of a type that loads, in the places' order. */
  facts(type: WagonType): PlaceFacts[];
}

/** Every kind of place, in the inspector's order. */
export const PLACE_KINDS: readonly PlaceKind[] = [DRIVER_CHAIRS];

/** One place of one kind. */
export interface PlaceRef {
  readonly kind: PlaceKind;
  readonly index: number;
}

/** The link of a place of the wagon `wagon`. */
export function placeLink(wagon: string, ref: PlaceRef): Link {
  return { kind: ref.kind.link, type: wagon, index: ref.index };
}

/** The places of the wagon in the selection, in its order, of the kinds given. */
export function selectedPlaces(selection: readonly Link[], wagon: string, kinds: readonly PlaceKind[] = PLACE_KINDS): PlaceRef[] {
  const out: PlaceRef[] = [];
  for (const link of selection) {
    if (link.kind === 'file' || link.kind === 'field' || link.kind === 'object' || link.type !== wagon) continue;
    const kind = kinds.find((candidate) => candidate.link === link.kind);
    if (kind !== undefined) out.push({ kind, index: link.index });
  }
  return out;
}

/** True if two refs name one place. */
export function samePlace(a: PlaceRef | null, b: PlaceRef | null): boolean {
  return a !== null && b !== null && a.kind === b.kind && a.index === b.index;
}

/**
 * The direction a yaw faces, a unit vector of the OBJ plan: 0 is forward (−X), +90 the
 * right side (−Z) — `WagonType.Seat`'s yaw (model +Z forward, +90 towards model −X)
 * turned into the OBJ frame.
 */
export function facing(yaw: number): Vec3 {
  const r = (yaw * Math.PI) / 180;
  return [-Math.cos(r) + 0, 0, -Math.sin(r) + 0];
}

/** The yaw that faces along (dx, dz) of the OBJ plan, in (−180, 180]. */
export function yawOf(dx: number, dz: number): number {
  const degrees = (Math.atan2(-dz, -dx) * 180) / Math.PI;
  return normalYaw(degrees);
}

/** A yaw in (−180, 180], −0 written 0. */
export function normalYaw(yaw: number): number {
  let y = ((yaw % 360) + 360) % 360;
  if (y > 180) y -= 360;
  return y === 0 ? 0 : y;
}
