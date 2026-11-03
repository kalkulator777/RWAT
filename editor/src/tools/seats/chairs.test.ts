import { describe, expect, it } from 'vitest';
import type { Command } from '../../core/contracts';
import { loadWagonType, type WagonType } from '../../ports/wagonType';
import { openExamplePack } from '../testing.node';
import { addChair, chairFacts, chairPointer, chairsForm, chairsOf, removeChair, reorderChair, setChair } from './chairs';

const SHUNTER = 'data/rwat_example/wagon_types/shunter.json';
const F = 'type.json';

/** The type as the engine reads it; the test fails for one that does not load. */
function typeOf(id: string, json: unknown): WagonType {
  const type = loadWagonType(id, json).type;
  if (type === null) throw new Error(`${id} does not load`);
  return type;
}

/** The example pack open with its journal, the shunter's file as it stands. */
async function shunter() {
  const { pack, journal } = await openExamplePack();
  const json = () => pack.json(SHUNTER) as { cab: Record<string, unknown> };
  const run = (command: Command) => journal.dispatch(command);
  return { pack, journal, json, run };
}

describe('the chairs of a type’s JSON', () => {
  it('are the list, the old one-chair form as a list of one, or none', () => {
    expect(chairsOf({ cab: { seats: [{ at: [1, 2, 3], yaw: 90 }, { at: [4, 5, 6] }, { at: [1, 2] }] } })).toEqual([
      { at: [1, 2, 3], yaw: 90 },
      { at: [4, 5, 6], yaw: 0 },
      null,
    ]);
    expect(chairsOf({ cab: { seat: [1, 2, 3], seat_yaw: 180 } })).toEqual([{ at: [1, 2, 3], yaw: 180 }]);
    expect(chairsOf({ cab: { seat: [1, 2, 3] } })).toEqual([{ at: [1, 2, 3], yaw: 0 }]);
    // both at once (an error of the format): the list's
    expect(chairsOf({ cab: { seats: [{ at: [7, 8, 9], yaw: 0 }], seat: [1, 2, 3] } })).toEqual([{ at: [7, 8, 9], yaw: 0 }]);
    expect(chairsOf({ cab: {} })).toEqual([]);
    expect(chairsOf({})).toEqual([]);
    expect(chairsOf({ cab: { seats: [{ at: [1, 2, 3], yaw: 'back' }] } })).toEqual([null]);
  });

  it('are written in one of five forms', () => {
    expect(chairsForm({})).toBe('no-cab');
    expect(chairsForm({ cab: {} })).toBe('none');
    expect(chairsForm({ cab: { seats: [] } })).toBe('list');
    expect(chairsForm({ cab: { seat: [0, 0, 0] } })).toBe('old');
    expect(chairsForm({ cab: { seat: [0, 0, 0], seats: [] } })).toBe('both');
    expect(chairPointer({ cab: { seat: [0, 0, 0] } }, 0)).toBe('/cab/seat');
    expect(chairPointer({ cab: { seats: [] } }, 3)).toBe('/cab/seats/3');
  });
});

describe('the commands of the chairs', () => {
  const chair = { at: [1, 2.1, -0.8] as [number, number, number], yaw: 0 };

  it('add a chair to the list, making the list, or the cab, where there is none', () => {
    expect(addChair(F, { cab: { seats: [{ at: [0, 0, 0] }] } }, chair).ops).toEqual([{ op: 'insert', file: F, at: '/cab/seats/-', value: { at: [1, 2.1, -0.8], yaw: 0 } }]);
    expect(addChair(F, { cab: {} }, chair).ops).toEqual([{ op: 'set', file: F, at: '/cab/seats', value: [{ at: [1, 2.1, -0.8], yaw: 0 }] }]);
    expect(addChair(F, { length: 9 }, chair).ops).toEqual([{ op: 'set', file: F, at: '/cab', value: { seats: [{ at: [1, 2.1, -0.8], yaw: 0 }] } }]);
    const full = { cab: { seats: Array.from({ length: 16 }, () => ({ at: [0, 0, 0] })) } };
    expect(addChair(F, full, chair).ops).toEqual([]);
    expect(addChair(F, { cab: {} }, chair)).toMatchObject({ label: 'tools.seats.cmd.add', labelParams: { index: 0 } });
  });

  it('turn the old form into the list before an edit addresses it, and drop an old key beside the list', () => {
    const old = { cab: { seat: [1, 2, 3], seat_yaw: 90 } };
    expect(setChair(F, old, 0, { at: [1, 2, 3], yaw: 180 }).ops).toEqual([
      { op: 'remove', file: F, at: '/cab/seat' },
      { op: 'remove', file: F, at: '/cab/seat_yaw' },
      { op: 'set', file: F, at: '/cab/seats', value: [{ at: [1, 2, 3], yaw: 90 }] },
      { op: 'set', file: F, at: '/cab/seats/0/yaw', value: 180 },
    ]);
    expect(addChair(F, { cab: { seat: [1, 2, 3] } }, chair).ops).toEqual([
      { op: 'remove', file: F, at: '/cab/seat' },
      { op: 'set', file: F, at: '/cab/seats', value: [{ at: [1, 2, 3] }] },
      { op: 'insert', file: F, at: '/cab/seats/-', value: { at: [1, 2.1, -0.8], yaw: 0 } },
    ]);
    expect(setChair(F, { cab: { seats: [{ at: [1, 2, 3], yaw: 0 }], seat: [4, 5, 6], seat_yaw: 9 } }, 0, { at: [1, 2, 3], yaw: 45 }).ops).toEqual([
      { op: 'remove', file: F, at: '/cab/seat' },
      { op: 'remove', file: F, at: '/cab/seat_yaw' },
      { op: 'set', file: F, at: '/cab/seats/0/yaw', value: 45 },
    ]);
  });

  it('write what changed only: a chair moved keeps an unwritten yaw unwritten', () => {
    const json = { cab: { seats: [{ at: [1, 2, 3] }, { at: [4, 5, 6], yaw: 180 }] } };
    expect(setChair(F, json, 0, { at: [1, 2, 3.5], yaw: 0 }).ops).toEqual([{ op: 'set', file: F, at: '/cab/seats/0/at', value: [1, 2, 3.5] }]);
    expect(setChair(F, json, 1, { at: [4, 5, 6], yaw: 180 }).ops).toEqual([]);
    expect(setChair(F, json, 1, { at: [4, 5, 6], yaw: 0 }, { label: 'x', coalesceKey: 'k' })).toEqual({
      label: 'x',
      labelParams: { index: 1 },
      ops: [{ op: 'set', file: F, at: '/cab/seats/1/yaw', value: 0 }],
      coalesceKey: 'k',
    });
    expect(setChair(F, json, 5, { at: [0, 0, 0], yaw: 0 }).ops).toEqual([]);
    // an element that is no chair is written whole
    expect(setChair(F, { cab: { seats: [7] } }, 0, chair).ops).toEqual([{ op: 'set', file: F, at: '/cab/seats/0', value: { at: [1, 2.1, -0.8], yaw: 0 } }]);
  });

  it('remove a chair; the last takes the list (or the old chair) with it, the cab stays', () => {
    expect(removeChair(F, { cab: { seats: [{ at: [1, 2, 3] }, { at: [4, 5, 6] }] } }, 0).ops).toEqual([{ op: 'remove', file: F, at: '/cab/seats/0' }]);
    expect(removeChair(F, { cab: { seats: [{ at: [1, 2, 3] }] } }, 0).ops).toEqual([{ op: 'remove', file: F, at: '/cab/seats' }]);
    expect(removeChair(F, { cab: { seat: [1, 2, 3], seat_yaw: 4 } }, 0).ops).toEqual([
      { op: 'remove', file: F, at: '/cab/seat' },
      { op: 'remove', file: F, at: '/cab/seat_yaw' },
    ]);
    expect(removeChair(F, { cab: { seats: [] } }, 0).ops).toEqual([]);
  });

  it('reorder the list', () => {
    const json = { cab: { seats: [{ at: [1, 2, 3] }, { at: [4, 5, 6] }] } };
    expect(reorderChair(F, json, 1, 0).ops).toEqual([
      { op: 'remove', file: F, at: '/cab/seats/1' },
      { op: 'insert', file: F, at: '/cab/seats/0', value: { at: [4, 5, 6] } },
    ]);
    expect(reorderChair(F, json, 1, 1).ops).toEqual([]);
    expect(reorderChair(F, json, 0, 2).ops).toEqual([]);
  });

  it('are journal entries: the shunter’s chairs added, turned, moved and removed, then all undone', async () => {
    const { journal, json, run } = await shunter();
    const before = JSON.stringify(json());
    run(addChair(SHUNTER, json(), { at: [2.3, 2.1, 0], yaw: 0 }));
    run(setChair(SHUNTER, json(), 2, { at: [2.3, 2.1, 0], yaw: 90 }));
    run(reorderChair(SHUNTER, json(), 2, 0));
    expect(chairsOf(json())).toEqual([
      { at: [2.3, 2.1, 0], yaw: 90 },
      { at: [1.65, 2.1, -0.8], yaw: 0 },
      { at: [2.95, 2.1, 0.8], yaw: 180 },
    ]);
    run(removeChair(SHUNTER, json(), 0));
    run(removeChair(SHUNTER, json(), 0));
    run(removeChair(SHUNTER, json(), 0));
    expect(json().cab).toEqual({});
    while (journal.canUndo) journal.undo();
    expect(JSON.stringify(json())).toBe(before);
  });

  it('turn the old form the file has into the list at the first edit; undone, the old form is back', async () => {
    const { pack, journal, json, run } = await shunter();
    run({ label: 'x', ops: [{ op: 'set', file: SHUNTER, at: '/cab', value: { seat: [1.65, 2.1, -0.8], seat_yaw: 0 } }] });
    const old = structuredClone(json().cab);
    expect(chairsForm(json())).toBe('old');
    run(setChair(SHUNTER, json(), 0, { at: [1.65, 2.1, -0.8], yaw: 180 }));
    expect(json().cab).toEqual({ seats: [{ at: [1.65, 2.1, -0.8], yaw: 180 }] });
    expect(typeOf('rwat_example:shunter', pack.json(SHUNTER)).cab?.seats).toHaveLength(1);
    journal.undo();
    // as a JSON value: the journal puts a removed key back last
    expect(json().cab).toEqual(old);
    expect(pack.status(SHUNTER)).toBe('changed');
  });
});

describe('what the engine makes of the chairs', () => {
  it('of the shunter: both in its one cab, sat down in from its floor, the cushion half a block over it', async () => {
    const { pack } = await openExamplePack();
    const facts = chairFacts(typeOf('rwat_example:shunter', pack.json(SHUNTER)));
    expect(facts.map((f) => [f.cab, f.sittable])).toEqual([
      [0, true],
      [0, true],
    ]);
    for (const f of facts) {
      expect(f.reach).toBeLessThan(1e-9);
      expect(f.height).toBeCloseTo(0.5, 5);
      expect(f.stand?.[1]).toBeCloseTo(1.6, 5);
    }
    expect(facts[0]?.stand?.[0]).toBeCloseTo(1.65, 5);
    expect(facts[0]?.stand?.[2]).toBeCloseTo(-0.8, 5);
  });

  it('of a chair too high: not sat down in, as the floor check says', async () => {
    const { pack } = await openExamplePack();
    const json = structuredClone(pack.json(SHUNTER)) as { cab: { seats: { at: number[] }[] } };
    json.cab.seats[0]!.at[1] = 3.3;
    const facts = chairFacts(typeOf('rwat_example:shunter', json));
    expect(facts[0]).toMatchObject({ sittable: false, cab: 0 });
    expect(facts[0]?.height).toBeCloseTo(1.7, 5);
    expect(facts[1]?.sittable).toBe(true);
  });

  it('of a type without a floor: nowhere to stand, no cab', () => {
    const type = typeOf('x:y', { length: 10, bogies: [3, -3], mass_t: 10, cab: { seats: [{ at: [0, 2, 0] }] } });
    expect(chairFacts(type)).toEqual([{ stand: null, reach: Number.POSITIVE_INFINITY, height: Number.NaN, sittable: true, cab: -1 }]);
  });
});
