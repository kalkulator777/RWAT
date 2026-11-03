/**
 * Every way `ExamplePackLoadTest` breaks the example pack's markup (`coachBreaks`,
 * `shunterBreaks`, `coachLeafBreaks`: copies of a type file with one change) is caught by
 * the checks — the floor check here, the loader's rules for a door no model key names —
 * with a finding that points at what was broken (docs/proposals/editor.md §7, M4: "каждая
 * поломка из ExamplePackLoadTest ловится панелью проверок").
 *
 * Two of them no check sees, the engine's `FloorCheck` neither: the arch moved off the
 * aisle (the rear vestibule has doors of its own, so it is still reached) and a chair
 * turned to face forward (a chair may face either way). The markup tools' overlays show
 * those (the bridge beside the aisle, the chair's direction); they are listed here as not
 * checkable automatically, and held to that: a check that starts to see one fails here,
 * so the list stays true.
 */

import { describe, expect, it } from 'vitest';
import type { Problem } from '../../core/contracts';
import { dump } from '../../core/json';
import { Pack } from '../../core/pack';
import { EXAMPLE_PACK, MemorySource, readTree } from '../../core/pack/testing.node';
import { checkPack } from '../pack';
import { floorProblems } from './problems';

const COACH = 'data/rwat_example/wagon_types/coach.json';
const SHUNTER = 'data/rwat_example/wagon_types/shunter.json';
const COACH_MODEL = 'assets/rwat_example/wagon_models/coach.json';

interface Box {
  id?: string;
  min?: number[];
  max?: number[];
  at?: number[];
  yaw?: number;
}

interface TypeJson {
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

/** A break: which type file, the change, what the checks must say of it (a code and where it points) — or null: no check sees it. */
interface Break {
  file: string;
  change: (type: TypeJson) => void;
  caught: { code: string; at: unknown[] } | null;
}

const field = (file: string, at: string) => ({ kind: 'field', file, at });

const BREAKS: Record<string, Break> = {
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
  'salon_arch a block aside, off the aisle': { file: COACH, change: (t) => move(door(t, 'salon_arch'), 2, 1.0), caught: null },
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

/** What the checks say of the example pack with `file` changed: the loader's rules and the floor check (the schema has nothing to say of geometry). */
async function checked(file?: string, change?: (type: TypeJson) => void): Promise<Problem[]> {
  const files = readTree(EXAMPLE_PACK);
  if (file !== undefined && change !== undefined) {
    const type = JSON.parse(new TextDecoder().decode(files.get(file))) as TypeJson;
    change(type);
    files.set(file, new TextEncoder().encode(dump(type)));
  }
  const pack = await Pack.open(new MemorySource(files));
  return [...checkPack(pack, null), ...floorProblems(pack)];
}

describe("the checks catch every way ExamplePackLoadTest breaks the example pack's markup", () => {
  it('find nothing in the pack as it is', async () => {
    expect(await checked()).toEqual([]);
  });

  for (const [name, { file, change, caught }] of Object.entries(BREAKS)) {
    if (caught === null) {
      it(`not checkable automatically — the tools' overlays show it: ${name}`, async () => {
        expect(await checked(file, change)).toEqual([]);
      });
    } else {
      it(`${name}: ${caught.code}`, async () => {
        const problems = await checked(file, change);
        expect(problems.map((p) => ({ code: p.code, at: p.at }))).toContainEqual(caught);
      });
    }
  }

  it('lists the two no check sees, as the plan names them', () => {
    expect(Object.entries(BREAKS).filter(([, b]) => b.caught === null).map(([name]) => name)).toEqual([
      'salon_arch a block aside, off the aisle',
      'the second chair facing forward',
    ]);
  });
});
