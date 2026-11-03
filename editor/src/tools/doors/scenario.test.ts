/**
 * The doors of the example pack's coach and shunter made again with the doors tool
 * (docs/proposals/editor.md M4): the type's `doors` taken out, each door made of objects
 * of the model — a leaf and its handle, a leaf by a double click, the doorway guides the
 * models carry — or added from the keyboard, then its box fixed by a drag (the edge snaps
 * to the door beside) or by numbers typed, its id, flags and group set in the inspector's
 * terms. The doors come out as the repository's files have them, and the floor check finds
 * nothing, as the engine's tests say of the example pack.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Link } from '../../core/contracts';
import { exampleModel } from '../../model/testing.node';
import { findings } from '../../ports/floorCheck';
import { EXAMPLE_PACK } from '../../testing/repo.node';
import type { ViewPointer } from '../../core/contracts';
import { ToolHost } from '../registry';
import { bench } from '../testing.node';
import doorsTool, { type DoorsSession } from './index';
import type { DoorFlag } from './doors';
import type { DoorsTool } from './session';

/** A pointer from the top over (x, z), zoomed in: a pixel a thousandth of a block. */
function top(x: number, z: number): ViewPointer {
  return { origin: [x, 50, z], direction: [0, -1, 0], pixel: 0.001, view: 'top', shift: false, ctrl: false, alt: false };
}

interface DoorJson {
  id: string;
  min: [number, number, number];
  max: [number, number, number];
  group?: string;
  inner?: boolean;
  fixed?: boolean;
  connecting?: boolean;
}

/** How a door is made, then what is done to it. */
interface Step {
  /** Objects selected for «Дверь по выделенному»; `double`: one object double-clicked; `add`: the keyboard's door. */
  make: { objects: string[] } | { double: string } | 'add';
  /** Numbers typed: [corner, axis, value]. */
  numbers?: ['min' | 'max', 0 | 1 | 2, number][];
  /** A drag from the top: from a point of the plan to another. */
  drag?: [[number, number], [number, number]];
}

const CASES: Record<'coach' | 'shunter', Step[]> = {
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

describe('the example pack’s doors made again with the doors tool', () => {
  for (const [name, steps] of Object.entries(CASES) as ['coach' | 'shunter', Step[]][]) {
    it(`come out as the repository has ${name}’s`, async () => {
      const id = `rwat_example:${name}`;
      const file = `data/rwat_example/wagon_types/${name}.json`;
      const expected = (JSON.parse(readFileSync(join(EXAMPLE_PACK, file), 'utf8')) as { doors: DoorJson[] }).doors;
      expect(expected).toHaveLength(steps.length);
      const model = await exampleModel(name);
      const b = await bench(id, model);
      b.journal.dispatch({ label: 'x', ops: [{ op: 'remove', file, at: '/doors' }] });
      const host = new ToolHost([doorsTool]);
      const stop = host.connect(b.wiring);
      host.use('doors');
      const tool: DoorsTool = (host.current.value?.session as DoorsSession).tool;
      const object = (objectName: string): Link => ({ kind: 'object', model: id, name: objectName });

      expected.forEach((door, i) => {
        const step = steps[i] as Step;
        if (step.make === 'add') {
          tool.add();
        } else if ('objects' in step.make) {
          b.selection.value = step.make.objects.map(object);
          expect(tool.fromSelection()).toBe(true);
        } else {
          // the view's two clicks select the object, then the double click
          b.selection.value = [object(step.make.double)];
          b.view.emitPick({ object: step.make.double, point: [0, 0, 0], shift: false, ctrl: false, alt: false, double: true });
        }
        expect(b.selection.value).toEqual([{ kind: 'door', type: id, index: i }]);
        for (const [corner, axis, value] of step.numbers ?? []) tool.setNumber(i, corner, axis, value);
        if (step.drag !== undefined) {
          const dragger = b.view.dragger;
          if (dragger === null) throw new Error('no dragger');
          const [from, to] = step.drag;
          expect(dragger.press(top(...from))).toBe(true);
          dragger.drag(top((from[0] + to[0]) / 2, (from[1] + to[1]) / 2));
          dragger.release(top(...to));
        }
        expect(tool.setId(i, door.id)).toBe(true);
        for (const flag of FLAGS) if (door[flag] === true) tool.setFlag(i, flag, true);
        if (door.group !== undefined) tool.setGroup(i, door.group);
      });

      const json = b.pack.value?.json(file) as { doors: DoorJson[] };
      expect(json.doors).toEqual(expected);
      const type = host.subject.value?.type;
      if (type === undefined || type === null) throw new Error('the type does not load');
      expect(findings(type)).toEqual([]);
      // every leaf of the model is moved by a door
      expect(tool.picture.value?.movers.filter((m) => m.door < 0)).toEqual([]);
      // every step was a command of the journal: undone, the type has no doors again
      while (b.journal.state().done.length > 1) b.journal.undo();
      expect(b.pack.value?.json(file)).not.toHaveProperty('doors');
      stop();
    });
  }
});
