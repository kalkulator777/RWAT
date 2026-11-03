/**
 * Which objects of a wagon model are door leaves the asset moves by name, and which of the
 * wagon type's doors each one is (SPEC §9.5): port of `convention/DoorLeaves.java`. The
 * model's reading builds the leaves by it (./modelParts.ts), the preview and the checks
 * ask it which door a leaf swings with. Golden: fixtures/golden/door_leaves/.
 *
 * An object is a part of door `DOOR_<n>`'s leaf when
 * - its name reads as that door (./objectRole.ts `door`: `DOOR_<n>` anywhere in it, a copy
 *   suffix aside);
 * - it is a part of its own: no `HIDE` in the raw name, no skipped prefix, not a bogie's
 *   (`BOGEY_FRONT…`, `BOGEY_REAR…`), not a coupler head, not moved by an `.anim` (named in
 *   one exactly). Its texture doesn't matter: a hinge marker of a material without one is
 *   not drawn and still makes the leaf;
 * - and the door moves by name: one of its objects so read is the hinge marker
 *   `DOOR_<n>_ROT[_<degrees>]` or slides (`TL_<f>_<axis>`).
 *
 * Any other `DOOR_<n>` object is rigid body: a door the asset doesn't move. A leaf swings
 * with the type's door whose box holds the centre of its drawn faces ({@link leafDoor}).
 * Pure.
 */

import { point } from './objFrame';
import { coupled, door, type ObjectRole } from './objectRole';
import type { WagonType } from './wagonType';

/** The object read as a door (`ObjectRole.door`) if it is a part of its own (drawn or not); else null. */
function doorPart(object: string, skipPrefixes: readonly string[], animated: ReadonlySet<string>): ObjectRole | null {
  if (object.includes('HIDE') || object.startsWith('BOGEY_FRONT') || object.startsWith('BOGEY_REAR') || animated.has(object) || coupled(object) !== null) {
    return null;
  }
  for (const prefix of skipPrefixes) if (object.startsWith(prefix)) return null;
  return door(object);
}

/** True if this door object is its door's hinge marker or slides. */
function moves(role: ObjectRole): boolean {
  const slide = role.control?.slide ?? [0, 0, 0];
  return role.pivotDegrees !== null || slide[0] !== 0 || slide[1] !== 0 || slide[2] !== 0;
}

/** The door leaves of one model (`DoorLeaves`). */
export class DoorLeaves {
  private constructor(
    /** The keys `DOOR_<n>` of the doors the model moves by name, in the order their objects come. */
    readonly keys: readonly string[],
    private readonly skipPrefixes: readonly string[],
    private readonly animated: ReadonlySet<string>,
  ) {}

  /**
   * `DoorLeaves.of`: the door leaves of a model.
   *
   * @param objects      the model's object names (order matters only for {@link keys}; repeats don't)
   * @param skipPrefixes the name prefixes the model drops: the convention's (`CARGO_FILL`) and its declaration's `skip`
   * @param animated     the objects its declared `.anim`s move
   */
  static of(objects: Iterable<string>, skipPrefixes: readonly string[], animated: Iterable<string>): DoorLeaves {
    const moved = new Set(animated);
    const keys = new Set<string>();
    for (const object of objects) {
      const role = doorPart(object, skipPrefixes, moved);
      if (role?.control != null && moves(role)) keys.add(role.control.key);
    }
    return new DoorLeaves([...keys], [...skipPrefixes], moved);
  }

  /**
   * `DoorLeaves.leaf`: the door leaf `object` is a part of, read as ./objectRole.ts `door`
   * reads it (its hinge, slide, flags); null if it isn't one.
   */
  leaf(object: string): ObjectRole | null {
    const role = doorPart(object, this.skipPrefixes, this.animated);
    return role?.control != null && this.keys.includes(role.control.key) ? role : null;
  }
}

/**
 * `DoorLeaves.door`: the type's door a leaf is, by the box of its drawn faces in the OBJ
 * frame — the door whose box holds the box's centre (`WagonType.doorHolding`); −1 if none,
 * and the leaf is drawn shut.
 */
export function leafDoor(type: WagonType, minObj: readonly number[], maxObj: readonly number[]): number {
  const [x, y, z] = point(
    ((minObj[0] ?? NaN) + (maxObj[0] ?? NaN)) * 0.5,
    ((minObj[1] ?? NaN) + (maxObj[1] ?? NaN)) * 0.5,
    ((minObj[2] ?? NaN) + (maxObj[2] ?? NaN)) * 0.5,
  );
  return type.doorHolding(x, y, z);
}
