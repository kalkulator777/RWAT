import { describe, expect, it } from 'vitest';
import { Journal } from '../../core/journal';
import { dump } from '../../core/json';
import { Pack } from '../../core/pack';
import { filesOf, MemorySource, readTree } from '../../core/pack/testing.node';
import type { LoadedModel } from '../../core/contracts';
import { ENGINE_PITCH, FALLBACK_WHEELS, WHEELS_VOLUME } from '../../audio/levels';
import { EXAMPLE_PACK } from '../../testing/repo.node';
import {
  addControl,
  clackAt,
  controlRows,
  doorRows,
  effectiveRanges,
  loopDecl,
  loopLevels,
  refState,
  refText,
  removeAt,
  setRef,
  subjectOf,
  suggestedControls,
  toObject,
} from './model';

const MODEL = 'assets/ns/wagon_models/loco.json';
const TYPE = 'data/ns/wagon_types/loco.json';

async function example(): Promise<Pack> {
  return Pack.open(new MemorySource(readTree(EXAMPLE_PACK)));
}

async function packWith(sounds: unknown, extra: Record<string, string | Uint8Array> = {}): Promise<Pack> {
  return Pack.open(
    new MemorySource(
      filesOf({
        'pack.mcmeta': dump({ pack: { pack_format: 34, description: 'x' }, rwat: { format: 1 } }),
        [TYPE]: dump({ length: 10, bogies: [2, -2], mass_t: 40, doors: [{ id: 'Door_L', min: [0, 0, 0], max: [1, 1, 1] }, { id: 'door_r', min: [0, 0, 0], max: [1, 1, 1] }] }),
        [MODEL]: dump({ obj: 'x.obj', sounds }),
        'assets/ns/x.obj': '',
        'assets/ns/sounds/idle.ogg': new Uint8Array([1]),
        'assets/other/sounds/horn.ogg': new Uint8Array([2]),
        ...extra,
      }),
    ),
  );
}

describe('the subject of the tab', () => {
  it('is the open wagon’s model with its type’s door ids and the pack’s Ogg files', async () => {
    const pack = await packWith({ idle: 'sounds/idle.ogg' });
    const subject = subjectOf(pack, 'ns:loco');
    expect(subject).toMatchObject({ wagon: 'ns:loco', modelFile: MODEL, typeFile: TYPE, declaring: 'ns', doors: ['Door_L', 'door_r'] });
    expect(subject?.files).toEqual(['assets/ns/sounds/idle.ogg', 'assets/other/sounds/horn.ogg']);
    expect(subject?.sounds).toEqual({ idle: 'sounds/idle.ogg' });
  });

  it('is none for no wagon, a wagon the pack lacks, or a type without a model', async () => {
    const pack = await packWith({});
    expect(subjectOf(pack, null)).toBeNull();
    expect(subjectOf(pack, 'ns:other')).toBeNull();
    const typeOnly = await Pack.open(new MemorySource(filesOf({ 'pack.mcmeta': dump({ rwat: { format: 1 } }), [TYPE]: dump({ length: 10, bogies: [2, -2], mass_t: 40 }) })));
    expect(subjectOf(typeOnly, 'ns:loco')).toBeNull();
  });

  it('shows the shunter of the example pack its engine, horn, whistle, wheels, joint and handles', async () => {
    const subject = subjectOf(await example(), 'rwat_example:shunter');
    expect(Object.keys(subject?.sounds ?? {})).toEqual(['idle', 'horn', 'bell', 'wheels', 'clack', 'controls']);
    const idle = loopDecl(subject?.sounds?.idle);
    expect(idle).toMatchObject({ form: 'object', start: 'minecraft:block.beacon.activate', main: 'minecraft:block.beacon.ambient', stop: 'minecraft:block.beacon.deactivate', pitch: [0.6, 1.1], volume: [0.5, 1] });
    expect(loopDecl(subject?.sounds?.bell)).toMatchObject({ form: 'string', main: 'minecraft:block.note_block.flute', pitch: null });
    expect(loopDecl(subject?.sounds?.nothing)).toEqual({ form: 'absent', pitch: null, volume: null });
    expect(controlRows(subject as NonNullable<typeof subject>, null).map((row) => [row.key, row.verdict.verdict, row.move !== null, row.engage !== null])).toEqual([
      ['THROTTLE_1', 'plays', true, false],
      ['REVERSER_1', 'plays', true, false],
      ['TRAIN_BRAKE_1', 'plays', true, true],
      ['IND_BRAKE_1', 'plays', false, true],
      ['WIDGET_1', 'silent', true, false],
    ]);
  });

  it('shows the coach of the example pack a row for every door of its type, the arch without a sound of its own', async () => {
    const subject = subjectOf(await example(), 'rwat_example:coach') as NonNullable<ReturnType<typeof subjectOf>>;
    const rows = doorRows(subject);
    expect(rows.map((row) => row.id)).toEqual(subject.doors);
    expect(rows.map((row) => row.id)).toContain('salon_door');
    expect(rows.filter((row) => row.ref === null).map((row) => row.id)).toEqual(['salon_arch']);
    expect(rows.find((row) => row.id === 'salon_door')).toMatchObject({ key: 'salon_door', ref: 'minecraft:block.wooden_door.open' });
  });
});

describe('what the engine reads of a loop', () => {
  it('is the pack’s range, else the engine’s default, and a minecart for wheels with no key', () => {
    expect(effectiveRanges('idle', loopDecl({ main: 'a.ogg', pitch: [0.6, 1.1] }))).toEqual({ pitch: [0.6, 1.1], volume: [Math.fround(0.6), 1], pitchDeclared: true, volumeDeclared: false });
    expect(effectiveRanges('idle', loopDecl('a.ogg')).pitch).toBe(ENGINE_PITCH);
    expect(effectiveRanges('wheels', loopDecl('a.ogg')).volume).toBe(WHEELS_VOLUME);
    expect(effectiveRanges('wheels', loopDecl(undefined))).toMatchObject({ pitch: FALLBACK_WHEELS.pitch, volume: FALLBACK_WHEELS.volume, pitchDeclared: false });
  });

  it('is played at the slider’s position as the engine plays it: a notch for the engine, km/h for the wheels', () => {
    const idle = loopDecl({ main: 'a.ogg', pitch: [0.6, 1.1], volume: [0.5, 1] });
    expect(loopLevels('idle', idle, 0)).toEqual({ pitch: Math.fround(0.6), volume: 0.5 });
    expect(loopLevels('idle', idle, 8)).toEqual({ pitch: Math.fround(1.1), volume: 1 });
    expect(loopLevels('idle', idle, 4).pitch).toBeCloseTo(0.85, 6);
    const wheels = loopDecl({ main: 'a.ogg', pitch: [0.7, 1.1], volume: [0.2, 0.6] });
    expect(loopLevels('wheels', wheels, 100)).toEqual({ pitch: Math.fround(1.1), volume: Math.fround(0.6) });
    expect(loopLevels('wheels', wheels, 0).volume).toBe(0);
    expect(loopLevels('wheels', loopDecl(undefined), 100)).toEqual({ pitch: Math.fround(1.1), volume: Math.fround(0.7) });
    const horn = loopDecl({ main: 'a.ogg', pitch: [0.5, 0.9], volume: [0.1, 0.8] });
    expect(loopLevels('horn', horn, 0)).toEqual({ pitch: Math.fround(0.9), volume: Math.fround(0.8) });
    expect(loopLevels('bell', loopDecl('a.ogg'), 0)).toEqual({ pitch: 1, volume: 1 });
    expect(clackAt(0).volume).toBe(Math.fround(0.35));
  });
});

describe('references', () => {
  it('say whether a reference is a file in the pack, a file it lacks, or an event', async () => {
    const subject = subjectOf(await packWith({}), 'ns:loco') as NonNullable<ReturnType<typeof subjectOf>>;
    expect(refState('sounds/idle.ogg', subject)).toMatchObject({ present: true, ref: { kind: 'file', file: 'assets/ns/sounds/idle.ogg' } });
    expect(refState('other:sounds/horn.ogg', subject).present).toBe(true);
    expect(refState('sounds/gone.ogg', subject)).toMatchObject({ present: false, ref: { kind: 'file' } });
    expect(refState('minecraft:block.lever.click', subject)).toMatchObject({ present: false, ref: { kind: 'event', id: 'minecraft:block.lever.click' } });
    expect(refState('entity.minecart.riding', subject).ref.id).toBe('ns:entity.minecart.riding');
  });

  it('are written without the namespace in the declaring one and with it in another', async () => {
    const subject = subjectOf(await packWith({}), 'ns:loco') as NonNullable<ReturnType<typeof subjectOf>>;
    expect(refText('assets/ns/sounds/idle.ogg', subject)).toBe('sounds/idle.ogg');
    expect(refText('assets/other/sounds/horn.ogg', subject)).toBe('other:sounds/horn.ogg');
  });
});

describe('doors and controls', () => {
  it('list each door of the type, matching keys without case, then the keys that name none', async () => {
    const subject = subjectOf(await packWith({ doors: { DOOR_L: 'minecraft:a', ghost: 'minecraft:b' } }), 'ns:loco') as NonNullable<ReturnType<typeof subjectOf>>;
    expect(doorRows(subject)).toEqual([
      { id: 'Door_L', key: 'DOOR_L', ref: 'minecraft:a', pointer: '/sounds/doors/DOOR_L' },
      { id: 'door_r', key: null, ref: null, pointer: '/sounds/doors/door_r' },
      { id: null, key: 'ghost', ref: 'minecraft:b', pointer: '/sounds/doors/ghost' },
    ]);
  });

  it('tell for each control key what the engine does, and whether the open model has the organ', async () => {
    const subject = subjectOf(await packWith({ controls: { THROTTLE_1: { move: 'a.ogg' }, THROTTLE_2: {}, MY_1: {}, WIDGET_1: { engage: 'b.ogg' } } }), 'ns:loco') as NonNullable<ReturnType<typeof subjectOf>>;
    const model = { id: 'ns:loco', objects: [{ name: 'THROTTLE_1', control: { kind: 'THROTTLE', gauge: false, key: 'THROTTLE_1' } }] } as unknown as LoadedModel;
    expect(controlRows(subject, model).map((row) => [row.key, row.verdict.verdict, row.organ])).toEqual([
      ['THROTTLE_1', 'plays', true],
      ['THROTTLE_2', 'shadowed', true],
      ['MY_1', 'unknown', null],
      ['WIDGET_1', 'silent', null],
    ]);
    expect(controlRows(subject, null).map((row) => row.organ)).toEqual([null, null, null, null]);
    expect(controlRows(subject, { ...model, objects: [] })[0]?.organ).toBe(false);
  });

  it('offer the handles that have no sounding key yet, by the model’s own organ key when it has one', async () => {
    const subject = subjectOf(await packWith({ controls: { THROTTLE_1: {} } }), 'ns:loco') as NonNullable<ReturnType<typeof subjectOf>>;
    expect(suggestedControls(subject, null)).toEqual(['TRAIN_BRAKE_1', 'INDEPENDENT_BRAKE_1', 'REVERSER_1']);
    const model = {
      objects: [
        { name: 'IND_BRAKE_2', control: { kind: 'INDEPENDENT_BRAKE', gauge: false, key: 'IND_BRAKE_2' } },
        { name: 'GAUGE_TRAIN_BRAKE_1', control: { kind: 'TRAIN_BRAKE', gauge: true, key: 'GAUGE_TRAIN_BRAKE_1' } },
      ],
    } as unknown as LoadedModel;
    expect(suggestedControls(subject, model)).toEqual(['TRAIN_BRAKE_1', 'IND_BRAKE_2', 'REVERSER_1']);
  });
});

describe('the edits are commands of the journal', () => {
  it('set a reference, undone and redone', async () => {
    const pack = await packWith({ idle: { main: 'sounds/idle.ogg', pitch: [1, 1.2] } });
    const journal = new Journal(pack);
    const subject = subjectOf(pack, 'ns:loco') as NonNullable<ReturnType<typeof subjectOf>>;
    journal.dispatch({ label: 'sounds.command.set', labelParams: { field: 'x' }, ops: setRef(subject, '/sounds/idle/main', 'minecraft:block.beacon.ambient') });
    expect(pack.json(MODEL)).toMatchObject({ sounds: { idle: { main: 'minecraft:block.beacon.ambient', pitch: [1, 1.2] } } });
    journal.undo();
    expect(pack.json(MODEL)).toMatchObject({ sounds: { idle: { main: 'sounds/idle.ogg' } } });
    journal.redo();
    expect(pack.json(MODEL)).toMatchObject({ sounds: { idle: { main: 'minecraft:block.beacon.ambient' } } });
  });

  it('add a key to a declaration that has no sounds at all, and remove it again', async () => {
    const pack = await Pack.open(new MemorySource(filesOf({ 'pack.mcmeta': dump({ rwat: { format: 1 } }), [TYPE]: dump({ length: 10, bogies: [2, -2], mass_t: 40 }), [MODEL]: dump({ obj: 'x.obj' }) })));
    const journal = new Journal(pack);
    const subject = () => subjectOf(pack, 'ns:loco') as NonNullable<ReturnType<typeof subjectOf>>;
    journal.dispatch({ label: 'x', ops: setRef(subject(), '/sounds/horn', 'minecraft:item.goat_horn.sound.0') });
    expect(pack.json(MODEL)).toEqual({ obj: 'x.obj', sounds: { horn: 'minecraft:item.goat_horn.sound.0' } });
    journal.dispatch({ label: 'x', ops: removeAt(subject(), '/sounds/horn') });
    expect(pack.json(MODEL)).toEqual({ obj: 'x.obj', sounds: {} });
    expect(removeAt(subject(), '/sounds/horn')).toEqual([]);
    journal.undo();
    journal.undo();
    expect(pack.json(MODEL)).toEqual({ obj: 'x.obj' });
  });

  it('turn a loop given as a sound into an object that can take a range, only when it is a sound', async () => {
    const pack = await packWith({ idle: 'sounds/idle.ogg', wheels: { main: 'a.ogg' } });
    const subject = subjectOf(pack, 'ns:loco') as NonNullable<ReturnType<typeof subjectOf>>;
    new Journal(pack).dispatch({ label: 'x', ops: toObject(subject, 'idle') });
    expect((pack.json(MODEL) as { sounds: unknown }).sounds).toEqual({ idle: { main: 'sounds/idle.ogg' }, wheels: { main: 'a.ogg' } });
    expect(toObject(subject, 'wheels')).toEqual([]);
    expect(toObject(subject, 'horn')).toEqual([]);
  });

  it('add a control key with no sounds, once', async () => {
    const pack = await packWith({ controls: { THROTTLE_1: {} } });
    const subject = subjectOf(pack, 'ns:loco') as NonNullable<ReturnType<typeof subjectOf>>;
    new Journal(pack).dispatch({ label: 'x', ops: addControl(subject, 'REVERSER_1') });
    expect((pack.json(MODEL) as { sounds: { controls: unknown } }).sounds.controls).toEqual({ THROTTLE_1: {}, REVERSER_1: {} });
    expect(addControl(subject, 'THROTTLE_1')).toEqual([]);
  });
});
