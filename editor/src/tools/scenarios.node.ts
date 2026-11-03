/**
 * Node only (the tools' scenario tests): how the example pack's markup is made again with
 * the markup tools (docs/proposals/editor.md M4) — the floor zones with the zones tool, the
 * doors with the doors tool, the driver's chairs with the chairs tool — each step a gesture
 * in the view or a number, a flag, an id typed in the inspector's terms. Each tool's own
 * scenario (./floor, ./doors, ./seats `scenario.test.ts`) makes its part of a wagon whose
 * other markup is there; ./scenario.test.ts makes all three, one after the other, in one
 * journal, for a wagon with none.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import type { Link, ViewPointer } from '../core/contracts';
import { EXAMPLE_PACK } from '../testing/repo.node';
import type { DoorFlag } from './doors/doors';
import type { DoorsTool } from './doors/session';
import type { FloorTool } from './floor/session';
import type { SeatsTool } from './seats/session';
import type { Bench } from './testing.node';

/** The example wagons with markup. */
export type MarkedWagon = 'coach' | 'shunter';

export interface ZoneJson {
  min: [number, number, number];
  max: [number, number, number];
}

export interface DoorJson {
  id: string;
  min: [number, number, number];
  max: [number, number, number];
  group?: string;
  inner?: boolean;
  fixed?: boolean;
  connecting?: boolean;
}

export interface SeatJson {
  at: [number, number, number];
  yaw?: number;
}

/** The markup of a wagon type as the repository's file has it. */
export interface Markup {
  interior: ZoneJson[];
  doors: DoorJson[];
  cab?: { seats: SeatJson[] };
}

/** The type's pack path. */
export function typeFile(name: MarkedWagon): string {
  return `data/rwat_example/wagon_types/${name}.json`;
}

/** The type's JSON as the repository's file has it. */
export function repositoryType(name: MarkedWagon): Markup & Record<string, unknown> {
  return JSON.parse(readFileSync(join(EXAMPLE_PACK, typeFile(name)), 'utf8')) as Markup & Record<string, unknown>;
}

// ---------------------------------------------------------------- the zones tool

/** A pointer from the top over (x, z), one pixel a hundredth of a block, Shift held (a new zone even beside another). */
function zonePointer(x: number, z: number): ViewPointer {
  return { origin: [x, 50, z], direction: [0, -1, 0], pixel: 0.01, view: 'top', shift: true, ctrl: false, alt: false };
}

/** How each zone's floor is had: a click on an object of the model at a point, or the number typed. */
export type Floor = { click: string; at: [number, number, number] } | { typed: true };

export const ZONE_FLOORS: Record<MarkedWagon, Floor[]> = {
  coach: [{ typed: true }, { click: 'FLOOR', at: [0, 1.3, 0] }, { click: 'FLOOR', at: [0, 1.3, 1] }, { typed: true }],
  shunter: [{ click: 'INTERIOR_CAB_FLOOR_LCG_IL', at: [2.3, 1.6, 0] }, { typed: true }],
};

/**
 * Draws the zones by a drag in the view from the top a thousandth of a block off their
 * corners — the edges snap to the floor guides the models carry and to the zones drawn
 * before —, each floor taken by a click on the model or typed, each top typed.
 */
export function drawZones(b: Bench, tool: FloorTool, wagon: string, zones: readonly ZoneJson[], floors: readonly Floor[]): void {
  const dragger = b.view.dragger;
  if (dragger === null) throw new Error('no dragger');
  zones.forEach((zone, i) => {
    // a thousandth of a block off the corner, outside: the edges snap back onto it
    const inset = -0.001;
    expect(dragger.press(zonePointer(zone.min[0] + inset, zone.min[2] + inset))).toBe(true);
    dragger.drag(zonePointer((zone.min[0] + zone.max[0]) / 2, (zone.min[2] + zone.max[2]) / 2));
    dragger.release(zonePointer(zone.max[0] - inset, zone.max[2] - inset));
    expect(b.selection.value).toEqual([{ kind: 'zone', type: wagon, index: i }]);
    const floor = floors[i] as Floor;
    if ('click' in floor) {
      tool.pickingHeight.value = i;
      expect(b.view.emitPick({ object: floor.click, point: floor.at, shift: false, ctrl: false, alt: false, double: false })).toBe(true);
    } else {
      tool.setNumber(i, 'min', 1, zone.min[1]);
    }
    tool.setNumber(i, 'max', 1, zone.max[1]);
  });
}

// ---------------------------------------------------------------- the doors tool

/** A pointer from the top over (x, z), zoomed in: a pixel a thousandth of a block. */
function doorPointer(x: number, z: number): ViewPointer {
  return { origin: [x, 50, z], direction: [0, -1, 0], pixel: 0.001, view: 'top', shift: false, ctrl: false, alt: false };
}

/** How a door is made, then what is done to it. */
export interface DoorStep {
  /** Objects selected for «Дверь по выделенному»; `double`: one object double-clicked; `add`: the keyboard's door. */
  make: { objects: string[] } | { double: string } | 'add';
  /** Numbers typed: [corner, axis, value]. */
  numbers?: ['min' | 'max', 0 | 1 | 2, number][];
  /** A drag from the top: from a point of the plan to another. */
  drag?: [[number, number], [number, number]];
}

export const DOOR_STEPS: Record<MarkedWagon, DoorStep[]> = {
  coach: [
    // the leaf with its handle stands out of the wall: its outer face typed back
    { make: { objects: ['DOOR_1_TL_0.95_X', 'DOOR_1_HANDLE'] }, numbers: [['max', 2, 1.51]] },
    { make: { objects: ['GUIDE_DOORWAY_DOOR_FR'] } },
    { make: { double: 'DOOR_3_TL_-0.95_X' } },
    // the handle out of the right wall: its edge dragged back to the wall, where it snaps to door_fr's
    { make: { objects: ['DOOR_4_HANDLE', 'DOOR_4_TL_-0.95_X'] }, drag: [[8.75, -1.55], [8.75, -1.5123]] },
    { make: { objects: ['DOOR_5_LEAF'] } },
    { make: { objects: ['GUIDE_DOORWAY_GANGWAY_REAR'] } },
    { make: { objects: ['SALON_DOOR_LEAF_INTERIOR_LCG_IL'] } },
    { make: { objects: ['GUIDE_DOORWAY_SALON_ARCH'] } },
  ],
  shunter: [
    { make: { objects: ['GUIDE_DOORWAY_STEPS_LEFT'] } },
    {
      make: 'add',
      numbers: [
        ['min', 0, 2],
        ['max', 0, 2.6],
        ['min', 1, 1.6],
        ['max', 1, 3.6],
        ['min', 2, -1.5],
        ['max', 2, -1.42],
      ],
    },
  ],
};

const FLAGS: readonly DoorFlag[] = ['connecting', 'inner', 'fixed'];

/**
 * Makes the doors of objects of the model — a leaf and its handle, a leaf by a double
 * click, the doorway guides the models carry — or from the keyboard, then fixes each box
 * by a drag (the edge snaps to the door beside) or by numbers typed, and sets its id,
 * flags and group.
 */
export function makeDoors(b: Bench, tool: DoorsTool, wagon: string, doors: readonly DoorJson[], steps: readonly DoorStep[]): void {
  const object = (name: string): Link => ({ kind: 'object', model: wagon, name });
  expect(doors).toHaveLength(steps.length);
  doors.forEach((door, i) => {
    const step = steps[i] as DoorStep;
    if (step.make === 'add') {
      tool.add();
    } else if ('objects' in step.make) {
      b.selection.value = step.make.objects.map(object);
      expect(tool.fromSelection()).toBe(true);
    } else {
      // the view's two clicks select the object, then the double click
      b.selection.value = [object(step.make.double)];
      expect(b.view.emitPick({ object: step.make.double, point: [0, 0, 0], shift: false, ctrl: false, alt: false, double: true })).toBe(true);
    }
    expect(b.selection.value).toEqual([{ kind: 'door', type: wagon, index: i }]);
    for (const [corner, axis, value] of step.numbers ?? []) tool.setNumber(i, corner, axis, value);
    if (step.drag !== undefined) {
      const dragger = b.view.dragger;
      if (dragger === null) throw new Error('no dragger');
      const [from, to] = step.drag;
      expect(dragger.press(doorPointer(...from))).toBe(true);
      dragger.drag(doorPointer((from[0] + to[0]) / 2, (from[1] + to[1]) / 2));
      dragger.release(doorPointer(...to));
    }
    expect(tool.setId(i, door.id)).toBe(true);
    for (const flag of FLAGS) if (door[flag] === true) tool.setFlag(i, flag, true);
    if (door.group !== undefined) tool.setGroup(i, door.group);
  });
}

// ---------------------------------------------------------------- the chairs tool

/** Where each chair's cushion is clicked: an object of the model and a point on it, off the cushion's middle. */
export const CHAIR_CLICKS: Record<MarkedWagon, { object: string; at: [number, number, number] }[]> = {
  coach: [],
  shunter: [
    { object: 'INTERIOR_CHAIRS_LCG_IL', at: [1.52, 2.1, -0.93] },
    { object: 'INTERIOR_CHAIRS_LCG_IL', at: [3.08, 2.1, 0.69] },
  ],
};

/** Places each chair by a click on its cushion in the model — the click takes the middle of the cushion's top — and types its yaw. */
export function placeChairs(b: Bench, tool: SeatsTool, wagon: string, seats: readonly SeatJson[], clicks: readonly { object: string; at: [number, number, number] }[]): void {
  expect(seats).toHaveLength(clicks.length);
  seats.forEach((seat, i) => {
    const click = clicks[i] as (typeof clicks)[number];
    expect(b.view.emitPick({ object: click.object, point: click.at, shift: false, ctrl: false, alt: false, double: false })).toBe(true);
    expect(b.selection.value).toEqual([{ kind: 'seat', type: wagon, index: i }]);
    const ref = tool.selected();
    if (ref === null) throw new Error('no chair selected');
    tool.setYaw(ref, seat.yaw ?? 0);
  });
}
