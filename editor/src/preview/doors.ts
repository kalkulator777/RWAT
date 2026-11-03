/**
 * The doors in the preview as the engine moves them: which of the type's doors an
 * animated door or a leaf moved by name follows, and the swing toward open or shut over
 * {@link DOOR_ANIM_TICKS} ticks (`WagonEntity.tickDoorAnim`). Pure.
 */

import type { Vec3 } from '../core/contracts';
import { equalsIgnoreCase, type WagonType } from '../ports/wagonType';

/**
 * A door swings from shut to open in this many ticks, ~2 s (`WagonEntity.DOOR_ANIM_TICKS`).
 * In float steps of 1/40, as the engine takes them, the 40th leaves it 4e-7 short and a
 * 41st settles it.
 */
export const DOOR_ANIM_TICKS = 40;

/** A game tick, ms: the preview's swing runs at the game's 20 ticks a second. */
export const TICK_MS = 50;

/** Doors the engine keeps open-or-shut bits for (`WagonEntity.tickDoorAnim`: the first 32). */
export const MAX_DOORS = 32;

const f = Math.fround;

/** How many of the type's doors swing: the first {@link MAX_DOORS}; none without a type. */
export function doorCount(type: WagonType | null): number {
  return type === null ? 0 : Math.min(type.doors.length, MAX_DOORS);
}

/**
 * The type's door an animation of the model moves with (`WagonRenderer.drawDoors`): the
 * first whose id equals the animation's, case aside (`DOOR_5_…_CG_Trap1` makes a door
 * `Trap1`, its `.anim` `trap1`); −1 if none — the pieces stay at rest.
 */
export function animatedDoor(type: WagonType | null, id: string): number {
  if (type === null) return -1;
  return type.doors.findIndex((door) => equalsIgnoreCase(door.id, id));
}

/**
 * The type's door a leaf moved by name swings with (`WagonRenderer.drawDoors`): the first
 * with a leaf whose box, grown by 0.1, holds the centre of the leaf's drawn faces
 * (`WagonType.doorHolding`, model frame); −1 if none — the leaf is drawn shut.
 */
export function leafDoor(type: WagonType | null, boxMin: Vec3, boxMax: Vec3): number {
  if (type === null) return -1;
  // as Java adds the floats of the box, then halves in double
  return type.doorHolding(f(boxMin[0] + boxMax[0]) * 0.5, f(boxMin[1] + boxMax[1]) * 0.5, f(boxMin[2] + boxMax[2]) * 0.5);
}

/** A door's progress, or 0 for a door that is not there (−1, or past the doors that swing). */
export function progressOf(doors: readonly number[], index: number): number {
  return index < 0 ? 0 : (doors[index] ?? 0);
}

/**
 * One tick of the doors' swing (`WagonEntity.tickDoorAnim`): each door that is heading
 * somewhere moves toward it by at most 1/{@link DOOR_ANIM_TICKS}, in float as the engine
 * reckons it, and stops heading there once it has arrived.
 *
 * @param doors each door's progress, 0 shut … 1 open
 * @param heading where each door is going (0 or 1), null for a door standing still
 */
export function stepDoors(
  doors: readonly number[],
  heading: readonly (number | null)[],
): { doors: number[]; heading: (number | null)[] } {
  const step = f(1 / DOOR_ANIM_TICKS);
  const next = [...doors];
  const still = [...heading];
  for (let i = 0; i < next.length; i++) {
    const target = heading[i];
    if (target === undefined || target === null) continue;
    const at = next[i] ?? 0;
    next[i] = f(at + Math.min(Math.max(f(target - at), -step), step));
    if (next[i] === target) still[i] = null;
  }
  return { doors: next, heading: still };
}

/** True while any door is heading somewhere. */
export function swinging(heading: readonly (number | null)[]): boolean {
  return heading.some((target) => target !== null);
}

/**
 * The doors a click on door `index` opens or shuts together (`WagonType.doorsOpenedWith`):
 * it and the leaves of its group, by index; none for a fixed door.
 */
export function doorsMovedWith(type: WagonType, index: number): number[] {
  const bits = type.doorsOpenedWith(index);
  const doors: number[] = [];
  for (let i = 0; i < doorCount(type); i++) if (((bits >>> i) & 1) !== 0) doors.push(i);
  return doors;
}
