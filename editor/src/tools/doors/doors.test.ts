import { describe, expect, it } from 'vitest';
import { checkPack } from '../../checks/pack';
import { exampleModel } from '../../model/testing.node';
import { openExamplePack } from '../testing.node';
import {
  addDoor,
  boxOfObjects,
  doorLink,
  doorOf,
  doorsOf,
  freshDoorId,
  idTaken,
  moveDoorTo,
  removeDoor,
  renameDoor,
  selectedDoors,
  selectedObjects,
  setDoorBox,
  setDoorFlag,
  setDoorGroup,
  setDoorId,
  setDoorNumber,
} from './doors';

const FILE = 'data/rwat_example/wagon_types/coach.json';
const MODEL = 'assets/rwat_example/wagon_models/coach.json';
const COACH = 'rwat_example:coach';
const BOX = { minX: 0, minY: 1, minZ: 1.4, maxX: 1, maxY: 3, maxZ: 1.46 };

async function coach() {
  const { pack, journal } = await openExamplePack();
  const json = () => pack.json(FILE) as { doors?: Record<string, unknown>[] };
  return { pack, journal, json };
}

describe('the doors of a type’s file', () => {
  it('are read in the file’s order, with flags, a group and a box; what cannot be read is null', async () => {
    const { json } = await coach();
    const doors = doorsOf(json());
    expect(doors).toHaveLength(8);
    expect(doors[0]).toEqual({ id: 'door_fl', box: { minX: -9.25, minY: 1.15, minZ: 1.45, maxX: -8.25, maxY: 3.3, maxZ: 1.51 }, connecting: false, inner: false, fixed: false, group: 'DoorsL' });
    expect(doors[7]).toMatchObject({ id: 'salon_arch', inner: true, fixed: true, connecting: false, group: null });
    expect(doors[4]).toMatchObject({ id: 'gangway_front', connecting: true });
    expect(doorOf({ id: 7, min: [0, 0], max: [1, 1, 1], group: null, inner: 'yes' })).toEqual({ id: null, box: null, connecting: false, inner: false, fixed: false, group: null });
    expect(doorsOf({})).toEqual([]);
    expect(doorsOf({ doors: {} })).toEqual([]);
  });

  it('give fresh ids and say which are taken, case aside', async () => {
    const { json } = await coach();
    expect(freshDoorId(json())).toBe('door_8');
    expect(freshDoorId({ doors: [{ id: 'DOOR_1' }, {}] })).toBe('door_2');
    expect(freshDoorId({ doors: [{ id: 'Door_2' }, {}] })).toBe('door_3');
    expect(idTaken(json(), 'SALON_DOOR')).toBe(true);
    expect(idTaken(json(), 'salon_door', 6)).toBe(false);
    expect(idTaken(json(), 'nope')).toBe(false);
  });

  it('are picked out of the selection by wagon, and objects by model', () => {
    const selection = [doorLink(COACH, 2), doorLink('x:y', 1), { kind: 'object', model: COACH, name: 'DOOR_1_HANDLE' } as const, doorLink(COACH, 0)];
    expect(selectedDoors(selection, COACH)).toEqual([2, 0]);
    expect(selectedObjects(selection, COACH)).toEqual(['DOOR_1_HANDLE']);
    expect(selectedObjects(selection, 'x:y')).toEqual([]);
  });
});

describe('a door from objects of the model', () => {
  it('is the box around them, as the OBJ writes its numbers', async () => {
    const model = await exampleModel('coach');
    expect(boxOfObjects(model, ['GUIDE_DOORWAY_DOOR_FL'])).toEqual({ minX: -9.25, minY: 1.15, minZ: 1.45, maxX: -8.25, maxY: 3.3, maxZ: 1.51 });
    // a leaf and its handle: the handle stands out of the wall
    expect(boxOfObjects(model, ['DOOR_1_TL_0.95_X', 'DOOR_1_HANDLE'])).toEqual({ minX: -9.25, minY: 1.15, minZ: 1.45, maxX: -8.25, maxY: 3.3, maxZ: 1.55 });
    expect(boxOfObjects(model, ['NO_SUCH_OBJECT'])).toBeNull();
    expect(boxOfObjects(model, [])).toBeNull();
  });
});

describe('the commands of the doors', () => {
  it('add a door at the end, or make the list', async () => {
    const { journal, json } = await coach();
    const add = addDoor(FILE, json(), 'door_8', BOX);
    expect(add).toEqual({
      label: 'tools.doors.cmd.add',
      labelParams: { index: 8, id: 'door_8' },
      ops: [{ op: 'insert', file: FILE, at: '/doors/-', value: { id: 'door_8', min: [0, 1, 1.4], max: [1, 3, 1.46] } }],
    });
    journal.dispatch(add);
    expect(json().doors?.[8]).toEqual({ id: 'door_8', min: [0, 1, 1.4], max: [1, 3, 1.46] });
    expect(addDoor(FILE, {}, 'a', BOX, 'k')).toMatchObject({ ops: [{ op: 'set', at: '/doors', value: [{ id: 'a', min: [0, 1, 1.4], max: [1, 3, 1.46] }] }], coalesceKey: 'k' });
  });

  it('set a box by the corners that changed, and one number of it', async () => {
    const { journal, json } = await coach();
    const box = doorsOf(json())[0]?.box;
    if (box === null || box === undefined) throw new Error('no box');
    expect(setDoorBox(FILE, json(), 0, box).ops).toEqual([]);
    const moved = setDoorBox(FILE, json(), 0, { ...box, minZ: 0.95, maxZ: 1.01 }, { label: 'tools.doors.cmd.move', coalesceKey: 'k' });
    expect(moved).toEqual({
      label: 'tools.doors.cmd.move',
      labelParams: { index: 0 },
      coalesceKey: 'k',
      ops: [
        { op: 'set', file: FILE, at: '/doors/0/min', value: [-9.25, 1.15, 0.95] },
        { op: 'set', file: FILE, at: '/doors/0/max', value: [-8.25, 3.3, 1.01] },
      ],
    });
    journal.dispatch(setDoorNumber(FILE, json(), 0, 'max', 1, 3.25));
    expect(json().doors?.[0]?.max).toEqual([-8.25, 3.25, 1.51]);
    expect(setDoorNumber(FILE, json(), 99, 'max', 1, 3).ops).toEqual([]);
    expect(setDoorBox(FILE, json(), 99, box).ops).toEqual([]);
  });

  it('rename a door, refusing an empty id', async () => {
    const { journal, json } = await coach();
    expect(setDoorId(FILE, json(), 0, '').ops).toEqual([]);
    expect(setDoorId(FILE, json(), 0, 'door_fl').ops).toEqual([]);
    journal.dispatch(setDoorId(FILE, json(), 0, 'front_left'));
    expect(json().doors?.[0]?.id).toBe('front_left');
  });

  it('rename a door with its animation and sounds: one command over the type and the model, undone in one step to the files as they were', async () => {
    const { pack, journal, json } = await coach();
    const model = () => pack.json(MODEL) as { animations: Record<string, string>; sounds: { doors: Record<string, string> } };
    const texts = async () => [await pack.text(FILE), await pack.text(MODEL)];
    const before = await texts();
    const command = renameDoor(FILE, json(), MODEL, model(), 6, 'salon');
    expect(command.ops).toEqual([
      { op: 'set', file: FILE, at: '/doors/6/id', value: 'salon' },
      { op: 'remove', file: MODEL, at: '/animations/salon_door' },
      { op: 'set', file: MODEL, at: '/animations/salon', value: 'stock/coach/salon_door.anim' },
      { op: 'remove', file: MODEL, at: '/sounds/doors/salon_door' },
      { op: 'set', file: MODEL, at: '/sounds/doors/salon', value: 'minecraft:block.wooden_door.open' },
    ]);
    journal.dispatch(command);
    expect(journal.state().done).toHaveLength(1);
    expect(json().doors?.[6]?.id).toBe('salon');
    expect(model().animations).toEqual({ salon: 'stock/coach/salon_door.anim' });
    expect(model().sounds.doors).toHaveProperty('salon');
    expect(model().sounds.doors).not.toHaveProperty('salon_door');
    // the loader finds no key that names no door (ExamplePackLoadTest's "a door moved by nothing" is not made)
    expect(checkPack(pack, null).map((p) => p.code)).not.toContain('loader.door-key');
    journal.undo();
    expect(await texts()).toEqual(before);
  });

  it('rename a door leaving the model’s keys that still name a door, or that the new id has already', async () => {
    const { json } = await coach();
    const model = { animations: { salon_door: 'a.anim', SALON: 'b.anim' }, sounds: { doors: { DOOR_FL: 'x' } } };
    // the new id is a key already: that map stays
    expect(renameDoor(FILE, json(), MODEL, model, 6, 'salon').ops.filter((op) => op.file === MODEL)).toEqual([]);
    // the old id case aside: only the type's id changes
    expect(renameDoor(FILE, json(), MODEL, model, 0, 'Door_FL').ops).toEqual([{ op: 'set', file: FILE, at: '/doors/0/id', value: 'Door_FL' }]);
    // a key of another case is renamed all the same; no model, the type's id alone
    expect(renameDoor(FILE, json(), MODEL, model, 0, 'front_left').ops.slice(1)).toEqual([
      { op: 'remove', file: MODEL, at: '/sounds/doors/DOOR_FL' },
      { op: 'set', file: MODEL, at: '/sounds/doors/front_left', value: 'x' },
    ]);
    expect(renameDoor(FILE, json(), null, model, 0, 'front_left').ops).toHaveLength(1);
    // another door keeps the old id: its keys stay
    const twin = { ...(json() as object), doors: [...(json().doors ?? []), { id: 'door_fl', min: [0, 1, 1.4], max: [1, 3, 1.46] }] };
    expect(renameDoor(FILE, twin, MODEL, model, 0, 'front_left').ops).toHaveLength(1);
    expect(renameDoor(FILE, json(), MODEL, model, 0, '').ops).toEqual([]);
  });

  it('write a flag only while it is on, and a group only while it has a name', async () => {
    const { journal, json } = await coach();
    journal.dispatch(setDoorFlag(FILE, json(), 0, 'connecting', true));
    expect(json().doors?.[0]?.connecting).toBe(true);
    expect(setDoorFlag(FILE, json(), 0, 'connecting', true).ops).toEqual([]);
    journal.dispatch(setDoorFlag(FILE, json(), 0, 'connecting', false));
    expect(json().doors?.[0]).not.toHaveProperty('connecting');
    expect(setDoorFlag(FILE, json(), 0, 'inner', false).ops).toEqual([]);
    // a flag written false is taken out when turned off
    expect(setDoorFlag(FILE, { doors: [{ id: 'a', inner: false }] }, 0, 'inner', false).ops).toEqual([{ op: 'remove', file: FILE, at: '/doors/0/inner' }]);

    journal.dispatch(setDoorGroup(FILE, json(), 0, 'Left'));
    expect(json().doors?.[0]?.group).toBe('Left');
    journal.dispatch(setDoorGroup(FILE, json(), 0, ''));
    expect(json().doors?.[0]).not.toHaveProperty('group');
    expect(setDoorGroup(FILE, json(), 4, '').ops).toEqual([]);
    // the old null of a door on its own goes too
    expect(setDoorGroup(FILE, { doors: [{ id: 'a', group: null }] }, 0, '').ops).toEqual([{ op: 'remove', file: FILE, at: '/doors/0/group' }]);
  });

  it('remove a door, the last one with the list, and move a door in it', async () => {
    const { journal, json } = await coach();
    journal.dispatch(moveDoorTo(FILE, json(), 6, 0));
    expect(doorsOf(json()).map((d) => d.id)).toEqual(['salon_door', 'door_fl', 'door_fr', 'door_rl', 'door_rr', 'gangway_front', 'gangway_rear', 'salon_arch']);
    expect(moveDoorTo(FILE, json(), 0, 0).ops).toEqual([]);
    expect(moveDoorTo(FILE, json(), 0, 8).ops).toEqual([]);
    journal.dispatch(removeDoor(FILE, json(), 0));
    expect(doorsOf(json())).toHaveLength(7);
    expect(removeDoor(FILE, json(), 7).ops).toEqual([]);
    expect(removeDoor(FILE, { doors: [{ id: 'a' }] }, 0).ops).toEqual([{ op: 'remove', file: FILE, at: '/doors' }]);
  });
});
