/**
 * The driver's chairs of the example pack's shunter made again with the chairs tool
 * (docs/proposals/editor.md M4): the type's `cab.seats` taken out, each chair placed by a
 * click on its cushion in the model, somewhere off the cushion's middle — the click takes
 * the middle of the cushion's top —, its yaw typed. The chairs come out as the
 * repository's file has them, and the floor check finds nothing, as the engine's tests say
 * of the example pack. The coach has no chairs: there is nothing of it to make again.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exampleModel } from '../../model/testing.node';
import { findings } from '../../ports/floorCheck';
import { EXAMPLE_PACK } from '../../testing/repo.node';
import { ToolHost } from '../registry';
import { bench } from '../testing.node';
import seatsTool, { type SeatsSession } from './index';
import { SEATS_TIMING } from './session';

// drawn again at once after each edit, however slow an instrumented run is
SEATS_TIMING.slowMs = Number.POSITIVE_INFINITY;

interface SeatJson {
  at: [number, number, number];
  yaw?: number;
}

/** Where each chair's cushion is clicked: an object of the model and a point on it. */
const CLICKS: Record<'shunter', { object: string; at: [number, number, number] }[]> = {
  shunter: [
    { object: 'INTERIOR_CHAIRS_LCG_IL', at: [1.52, 2.1, -0.93] },
    { object: 'INTERIOR_CHAIRS_LCG_IL', at: [3.08, 2.1, 0.69] },
  ],
};

describe('the example pack’s chairs placed again with the chairs tool', () => {
  for (const [name, clicks] of Object.entries(CLICKS) as ['shunter', (typeof CLICKS)['shunter']][]) {
    it(`come out as the repository has ${name}’s`, async () => {
      const id = `rwat_example:${name}`;
      const file = `data/rwat_example/wagon_types/${name}.json`;
      const expected = (JSON.parse(readFileSync(join(EXAMPLE_PACK, file), 'utf8')) as { cab: { seats: SeatJson[] } }).cab.seats;
      expect(expected).toHaveLength(clicks.length);
      const b = await bench(id, await exampleModel(name));
      b.journal.dispatch({ label: 'x', ops: [{ op: 'remove', file, at: '/cab/seats' }] });
      const host = new ToolHost([seatsTool]);
      const stop = host.connect(b.wiring);
      host.use('seats');
      const tool = (host.current.value?.session as SeatsSession | undefined)?.tool;
      if (tool === undefined) throw new Error('the tool is not on');

      expected.forEach((seat, i) => {
        const click = clicks[i]!;
        b.view.emitPick({ object: click.object, point: click.at, shift: false, ctrl: false, alt: false, double: false });
        expect(b.selection.value).toEqual([{ kind: 'seat', type: id, index: i }]);
        const ref = tool.selected();
        if (ref === null) throw new Error('no chair selected');
        tool.setYaw(ref, seat.yaw ?? 0);
      });

      const json = b.pack.value?.json(file) as { cab: { seats: SeatJson[] } };
      expect(json.cab.seats).toEqual(expected);
      const type = host.subject.value?.type;
      if (type === undefined || type === null) throw new Error('the type does not load');
      expect(findings(type)).toEqual([]);
      expect(tool.picture.value?.findings).toEqual([]);
      // every step was a command of the journal: undone, the type has no chairs again
      while (b.journal.state().done.length > 1) b.journal.undo();
      expect(b.pack.value?.json(file)).toMatchObject({ cab: {} });
      expect((b.pack.value?.json(file) as { cab: object }).cab).not.toHaveProperty('seats');
      stop();
    });
  }
});
