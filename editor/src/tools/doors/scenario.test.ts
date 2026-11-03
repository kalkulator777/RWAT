/**
 * The doors of the example pack's coach and shunter made again with the doors tool
 * (docs/proposals/editor.md M4): the type's `doors` taken out, each door made of objects
 * of the model — a leaf and its handle, a leaf by a double click, the doorway guides the
 * models carry — or added from the keyboard, then its box fixed by a drag (the edge snaps
 * to the door beside) or by numbers typed, its id, flags and group set in the inspector's
 * terms (../scenarios.node.ts `makeDoors`). The doors come out as the repository's files
 * have them, and the floor check finds nothing, as the engine's tests say of the example
 * pack.
 */

import { describe, expect, it } from 'vitest';
import { exampleModel } from '../../model/testing.node';
import { findings } from '../../ports/floorCheck';
import { ToolHost } from '../registry';
import { DOOR_STEPS, makeDoors, repositoryType, typeFile, type MarkedWagon } from '../scenarios.node';
import { bench } from '../testing.node';
import doorsTool, { type DoorsSession } from './index';

describe('the example pack’s doors made again with the doors tool', () => {
  for (const name of ['coach', 'shunter'] as MarkedWagon[]) {
    it(`come out as the repository has ${name}’s`, async () => {
      const id = `rwat_example:${name}`;
      const file = typeFile(name);
      const expected = repositoryType(name).doors;
      const b = await bench(id, await exampleModel(name));
      b.journal.dispatch({ label: 'x', ops: [{ op: 'remove', file, at: '/doors' }] });
      const host = new ToolHost([doorsTool]);
      const stop = host.connect(b.wiring);
      host.use('doors');
      const tool = (host.current.value?.session as DoorsSession).tool;

      makeDoors(b, tool, id, expected, DOOR_STEPS[name]);

      const json = b.pack.value?.json(file) as { doors: unknown[] };
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
