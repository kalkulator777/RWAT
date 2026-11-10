/**
 * The edits of a type's override: the three states of a field, doors by id, the floor
 * generator's options, names and sway — each through the journal, undone byte for byte,
 * and each landing in the result as the converter merges it (./merge.ts, golden-checked).
 */

import { describe, expect, it } from 'vitest';
import { addDoor, doorForm, doorRows, doorsAsList, doorsAsObject, removeDoor, resetDoor, setDoorField } from './doors';
import { canRemove, fieldState, removeField, resetField, setField } from './fields';
import { floorAsDerived, floorStatus, resetFloorOption, setFloorOption, turnFloorOff, turnFloorOn } from './floor';
import { fieldView, typeLayers } from './layers';
import { effectiveOverride, mergeOverride } from './merge';
import { resetLightName, resetName, resetSway, setLightName, setName, setSway } from './names';
import { COACH, FLOOR, type Opened, openRecipe, RECIPE } from './testing.node';
import { RecipeError } from './workspace';

const PER = 'packs/r/coach.json';
const decoder = new TextDecoder();

function recipe(extra: object = {}): object {
  return { namespace: 'ns', pack_dir: 'P', sources: [{ zip: '../ir.zip', root: 'stock' }], overrides_dir: 'r', ...extra };
}

/** Opens a recipe with the coach's per-type file (or none) and remembers every file's text as opened. */
async function open(override?: object | string, extra: object = {}): Promise<Opened & { before: Map<string, string> }> {
  const files: Record<string, string | object> = { [RECIPE]: recipe(extra) };
  if (override !== undefined) files[PER] = override;
  const opened = await openRecipe(files);
  const before = new Map<string, string>();
  for (const path of opened.workspace.paths()) before.set(path, await opened.workspace.text(path));
  return { ...opened, before };
}

/** After undoing everything, the files are as opened: the same paths, the same bytes, nothing to save. */
async function undoneAll(o: Opened & { before: Map<string, string> }): Promise<void> {
  while (o.journal.undo() !== null);
  expect(o.workspace.paths()).toEqual([...o.before.keys()]);
  for (const [path, text] of o.before) expect(await o.workspace.text(path), path).toBe(text);
  expect(o.workspace.dirtyPaths()).toEqual([]);
}

const layersOf = (o: Opened): ReturnType<typeof typeLayers> => typeLayers(o.workspace, 'coach', COACH, FLOOR);
const resultOf = (o: Opened): ReturnType<typeof mergeOverride> => layersOf(o).result;

describe('the three states of a field', () => {
  it('not set, set, removed — by the field itself or an ancestor', () => {
    const file = { type: { mass_t: 41, max_speed_kmh: null, bogies: [1, -1], brakes: null, cab: 5 } };
    expect(fieldState(file, '/type/length')).toEqual({ state: 'derived' });
    expect(fieldState(undefined, '/type/length')).toEqual({ state: 'derived' });
    expect(fieldState(file, '/type/mass_t')).toEqual({ state: 'set', at: '/type/mass_t', value: 41 });
    expect(fieldState(file, '/type/max_speed_kmh')).toEqual({ state: 'removed', at: '/type/max_speed_kmh' });
    expect(fieldState(file, '/type/brakes/parking_kn')).toEqual({ state: 'removed', at: '/type/brakes' });
    expect(fieldState(file, '/type/bogies/0')).toEqual({ state: 'set', at: '/type/bogies', value: [1, -1] });
    expect(fieldState(file, '/type/cab/seats')).toEqual({ state: 'set', at: '/type/cab', value: 5 });
    expect(() => fieldState(file, '/type/_why')).toThrow(RecipeError);
    expect(() => fieldState(file, '/doors')).toThrow(RecipeError);
  });

  it('null is refused where the converter takes it as "not given" or cannot take it', () => {
    expect(canRemove('/type/mass_t')).toBe(true);
    expect(canRemove('/model/handbrake')).toBe(true);
    expect(canRemove('/type/doors/0')).toBe(true);
    for (const pointer of ['/type', '/model', '/floor', '/sway', '/type/doors', '/type/interior', '/name/ru_ru', '/lights/IL/en_us', '/floor/level']) {
      expect(canRemove(pointer), pointer).toBe(false);
    }
  });

  it('set, remove and reset: one line each, the result follows, undo gives the text back', async () => {
    const o = await open({ name: { ru_ru: 'Вагон' } });
    const base = layersOf(o).base;
    await o.run(setField(o.workspace, 'coach', '/type/mass_t', 42.5, { base }));
    expect(resultOf(o).type.mass_t).toBe(42.5);
    expect(fieldView(layersOf(o), '/type/mass_t')).toEqual({ state: { state: 'set', at: '/type/mass_t', value: 42.5 }, derived: 40, value: 42.5 });
    await o.run(removeField(o.workspace, 'coach', '/type/max_speed_kmh'));
    expect(resultOf(o).type).not.toHaveProperty('max_speed_kmh');
    expect(fieldView(layersOf(o), '/type/max_speed_kmh')).toMatchObject({ state: { state: 'removed' }, derived: 120, value: undefined });
    await o.run(setField(o.workspace, 'coach', '/type/brakes/parking_kn', 25, { base }));
    expect(resultOf(o).type.brakes).toEqual({ system: 'passenger', parking_kn: 25 });
    expect(await o.workspace.text(PER)).toBe(
      '{\n  "name": {\n    "ru_ru": "Вагон"\n  },\n  "type": {\n    "mass_t": 42.5,\n    "max_speed_kmh": null,\n    "brakes": {\n      "parking_kn": 25\n    }\n  }\n}\n',
    );
    await o.run(resetField(o.workspace, 'coach', '/type/brakes/parking_kn'));
    await o.run(resetField(o.workspace, 'coach', '/type/max_speed_kmh'));
    expect(o.workspace.override('coach')).toEqual({ name: { ru_ru: 'Вагон' }, type: { mass_t: 42.5 } });
    await undoneAll(o);
  });

  it('a value equal to the derived one is a reset, unless pinned; the value the file has is no op', async () => {
    const o = await open({ type: { mass_t: 41 } });
    const base = layersOf(o).base;
    expect(setField(o.workspace, 'coach', '/type/length', 20, { base }).ops).toEqual([]);
    await o.run(setField(o.workspace, 'coach', '/type/mass_t', 40, { base }));
    expect(o.workspace.has(PER)).toBe(false); // the file had nothing else: it goes
    await o.run(setField(o.workspace, 'coach', '/type/mass_t', 40, { base, pin: true }));
    expect(o.workspace.override('coach')).toEqual({ type: { mass_t: 40 } });
    expect(setField(o.workspace, 'coach', '/type/mass_t', 40, { base, pin: true }).ops).toEqual([]);
    await undoneAll(o);
  });

  it('a place inside an array writes the array whole: the file own, else the derived one', async () => {
    const o = await open({ type: {} });
    const base = layersOf(o).base;
    await o.run(setField(o.workspace, 'coach', '/type/bogies/1', -6.5, { base }));
    expect(o.workspace.override('coach')).toEqual({ type: { bogies: [7, -6.5] } });
    await o.run(setField(o.workspace, 'coach', '/type/bogies/0', 6.5, { base }));
    expect(o.workspace.override('coach')).toEqual({ type: { bogies: [6.5, -6.5] } });
    await o.run(setField(o.workspace, 'coach', '/type/interior/0/min/1', 1.0, { base }));
    expect((o.workspace.override('coach')?.type as { interior: unknown }).interior).toEqual([{ min: [-5, 1.0, -1.4], max: [5, 3.4, 1.4] }]);
    expect(() => setField(o.workspace, 'coach', '/type/doors/0/inner', true, { base })).toThrow(RecipeError);
    expect(() => setField(o.workspace, 'coach', '/type/bogies/5', 1, { base })).toThrow(RecipeError);
    await undoneAll(o);
  });

  it('a set under a scalar or null of the file replaces it by the objects on the way; a removed field stays removed', async () => {
    const o = await open({ type: { brakes: null } });
    expect(removeField(o.workspace, 'coach', '/type/brakes/parking_kn').ops).toEqual([]);
    await o.run(setField(o.workspace, 'coach', '/type/brakes/parking_kn', 20));
    expect(o.workspace.override('coach')).toEqual({ type: { brakes: { parking_kn: 20 } } });
    expect(() => removeField(o.workspace, 'coach', '/type/doors')).toThrow(RecipeError);
    await undoneAll(o);
  });

  it('a reset takes out what it leaves empty, but not an object of comments, nor floor', async () => {
    const o = await open({ _about: 'kept', type: { brakes: { parking_kn: 20 }, cab: { _why: 'a note', seat_yaw: 90 } }, floor: { level: 1 } });
    await o.run(resetField(o.workspace, 'coach', '/type/brakes/parking_kn'));
    expect(o.workspace.override('coach')).toEqual({ _about: 'kept', type: { cab: { _why: 'a note', seat_yaw: 90 } }, floor: { level: 1 } });
    await o.run(resetField(o.workspace, 'coach', '/type/cab/seat_yaw'));
    expect(o.workspace.override('coach')).toEqual({ _about: 'kept', type: { cab: { _why: 'a note' } }, floor: { level: 1 } });
    await o.run(resetField(o.workspace, 'coach', '/floor/level'));
    expect(o.workspace.override('coach')?.floor).toEqual({});
    expect(resetField(o.workspace, 'coach', '/type/length').ops).toEqual([]);
    await undoneAll(o);
  });

  it('comments stay byte for byte through any edit, and never reach the result', async () => {
    const text = '{\n  "_about": "per-type file",\n  "type": {\n    "_why": "IR is light",\n    "mass_t": 41.0,\n    "brakes": {"_c": 1, "parking_kn": 20.0}\n  }\n}\n';
    const o = await open(text);
    await o.run(setField(o.workspace, 'coach', '/type/brakes/parking_kn', 22.0));
    await o.run(setField(o.workspace, 'coach', '/sway', 1.5));
    expect(await o.workspace.text(PER)).toBe(text.replace('"parking_kn": 20.0', '"parking_kn": 22.0').replace('\n  }\n}', '\n  },\n  "sway": 1.5\n}'));
    const result = resultOf(o);
    expect(JSON.stringify(result)).not.toMatch(/"_/);
    expect(result.type.brakes).toEqual({ system: 'passenger', parking_kn: 22 });
    await undoneAll(o);
  });
});

describe('the per-type file', () => {
  it('is created by the first edit of a type, dumped as the tools write files, and deleted when it empties', async () => {
    const o = await open();
    expect(o.workspace.override('coach')).toBeUndefined();
    await o.run(setField(o.workspace, 'coach', '/type/brakes/parking_kn', 25.0));
    expect(o.workspace.status(PER)).toBe('new');
    expect(await o.workspace.text(PER)).toBe('{\n  "type": {\n    "brakes": {\n      "parking_kn": 25.0\n    }\n  }\n}\n'.replace('25.0', '25'));
    await o.run(resetField(o.workspace, 'coach', '/type/brakes/parking_kn'));
    expect(o.workspace.has(PER)).toBe(false);
    expect(o.workspace.dirtyPaths()).toEqual([]);
    await undoneAll(o);
  });

  it('gives a recipe without overrides_dir one, named as the recipe, in the same command', async () => {
    const o = await openRecipe({ [RECIPE]: { namespace: 'ns', pack_dir: 'P', sources: [] } });
    const command = setField(o.workspace, 'coach', '/sway', 1);
    expect(command.ops.map((op) => [op.op, op.file])).toEqual([
      ['set', RECIPE],
      ['putFile', PER],
    ]);
    await o.run(command);
    expect(o.workspace.recipe().overrides_dir).toBe('r');
    expect(o.workspace.overrideIds()).toEqual(['coach']);
    o.journal.undo();
    expect(o.workspace.recipe()).not.toHaveProperty('overrides_dir');
    expect(o.workspace.dirtyPaths()).toEqual([]);
  });

  it('is refused where the recipe names a folder outside the one opened', async () => {
    const o = await openRecipe({ [RECIPE]: recipe({ overrides_dir: '../../elsewhere' }) });
    expect(() => setField(o.workspace, 'coach', '/sway', 1)).toThrow(RecipeError);
    expect(o.workspace.problems().map((p) => p.code)).toEqual(['recipe.overrides-outside']);
  });
});

describe('doors by id', () => {
  it('an edit of one door writes the object form by id, only what differs; back to derived takes it out', async () => {
    const o = await open();
    await o.run(setDoorField(o.workspace, 'coach', 'door_1', 'connecting', true, COACH.doors));
    expect(o.workspace.override('coach')).toEqual({ type: { doors: { DOOR_1: { connecting: true } } } });
    await o.run(setDoorField(o.workspace, 'coach', 'DOOR_3', 'inner', null, COACH.doors));
    expect(doorForm(o.workspace.override('coach'))).toBe('object');
    expect(resultOf(o).type.doors).toEqual([
      { id: 'DOOR_1', min: [-1.0, 0.9, 1.35], max: [0.0, 3.0, 1.45], connecting: true },
      { id: 'DOOR_3', min: [-4.0, 0.9, -1.45], max: [-3.0, 3.0, -1.35] },
    ]);
    expect(setDoorField(o.workspace, 'coach', 'Door_1', 'connecting', true, COACH.doors).ops).toEqual([]);
    await o.run(setDoorField(o.workspace, 'coach', 'DOOR_3', 'inner', true, COACH.doors));
    await o.run(setDoorField(o.workspace, 'coach', 'door_1', 'connecting', null, COACH.doors));
    expect(o.workspace.has(PER)).toBe(false);
    await undoneAll(o);
  });

  it('a key written in another case is the one edited', async () => {
    const o = await open({ type: { doors: { door_1: { connecting: true } } } });
    await o.run(setDoorField(o.workspace, 'coach', 'DOOR_1', 'fixed', true, COACH.doors));
    expect(o.workspace.override('coach')).toEqual({ type: { doors: { door_1: { connecting: true, fixed: true } } } });
    await undoneAll(o);
  });

  it('adds a door the model hasn’t, removes a derived one by null and an added one by its key', async () => {
    const o = await open();
    const gangway = { id: 'Gangway', min: [2.0, 0.9, 1.35], max: [3.0, 3.0, 1.45] };
    await o.run(addDoor(o.workspace, 'coach', gangway, COACH.doors));
    await o.run(removeDoor(o.workspace, 'coach', 'door_3', COACH.doors));
    expect(o.workspace.override('coach')).toEqual({ type: { doors: { Gangway: { min: [2.0, 0.9, 1.35], max: [3.0, 3.0, 1.45] }, DOOR_3: null } } });
    expect(doorRows(COACH.doors, o.workspace.override('coach')).map((row) => [row.id, row.origin])).toEqual([
      ['DOOR_1', 'derived'],
      ['DOOR_3', 'removed'],
      ['Gangway', 'added'],
    ]);
    const result = resultOf(o);
    expect((result.type.doors as { id: string }[]).map((door) => door.id)).toEqual(['DOOR_1', 'Gangway']);
    expect(result.model.animations).toEqual({ door_1: 'stock/car/door1.anim' });
    expect(() => addDoor(o.workspace, 'coach', gangway, COACH.doors)).toThrow(RecipeError);
    expect(() => addDoor(o.workspace, 'coach', { id: '_x' }, COACH.doors)).toThrow(RecipeError);
    // a removed door comes back with an edit, or as it was
    await o.run(setDoorField(o.workspace, 'coach', 'DOOR_3', 'fixed', true, COACH.doors));
    expect((o.workspace.override('coach')?.type as { doors: object }).doors).toMatchObject({ DOOR_3: { fixed: true } });
    await o.run(resetDoor(o.workspace, 'coach', 'door_3'));
    await o.run(removeDoor(o.workspace, 'coach', 'Gangway', COACH.doors));
    expect(o.workspace.has(PER)).toBe(false);
    expect(removeDoor(o.workspace, 'coach', 'nothing', COACH.doors).ops).toEqual([]);
    await undoneAll(o);
  });

  it('a door that is derived and removed can be added again, as given', async () => {
    const o = await open({ type: { doors: { DOOR_3: null } } });
    await o.run(addDoor(o.workspace, 'coach', { id: 'DOOR_3', min: [-4.0, 0.9, -1.45], max: [-3.0, 3.1, -1.35] }, COACH.doors));
    expect(o.workspace.override('coach')).toEqual({ type: { doors: { DOOR_3: { max: [-3.0, 3.1, -1.35], inner: null } } } });
    expect((resultOf(o).type.doors as object[])[1]).toEqual({ id: 'DOOR_3', min: [-4.0, 0.9, -1.45], max: [-3.0, 3.1, -1.35] });
    await undoneAll(o);
  });

  it('the list form is edited in its list', async () => {
    const o = await open({ type: { doors: [{ id: 'DOOR_3', min: [-4, 0.9, -1.45], max: [-3, 3, -1.35] }] } });
    await o.run(setDoorField(o.workspace, 'coach', 'door_3', 'inner', true, COACH.doors));
    await o.run(addDoor(o.workspace, 'coach', { id: 'Gangway', min: [2, 0.9, 1.35], max: [3, 3, 1.45] }, COACH.doors));
    await o.run(setDoorField(o.workspace, 'coach', 'DOOR_3', 'inner', null, COACH.doors));
    expect(doorRows(COACH.doors, o.workspace.override('coach')).map((row) => [row.id, row.origin])).toEqual([
      ['DOOR_3', 'listed'],
      ['Gangway', 'listed'],
      ['DOOR_1', 'removed'],
    ]);
    await o.run(removeDoor(o.workspace, 'coach', 'DOOR_3', COACH.doors));
    await o.run(removeDoor(o.workspace, 'coach', 'Gangway', COACH.doors));
    expect(o.workspace.override('coach')).toEqual({ type: { doors: [] } }); // an empty list turns the doors off: kept
    expect(() => setDoorField(o.workspace, 'coach', 'Gangway', 'inner', true, COACH.doors)).toThrow(RecipeError);
    await undoneAll(o);
  });

  it('list and object convert into each other without changing the doors the type gets', async () => {
    const o = await open({
      type: { doors: { door_1: { connecting: true, _c: 'gangway end' }, DOOR_3: null, Gangway: { min: [2, 0.9, 1.35], max: [3, 3, 1.45] }, _note: 'doors' } },
    });
    const before = resultOf(o);
    await o.run(doorsAsList(o.workspace, 'coach', COACH.doors));
    expect(doorForm(o.workspace.override('coach'))).toBe('list');
    expect(o.workspace.override('coach')).toEqual({
      type: {
        doors: [
          { id: 'DOOR_1', min: [-1.0, 0.9, 1.35], max: [0.0, 3.0, 1.45], connecting: true, _c: 'gangway end' },
          { id: 'Gangway', min: [2, 0.9, 1.35], max: [3, 3, 1.45] },
        ],
        _note: 'doors',
      },
    });
    expect(resultOf(o)).toEqual(before);
    await o.run(doorsAsObject(o.workspace, 'coach', COACH.doors));
    expect((o.workspace.override('coach')?.type as { doors: object }).doors).toEqual({ DOOR_1: { _c: 'gangway end', connecting: true }, DOOR_3: null, Gangway: { min: [2, 0.9, 1.35], max: [3, 3, 1.45] } });
    expect(resultOf(o)).toEqual(before);
    await undoneAll(o);
  });

  it('a list the object form can’t give in its order is refused, not changed', async () => {
    const o = await open({ type: { doors: [COACH.doors[1], COACH.doors[0]] } });
    expect(() => doorsAsObject(o.workspace, 'coach', COACH.doors)).toThrow(/order/);
    const twice = await open({ type: { doors: [COACH.doors[0], COACH.doors[0]] } });
    expect(() => doorsAsObject(twice.workspace, 'coach', COACH.doors)).toThrow(/twice/);
    const same = await open({ type: { doors: [...COACH.doors] } });
    await same.run(doorsAsObject(same.workspace, 'coach', COACH.doors));
    expect(same.workspace.has(PER)).toBe(false); // the derived doors as they are: nothing left to say
  });
});

describe('the floor', () => {
  it('says whether the generator runs, with which options, and whether a hand-made floor wins', () => {
    expect(floorStatus('passenger', {})).toEqual({ mode: 'default', runs: true, options: {}, handInterior: false });
    expect(floorStatus('freight', {})).toEqual({ mode: 'default', runs: false, options: null, handInterior: false });
    expect(floorStatus('freight', { floor: {} })).toMatchObject({ mode: 'options', runs: true, options: {} });
    expect(floorStatus('passenger', { floor: false })).toMatchObject({ mode: 'off', runs: false, options: null });
    expect(floorStatus('passenger', { floor: { level: 1, _c: 'x' } }).options).toEqual({ level: 1 });
    expect(floorStatus('passenger', effectiveOverride({ type: { interior: [] } }, { floor: null })).handInterior).toBe(true);
  });

  it('options over false, reset by option, on and off — {} kept where it keeps the generator on', async () => {
    const o = await open({ floor: false });
    await o.run(setFloorOption(o.workspace, 'coach', 'level', 1.2));
    expect(o.workspace.override('coach')).toEqual({ floor: { level: 1.2 } });
    await o.run(resetFloorOption(o.workspace, 'coach', 'level', 'passenger'));
    expect(o.workspace.has(PER)).toBe(false);
    await o.run(turnFloorOn(o.workspace, 'coach', 'freight'));
    expect(o.workspace.override('coach')).toEqual({ floor: {} });
    await o.run(setFloorOption(o.workspace, 'coach', 'cell', 0.125));
    await o.run(resetFloorOption(o.workspace, 'coach', 'cell', 'freight'));
    expect(o.workspace.override('coach')).toEqual({ floor: {} });
    expect(turnFloorOn(o.workspace, 'coach', 'freight').ops).toEqual([]);
    await o.run(turnFloorOff(o.workspace, 'coach'));
    expect(turnFloorOff(o.workspace, 'coach').ops).toEqual([]);
    expect(resultOf(o).type.interior).toEqual(COACH.interior); // IR's passenger area
    await o.run(turnFloorOn(o.workspace, 'coach', 'passenger'));
    expect(o.workspace.has(PER)).toBe(false);
    expect(resultOf(o).type.interior).toEqual(FLOOR);
    await o.run(setFloorOption(o.workspace, 'coach', 'level', 1.0));
    await o.run(floorAsDerived(o.workspace, 'coach'));
    expect(o.workspace.has(PER)).toBe(false);
    expect(() => setFloorOption(o.workspace, 'coach', 'height', 1)).toThrow(RecipeError);
    await undoneAll(o);
  });
});

describe('names, lights and sway', () => {
  it('go to the override (never a lang file) and to the result’s lang entries', async () => {
    const o = await open();
    const base = layersOf(o).base;
    expect(setName(o.workspace, 'coach', 'en_us', 'Test Coach', { base }).ops).toEqual([]); // the IR name already
    await o.run(setName(o.workspace, 'coach', 'ru_ru', 'Вагон', { base }));
    await o.run(setLightName(o.workspace, 'coach', 'IL', 'ru_ru', 'Свет в вагоне', { base }));
    await o.run(setSway(o.workspace, 'coach', 1.5, { base }));
    expect(o.workspace.paths()).toEqual([RECIPE, PER]);
    expect(resultOf(o).lang).toEqual({ en_us: { 'wagon.ns.coach': 'Test Coach' }, ru_ru: { 'wagon.ns.coach': 'Вагон', 'light.ns.coach.IL': 'Свет в вагоне' } });
    expect(resultOf(o).model.sway).toBe(1.5);
    const layers = layersOf(o);
    expect(fieldView(layers, '/name/ru_ru')).toEqual({ state: { state: 'set', at: '/name/ru_ru', value: 'Вагон' }, derived: undefined, value: 'Вагон' });
    expect(fieldView(layers, '/name/en_us')).toEqual({ state: { state: 'derived' }, derived: 'Test Coach', value: 'Test Coach' });
    expect(fieldView(layers, '/name')).toMatchObject({ value: { en_us: 'Test Coach', ru_ru: 'Вагон' } });
    expect(fieldView(layers, '/lights/IL/ru_ru').value).toBe('Свет в вагоне');
    expect(fieldView(layers, '/lights/IL').value).toEqual({ ru_ru: 'Свет в вагоне' });
    expect(fieldView(layers, '/sway').value).toBe(1.5);
    expect(fieldView(layers, '/model/sway').value).toBe(1.5);
    await o.run(resetName(o.workspace, 'coach', 'ru_ru'));
    await o.run(resetLightName(o.workspace, 'coach', 'IL', 'ru_ru'));
    await o.run(resetSway(o.workspace, 'coach'));
    expect(o.workspace.has(PER)).toBe(false);
    await undoneAll(o);
  });

  it('the derived layer has the recipe’s inline override, the result the file over it', async () => {
    const o = await open({ type: { mass_t: null } }, { overrides: { coach: { type: { mass_t: 30, max_speed_kmh: 100 }, name: { ru_ru: 'Старое' }, sway: 2 } } });
    const layers = layersOf(o);
    expect(layers.base).toMatchObject({ name: { en_us: 'Test Coach', ru_ru: 'Старое' }, sway: 2, type: { mass_t: 30, max_speed_kmh: 100 } });
    expect(fieldView(layers, '/type/mass_t')).toEqual({ state: { state: 'removed', at: '/type/mass_t' }, derived: 30, value: undefined });
    expect(fieldView(layers, '/type/max_speed_kmh')).toEqual({ state: { state: 'derived' }, derived: 100, value: 100 });
    expect(o.workspace.inline('coach')).toMatchObject({ sway: 2 });
    expect(o.workspace.inline('other')).toBeUndefined();
  });
});

describe('a per-type file whose text is no JSON', () => {
  it('opens, with a problem, and is not edited as if it were empty', async () => {
    const o = await open('{"type": ');
    expect(o.workspace.problems().map((p) => p.code)).toEqual(['pack.broken-json']);
    expect(o.workspace.override('coach')).toBeUndefined();
    expect(() => setField(o.workspace, 'coach', '/sway', 1)).toThrow(/mend its text/);
    expect(() => addDoor(o.workspace, 'coach', { id: 'X' }, COACH.doors)).toThrow(RecipeError);
    expect(decoder.decode(await o.workspace.bytes(PER))).toBe('{"type": ');
  });
});
