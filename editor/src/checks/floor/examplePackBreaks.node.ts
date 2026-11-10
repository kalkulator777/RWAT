/**
 * Node only (tests): every way `ExamplePackLoadTest` breaks the example pack's markup
 * (`coachBreaks`, `shunterBreaks`, `coachLeafBreaks`: copies of a type file with one
 * change), and what is to see each by — a finding of the pack check
 * (./examplePackBreaks.test.ts) or, for the two no check sees, a markup tool's overlay
 * (tools/examplePackBreaks.test.ts). Java's list is the source: a break added there is added
 * here.
 */

import { dump } from '../../core/json';
import { EXAMPLE_PACK, readTree } from '../../core/pack/testing.node';

export const COACH = 'data/rwat_example/wagon_types/coach.json';
export const SHUNTER = 'data/rwat_example/wagon_types/shunter.json';
export const COACH_MODEL = 'assets/rwat_example/wagon_models/coach.json';

export interface Box {
  id?: string;
  min?: number[];
  max?: number[];
  at?: number[];
  yaw?: number;
}

export interface TypeJson {
  interior: Box[];
  doors: Box[];
  cab: { seats: Box[] };
}

/** `ExamplePackLoadTest.move`: the box (or chair) moved along an axis of the OBJ frame. */
function move(box: Box, axis: number, by: number): void {
  for (const key of ['min', 'max', 'at'] as const) {
    const xyz = box[key];
    if (xyz !== undefined) xyz[axis] = xyz[axis]! + by;
  }
}

function door(type: TypeJson, id: string): Box {
  const found = type.doors.find((d) => d.id === id);
  if (found === undefined) throw new Error(`no door ${id}`);
  return found;
}

/**
 * A break: which type file, the change, what the checks must say of it (a code and where it
 * points) — or null: no check sees it, and then the markup tool's overlay that shows it
 * (tools/examplePackBreaks.test.ts): the doors tool's bridge of an inner door that meets the
 * floor on one side only, or the chairs tool's arrows of which way each chair drives.
 */
export interface Break {
  file: string;
  change: (type: TypeJson) => void;
  caught: { code: string; at: unknown[] } | null;
  shown?: 'doors.bridge' | 'seats.facing';
}

const field = (file: string, at: string) => ({ kind: 'field', file, at });

export const BREAKS: Record<string, Break> = {
  // coachBreaks
  'the salon aisle run up to the front vestibule, through salon_door’s doorway': {
    file: COACH,
    change: (t) => {
      t.interior[1]!.min![0] = -7.9;
    },
    caught: { code: 'floor.inner-door-floor-through', at: [field(COACH, '/doors/6'), { kind: 'door', type: 'rwat_example:coach', index: 6 }] },
  },
  'salon_door a block into the salon': {
    file: COACH,
    change: (t) => move(door(t, 'salon_door'), 0, 1.0),
    caught: { code: 'floor.inner-door-floor-through', at: [field(COACH, '/doors/6'), { kind: 'door', type: 'rwat_example:coach', index: 6 }] },
  },
  'door_fl half a block off the side wall': {
    file: COACH,
    change: (t) => move(door(t, 'door_fl'), 2, 0.5),
    caught: { code: 'floor.door-not-at-floor-end', at: [field(COACH, '/doors/0'), { kind: 'door', type: 'rwat_example:coach', index: 0 }] },
  },
  'salon_arch a block aside, off the aisle': { file: COACH, change: (t) => move(door(t, 'salon_arch'), 2, 1.0), caught: null, shown: 'doors.bridge' },
  'gangway_front in the side wall': {
    file: COACH,
    change: (t) => {
      const gangway = door(t, 'gangway_front');
      gangway.min = [-9.5, 1.15, 1.45];
      gangway.max = [-8.6, 3.25, 1.51];
    },
    caught: { code: 'floor.gangway-not-in-end-wall', at: [field(COACH, '/doors/4'), { kind: 'door', type: 'rwat_example:coach', index: 4 }] },
  },
  // shunterBreaks
  'the second chair facing forward': {
    file: SHUNTER,
    change: (t) => {
      t.cab.seats[1]!.yaw = 0;
    },
    caught: null,
    shown: 'seats.facing',
  },
  'the first chair too high': {
    file: SHUNTER,
    change: (t) => move(t.cab.seats[0]!, 1, 1.2),
    caught: { code: 'floor.seat-not-sittable', at: [field(SHUNTER, '/cab/seats/0'), { kind: 'seat', type: 'rwat_example:shunter', index: 0 }] },
  },
  'steps_left off the wall': {
    file: SHUNTER,
    change: (t) => move(door(t, 'steps_left'), 2, 0.6),
    caught: { code: 'floor.door-not-at-floor-end', at: [field(SHUNTER, '/doors/0'), { kind: 'door', type: 'rwat_example:shunter', index: 0 }] },
  },
  // coachLeafBreaks
  'door_rl’s box away from its leaf': {
    file: COACH,
    change: (t) => move(door(t, 'door_rl'), 0, -2.0),
    caught: { code: 'floor.door-not-at-floor-end', at: [field(COACH, '/doors/2'), { kind: 'door', type: 'rwat_example:coach', index: 2 }] },
  },
  // the model still animates and sounds a salon_door: its keys name no door now
  'salon_door renamed: a door moved by nothing': {
    file: COACH,
    change: (t) => {
      door(t, 'salon_door').id = 'inner';
    },
    caught: { code: 'loader.door-key', at: [field(COACH_MODEL, '/animations/salon_door')] },
  },
};

/** The example pack's files with type `file` broken by `change` (none: as it is). */
export function brokenFiles(file?: string, change?: (type: TypeJson) => void): Map<string, Uint8Array> {
  const files = readTree(EXAMPLE_PACK);
  if (file !== undefined && change !== undefined) files.set(file, new TextEncoder().encode(dump(brokenType(file, change))));
  return files;
}

/** Type `file` of the example pack broken by `change`, as JSON. */
export function brokenType(file: string, change: (type: TypeJson) => void): TypeJson {
  const type = JSON.parse(new TextDecoder().decode(readTree(EXAMPLE_PACK).get(file))) as TypeJson;
  change(type);
  return type;
}
