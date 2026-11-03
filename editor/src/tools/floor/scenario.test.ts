/**
 * The floor of the example pack's coach and shunter made again with the floor tool
 * (docs/proposals/editor.md M4): the type's `interior` taken out, each zone drawn by a drag
 * in the view from the top a thousandth of a block off its corners — the edges snap to the floor guides
 * the models carry and to the zones drawn before —, its floor taken by a click on the
 * model or typed, its top typed. The zones come out as the repository's files have them,
 * and the floor check finds nothing, as the engine's tests say of the example pack.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findings } from '../../ports/floorCheck';
import { exampleModel } from '../../model/testing.node';
import { EXAMPLE_PACK } from '../../testing/repo.node';
import type { ViewPointer } from '../../core/contracts';
import { ToolHost } from '../registry';
import { bench } from '../testing.node';
import floorTool, { type FloorSession } from './index';
import { FLOOR_TIMING } from './session';

// drawn again at once after each edit, however slow an instrumented run is
FLOOR_TIMING.slowMs = Number.POSITIVE_INFINITY;

/** A pointer from the top over (x, z), one pixel a hundredth of a block, Shift held (a new zone even beside another). */
function top(x: number, z: number): ViewPointer {
  return { origin: [x, 50, z], direction: [0, -1, 0], pixel: 0.01, view: 'top', shift: true, ctrl: false, alt: false };
}

interface ZoneJson {
  min: [number, number, number];
  max: [number, number, number];
}

/** How each zone's floor is had: a click on an object of the model at a point, or the number typed. */
type Floor = { click: string; at: [number, number, number] } | { typed: true };

const CASES: Record<'coach' | 'shunter', Floor[]> = {
  coach: [{ typed: true }, { click: 'FLOOR', at: [0, 1.3, 0] }, { click: 'FLOOR', at: [0, 1.3, 1] }, { typed: true }],
  shunter: [{ click: 'INTERIOR_CAB_FLOOR_LCG_IL', at: [2.3, 1.6, 0] }, { typed: true }],
};

describe('the example pack’s floors drawn again with the floor tool', () => {
  for (const [name, floors] of Object.entries(CASES) as ['coach' | 'shunter', Floor[]][]) {
    it(`come out as the repository has ${name}’s`, async () => {
      const id = `rwat_example:${name}`;
      const file = `data/rwat_example/wagon_types/${name}.json`;
      const expected = (JSON.parse(readFileSync(join(EXAMPLE_PACK, file), 'utf8')) as { interior: ZoneJson[] }).interior;
      const model = await exampleModel(name);
      const b = await bench(id, model);
      b.journal.dispatch({ label: 'x', ops: [{ op: 'remove', file, at: '/interior' }] });
      const host = new ToolHost([floorTool]);
      const stop = host.connect(b.wiring);
      host.use('floor');
      const on = host.current.value;
      if (on === null) throw new Error('the tool is not on');
      const tool = (on.session as FloorSession).tool;
      const dragger = b.view.dragger;
      if (dragger === null) throw new Error('no dragger');

      expected.forEach((zone, i) => {
        // a thousandth of a block off the corner, outside: the edges snap back onto it
        const inset = -0.001;
        expect(dragger.press(top(zone.min[0] + inset, zone.min[2] + inset))).toBe(true);
        dragger.drag(top((zone.min[0] + zone.max[0]) / 2, (zone.min[2] + zone.max[2]) / 2));
        dragger.release(top(zone.max[0] - inset, zone.max[2] - inset));
        expect(b.selection.value).toEqual([{ kind: 'zone', type: id, index: i }]);
        const floor = floors[i] as Floor;
        if ('click' in floor) {
          tool.pickingHeight.value = i;
          b.view.emitPick({ object: floor.click, point: floor.at, shift: false, ctrl: false, alt: false, double: false });
        } else {
          tool.setNumber(i, 'min', 1, zone.min[1]);
        }
        tool.setNumber(i, 'max', 1, zone.max[1]);
      });

      const json = b.pack.value?.json(file) as { interior: ZoneJson[] };
      expect(json.interior).toEqual(expected);
      const type = host.subject.value?.type;
      if (type === undefined || type === null) throw new Error('the type does not load');
      expect(findings(type)).toEqual([]);
      expect(tool.picture.value?.findings).toEqual([]);
      // every step was a command of the journal: undone, the type has no floor again
      while (b.journal.state().done.length > 1) b.journal.undo();
      expect(b.pack.value?.json(file)).not.toHaveProperty('interior');
      stop();
    });
  }
});
