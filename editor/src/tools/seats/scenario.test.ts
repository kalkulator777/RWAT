/**
 * The driver's chairs of the example pack's shunter made again with the chairs tool
 * (docs/proposals/editor.md M4): the type's `cab.seats` taken out, each chair placed by a
 * click on its cushion in the model, somewhere off the cushion's middle — the click takes
 * the middle of the cushion's top —, its yaw typed (../scenarios.node.ts `placeChairs`).
 * The chairs come out as the repository's file has them, and the floor check finds
 * nothing, as the engine's tests say of the example pack. The coach has no chairs: there
 * is nothing of it to make again.
 */

import { describe, expect, it } from 'vitest';
import { exampleModel } from '../../model/testing.node';
import { findings } from '../../ports/floorCheck';
import { ToolHost } from '../registry';
import { CHAIR_CLICKS, placeChairs, repositoryType, typeFile } from '../scenarios.node';
import { bench } from '../testing.node';
import seatsTool, { type SeatsSession } from './index';
import { SEATS_TIMING } from './session';

// drawn again at once after each edit, however slow an instrumented run is
SEATS_TIMING.slowMs = Number.POSITIVE_INFINITY;

describe('the example pack’s chairs placed again with the chairs tool', () => {
  it('come out as the repository has the shunter’s', async () => {
    const id = 'rwat_example:shunter';
    const file = typeFile('shunter');
    const expected = repositoryType('shunter').cab?.seats ?? [];
    const b = await bench(id, await exampleModel('shunter'));
    b.journal.dispatch({ label: 'x', ops: [{ op: 'remove', file, at: '/cab/seats' }] });
    const host = new ToolHost([seatsTool]);
    const stop = host.connect(b.wiring);
    host.use('seats');
    const tool = (host.current.value?.session as SeatsSession | undefined)?.tool;
    if (tool === undefined) throw new Error('the tool is not on');

    placeChairs(b, tool, id, expected, CHAIR_CLICKS.shunter);

    const json = b.pack.value?.json(file) as { cab: { seats: unknown[] } };
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
});
