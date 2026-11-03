import { describe, expect, it } from 'vitest';
import { openExamplePack } from '../testing.node';
import {
  addZone,
  HEADROOM,
  isOldForm,
  moveZoneTo,
  removeZone,
  selectedZones,
  setZone,
  setZoneHeight,
  setZoneNumber,
  zoneLink,
  zoneOver,
  zonesOf,
} from './zones';

const COACH = 'data/rwat_example/wagon_types/coach.json';

describe('the zones of a type', () => {
  it('are read from the file as it writes them, the old single zone as a list of one, a broken one as null', () => {
    expect(zonesOf({ interior: [{ min: [0, 1, 2], max: [3, 4, 5] }] })).toEqual([{ minX: 0, minY: 1, minZ: 2, maxX: 3, maxY: 4, maxZ: 5 }]);
    expect(zonesOf({ interior: { min: [0, 1, 2], max: [3, 4, 5] } })).toHaveLength(1);
    expect(isOldForm({ interior: { min: [0, 1, 2], max: [3, 4, 5] } })).toBe(true);
    expect(isOldForm({ interior: [] })).toBe(false);
    expect(zonesOf({ interior: [{ min: [0, 1], max: [3, 4, 5] }, { min: [0, 'a', 2], max: [3, 4, 5] }, 7] })).toEqual([null, null, null]);
    expect(zonesOf({})).toEqual([]);
    expect(zonesOf(null)).toEqual([]);
  });

  it('make a zone over a plan with its corners in order and its top 2.5 above the floor', () => {
    expect(zoneOver({ minX: 2, minZ: 1, maxX: -1, maxZ: -1 }, 1.3)).toEqual({ minX: -1, minY: 1.3, minZ: -1, maxX: 2, maxY: 1.3 + HEADROOM, maxZ: 1 });
  });

  it('are selected as zone links of the wagon', () => {
    const links = [zoneLink('a:b', 2), { kind: 'zone', type: 'a:c', index: 1 } as const, zoneLink('a:b', 0), { kind: 'file', file: COACH } as const];
    expect(selectedZones(links, 'a:b')).toEqual([2, 0]);
  });
});

describe('the commands of the zones', () => {
  it('draw, change, move up, take the height of and remove zones, each undone by the journal', async () => {
    const { pack, journal } = await openExamplePack();
    const original = structuredClone(pack.json(COACH));
    const json = () => pack.json(COACH);
    const zone = zoneOver({ minX: 3, minZ: 0.55, maxX: 3.5, maxZ: 0.95 }, 1.3);

    journal.dispatch(addZone(COACH, json(), zone));
    expect(zonesOf(json())).toHaveLength(5);
    expect(zonesOf(json())[4]).toEqual(zone);

    journal.dispatch(setZone(COACH, json(), 4, { ...zone, maxX: 4 }));
    expect(zonesOf(json())[4]?.maxX).toBe(4);
    // only the corner that changed is written
    expect(setZone(COACH, json(), 4, { ...zone, maxX: 4, minZ: 0.5 }).ops.map((op) => ('at' in op ? op.at : ''))).toEqual(['/interior/4/min']);
    expect(setZone(COACH, json(), 4, { ...zone, maxX: 4 }).ops).toEqual([]);

    journal.dispatch(setZoneNumber(COACH, json(), 4, 'min', 2, 0.6));
    expect(zonesOf(json())[4]?.minZ).toBe(0.6);

    journal.dispatch(setZoneHeight(COACH, json(), 4, 1.15));
    expect(zonesOf(json())[4]).toMatchObject({ minY: 1.15, maxY: 1.15 + HEADROOM });

    journal.dispatch(moveZoneTo(COACH, json(), 4, 0));
    expect(zonesOf(json())[0]?.minX).toBe(3);
    expect(zonesOf(json())[1]?.minX).toBe(-9.6);

    journal.dispatch(removeZone(COACH, json(), 0));
    expect(json()).toEqual(original);
    expect(journal.state().done.map((c) => c.label)).toEqual([
      'tools.floor.cmd.add',
      'tools.floor.cmd.set',
      'tools.floor.cmd.set',
      'tools.floor.cmd.height',
      'tools.floor.cmd.order',
      'tools.floor.cmd.remove',
    ]);
    while (journal.canUndo) journal.undo();
    expect(json()).toEqual(original);
  });

  it('take the last zone with interior, and give a type with no floor its first', async () => {
    const { pack, journal } = await openExamplePack();
    const file = 'data/rwat_example/wagon_types/gondola.json';
    expect(zonesOf(pack.json(file))).toEqual([]);
    journal.dispatch(addZone(file, pack.json(file), zoneOver({ minX: 0, minZ: 0, maxX: 1, maxZ: 1 }, 1)));
    expect((pack.json(file) as { interior: unknown[] }).interior).toEqual([{ min: [0, 1, 0], max: [1, 3.5, 1] }]);
    journal.dispatch(removeZone(file, pack.json(file), 0));
    expect(pack.json(file)).not.toHaveProperty('interior');
  });

  it('write the old single zone as a list at the first edit', async () => {
    const { pack, journal } = await openExamplePack();
    const old = { min: [0, 1, 0], max: [2, 3.5, 1] };
    journal.dispatch({ label: 'x', ops: [{ op: 'set', file: COACH, at: '/interior', value: old }] });
    journal.dispatch(addZone(COACH, pack.json(COACH), zoneOver({ minX: 2, minZ: 0, maxX: 3, maxZ: 1 }, 1)));
    expect((pack.json(COACH) as { interior: unknown[] }).interior).toEqual([old, { min: [2, 1, 0], max: [3, 3.5, 1] }]);
    journal.undo();
    journal.dispatch(setZoneNumber(COACH, pack.json(COACH), 0, 'max', 0, 2.5));
    expect((pack.json(COACH) as { interior: unknown[] }).interior).toEqual([{ min: [0, 1, 0], max: [2.5, 3.5, 1] }]);
    journal.undo();
    journal.dispatch(removeZone(COACH, pack.json(COACH), 0));
    expect(pack.json(COACH)).not.toHaveProperty('interior');
  });

  it('change nothing for a zone that is not there', () => {
    const json = { interior: [{ min: [0, 1, 0], max: [1, 2, 1] }] };
    expect(removeZone(COACH, json, 3).ops).toEqual([]);
    expect(moveZoneTo(COACH, json, 0, 1).ops).toEqual([]);
    expect(moveZoneTo(COACH, json, 0, 0).ops).toEqual([]);
    expect(setZoneNumber(COACH, json, 2, 'min', 0, 1).ops).toEqual([]);
    expect(setZoneHeight(COACH, json, 2, 1).ops).toEqual([]);
    expect(setZone(COACH, json, 5, zoneOver({ minX: 0, minZ: 0, maxX: 1, maxZ: 1 }, 0)).ops).toEqual([]);
  });
});
