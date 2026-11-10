import { describe, expect, it } from 'vitest';
import { checkPack } from '../../checks/pack';
import { Journal } from '../../core/journal';
import { Pack } from '../../core/pack';
import { createSchema } from '../../core/schema';
import { readSchemaFiles } from '../../core/schema/files.node';
import { addWagonCommand, checkNewPack, newPackMeta, newPackSource, type AddWagonInput, type NewPackInput } from './model';

const schema = createSchema(readSchemaFiles());
const encoder = new TextEncoder();

const PACK: NewPackInput = {
  name: 'My Trains',
  namespace: 'my_trains',
  title: '',
  version: '1.0.0',
  authors: 'Me, You ,',
  license: 'CC0-1.0',
  description: 'A coach.',
};

const WAGON: AddWagonInput = {
  namespace: 'my_trains',
  id: 'coach',
  folder: '',
  files: [
    { name: 'coach.obj', bytes: encoder.encode('o BODY\nv 0 0 0\n') },
    { name: 'coach.mtl', bytes: encoder.encode('newmtl a\n') },
  ],
  length: '20',
  massT: '40',
  bogieFront: '7',
  bogieRear: '-7',
  names: { en_us: 'Coach', ru_ru: '' },
};

describe('a new pack', () => {
  it('is pack.mcmeta with the pack section of the converter and the rwat block of format 1, written as the tools write', async () => {
    expect(checkNewPack(PACK, schema)).toEqual([]);
    expect(newPackMeta(PACK)).toEqual({
      pack: { pack_format: 34, supported_formats: [34, 48], description: 'A coach.' },
      rwat: { format: 1, name: 'My Trains', version: '1.0.0', authors: ['Me', 'You'], license: 'CC0-1.0', description: 'A coach.' },
    });
    expect(newPackMeta({ ...PACK, version: '', authors: '', license: '', description: '', title: 'T' })).toEqual({
      pack: { pack_format: 34, supported_formats: [34, 48], description: 'T' },
      rwat: { format: 1, name: 'T' },
    });
    const source = newPackSource(PACK);
    expect(source.name).toBe('My Trains');
    expect(source.writable).toBe(false);
    const pack = await Pack.open(source);
    expect(pack.paths()).toEqual(['pack.mcmeta']);
    expect(await pack.text('pack.mcmeta')).toBe(
      '{\n  "pack": {\n    "pack_format": 34,\n    "supported_formats": [34, 48],\n    "description": "A coach."\n  },\n' +
        '  "rwat": {\n    "format": 1,\n    "name": "My Trains",\n    "version": "1.0.0",\n    "authors": ["Me", "You"],\n' +
        '    "license": "CC0-1.0",\n    "description": "A coach."\n  }\n}\n',
    );
    expect(checkPack(pack, schema)).toEqual([]);
  });

  it('needs a name and a namespace of the format', () => {
    expect(checkNewPack({ ...PACK, name: ' ', namespace: 'My Trains' }, schema).map((e) => e.key)).toEqual(['newpack.error.name', 'newpack.error.namespace']);
  });
});

describe('a new wagon', () => {
  it('is one command: the model files, the type with its required fields, the model naming the OBJ, its names; undo takes it all back', async () => {
    const pack = await Pack.open(newPackSource(PACK));
    const result = addWagonCommand(pack, WAGON, schema);
    if (!('command' in result)) throw new Error(JSON.stringify(result.errors));
    expect(result.command.label).toBe('newpack.command.addWagon');
    const journal = new Journal(pack);
    await journal.run(result.command);
    expect(pack.paths()).toEqual([
      'assets/my_trains/lang/en_us.json',
      'assets/my_trains/stock/coach/coach.mtl',
      'assets/my_trains/stock/coach/coach.obj',
      'assets/my_trains/wagon_models/coach.json',
      'data/my_trains/wagon_types/coach.json',
      'pack.mcmeta',
    ]);
    expect(pack.json('data/my_trains/wagon_types/coach.json')).toEqual({ length: 20, bogies: [7, -7], mass_t: 40 });
    expect(pack.json('assets/my_trains/wagon_models/coach.json')).toEqual({ obj: 'stock/coach/coach.obj' });
    expect(pack.json('assets/my_trains/lang/en_us.json')).toEqual({ 'wagon.my_trains.coach': 'Coach' });
    expect(pack.stock()).toEqual([{ id: 'my_trains:coach', type: 'data/my_trains/wagon_types/coach.json', model: 'assets/my_trains/wagon_models/coach.json' }]);
    expect(checkPack(pack, schema)).toEqual([]);

    expect(addWagonCommand(pack, WAGON, schema)).toEqual({
      errors: [
        { key: 'newpack.error.idTaken', params: { id: 'my_trains:coach' } },
        { key: 'newpack.error.filesTaken', params: { files: 'assets/my_trains/stock/coach/coach.obj, assets/my_trains/stock/coach/coach.mtl' } },
      ],
    });
    journal.undo();
    expect(pack.paths()).toEqual(['pack.mcmeta']);
  });

  it('refuses file names Minecraft will not load, listing them, and a model without exactly one OBJ', async () => {
    const pack = await Pack.open(newPackSource(PACK));
    const result = addWagonCommand(
      pack,
      { ...WAGON, id: 'Coach', folder: 'stock/a', files: [{ name: 'Coach.obj', bytes: new Uint8Array() }, { name: 'my tex.png', bytes: new Uint8Array() }], length: '0', massT: 'x' },
      schema,
    );
    expect(result).toEqual({
      errors: [
        { key: 'newpack.error.id', params: { id: 'my_trains:Coach' } },
        { key: 'newpack.error.fileNames', params: { files: 'assets/my_trains/stock/a/Coach.obj, assets/my_trains/stock/a/my tex.png' } },
        { key: 'newpack.error.number', params: { field: 'length' } },
        { key: 'newpack.error.number', params: { field: 'mass_t' } },
      ],
    });
    expect(addWagonCommand(pack, { ...WAGON, files: [] }, schema)).toEqual({ errors: [{ key: 'newpack.error.obj', params: { count: 0 } }] });
    expect(addWagonCommand(pack, { ...WAGON, folder: 'a/../b' }, schema)).toEqual({ errors: [{ key: 'newpack.error.folder', params: { folder: 'a/../b' } }] });
  });
});
