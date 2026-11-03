/**
 * The floor of the example pack's coach and shunter made again with the floor tool
 * (docs/proposals/editor.md M4): the type's `interior` taken out, each zone drawn by a drag
 * in the view from the top a thousandth of a block off its corners — the edges snap to the floor guides
 * the models carry and to the zones drawn before —, its floor taken by a click on the
 * model or typed, its top typed (../scenarios.node.ts `drawZones`). The zones come out as
 * the repository's files have them, and the floor check finds nothing, as the engine's
 * tests say of the example pack.
 */

import { describe, expect, it } from 'vitest';
import { exampleModel } from '../../model/testing.node';
import { findings } from '../../ports/floorCheck';
import { ToolHost } from '../registry';
import { drawZones, repositoryType, typeFile, ZONE_FLOORS, type MarkedWagon } from '../scenarios.node';
import { bench } from '../testing.node';
import floorTool, { type FloorSession } from './index';
import { FLOOR_TIMING } from './session';

// drawn again at once after each edit, however slow an instrumented run is
FLOOR_TIMING.slowMs = Number.POSITIVE_INFINITY;

describe('the example pack’s floors drawn again with the floor tool', () => {
  for (const name of ['coach', 'shunter'] as MarkedWagon[]) {
    it(`come out as the repository has ${name}’s`, async () => {
      const id = `rwat_example:${name}`;
      const file = typeFile(name);
      const expected = repositoryType(name).interior;
      const b = await bench(id, await exampleModel(name));
      b.journal.dispatch({ label: 'x', ops: [{ op: 'remove', file, at: '/interior' }] });
      const host = new ToolHost([floorTool]);
      const stop = host.connect(b.wiring);
      host.use('floor');
      const on = host.current.value;
      if (on === null) throw new Error('the tool is not on');
      const tool = (on.session as FloorSession).tool;

      drawZones(b, tool, id, expected, ZONE_FLOORS[name]);

      const json = b.pack.value?.json(file) as { interior: unknown[] };
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
