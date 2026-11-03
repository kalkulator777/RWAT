import { describe, expect, it } from 'vitest';
import { animatedDoor, DOOR_ANIM_TICKS, doorCount, doorsMovedWith, leafDoor, progressOf, stepDoors, swinging } from './doors';
import { exampleParts, exampleType } from './testing.node';

const coach = exampleType('coach');

describe('which of the type’s doors moves what', () => {
  it('gives each leaf of the coach the door whose box holds it, and the salon animation its door by id', () => {
    const leaves = exampleParts('coach').doorLeaves.map((leaf) => `${leaf.role.key}→${coach.doors[leafDoor(coach, leaf.boxMin, leaf.boxMax)]?.id}`);
    expect(leaves).toEqual([
      'DOOR_1→door_fl',
      'DOOR_2→door_fr',
      'DOOR_3→door_rl',
      'DOOR_4→door_rr',
      'DOOR_5→gangway_front',
      'DOOR_6→gangway_rear',
    ]);
    expect(animatedDoor(coach, 'salon_door')).toBe(6);
    expect(animatedDoor(coach, 'SALON_DOOR')).toBe(6);
  });

  it('gives none without a type, or to a leaf no door holds and an animation no door is named after', () => {
    expect(leafDoor(null, [0, 0, 0], [1, 1, 1])).toBe(-1);
    expect(leafDoor(coach, [0, 0, 0], [0.1, 0.1, 0.1])).toBe(-1);
    expect(animatedDoor(null, 'salon_door')).toBe(-1);
    expect(animatedDoor(coach, 'trap')).toBe(-1);
    expect(doorCount(null)).toBe(0);
    expect(doorCount(coach)).toBe(8);
    expect(progressOf([0.5], -1)).toBe(0);
    expect(progressOf([0.5], 3)).toBe(0);
  });

  it('opens a door with the leaves of its group; a fixed door with none', () => {
    expect(doorsMovedWith(coach, 0)).toEqual([0, 2]);
    expect(doorsMovedWith(coach, 6)).toEqual([6]);
    expect(doorsMovedWith(coach, 7)).toEqual([]); // salon_arch, fixed
  });
});

describe('the swing', () => {
  it('moves each heading door by 1/40 a tick toward where it heads, and stops it there', () => {
    let doors: number[] = [0, 1, 0.5];
    let heading: (number | null)[] = [1, 0, null];
    let ticks = 0;
    while (swinging(heading)) {
      ({ doors, heading } = stepDoors(doors, heading));
      ticks++;
      if (ticks === 1) expect(doors).toEqual([Math.fround(1 / DOOR_ANIM_TICKS), Math.fround(1 - Math.fround(1 / DOOR_ANIM_TICKS)), 0.5]);
    }
    expect(doors).toEqual([1, 0, 0.5]);
    expect(ticks).toBe(DOOR_ANIM_TICKS + 1);
  });
});
