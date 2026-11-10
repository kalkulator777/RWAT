import { describe, expect, it } from 'vitest';
import layout from '../../../../schema/pack-layout.json';
import {
  CONVERSION_MARKER,
  MCMETA,
  SUPPORTED_FORMAT,
  classify,
  fileKind,
  findPackRoot,
  langPath,
  lightNameKey,
  modelPath,
  railNameKey,
  railPath,
  typePath,
  wagonNameKey,
} from './layout';

describe('pack layout', () => {
  it('knows the declarations of pack-layout.json by their folders, ids with folders too', () => {
    expect(classify('data/rwat_example/wagon_types/coach.json')).toEqual({ kind: 'wagon_type', path: 'data/rwat_example/wagon_types/coach.json', namespace: 'rwat_example', id: 'rwat_example:coach' });
    expect(classify('assets/ns/wagon_models/sub/coach.json')).toMatchObject({ kind: 'wagon_model', id: 'ns:sub/coach' });
    expect(classify('assets/ns/rail_models/track.json')).toMatchObject({ kind: 'rail_model', id: 'ns:track' });
    expect(classify('assets/ns/lang/ru_ru.json')).toEqual({ kind: 'lang', path: 'assets/ns/lang/ru_ru.json', namespace: 'ns', lang: 'ru_ru' });
    for (const other of ['assets/ns/lang/sub/ru_ru.json', 'data/ns/wagon_types/coach.txt', 'assets/ns/wagon_types/coach.json', 'pack.mcmeta', 'data/wagon_types/x.json']) {
      expect(classify(other), other).toBeNull();
    }
  });

  it('writes the paths and lang keys of an id as the mod reads them', () => {
    expect(typePath('rwat_example:coach')).toBe('data/rwat_example/wagon_types/coach.json');
    expect(modelPath('ns:sub/coach')).toBe('assets/ns/wagon_models/sub/coach.json');
    expect(railPath('ns:track')).toBe('assets/ns/rail_models/track.json');
    expect(langPath('ns', 'en_us')).toBe('assets/ns/lang/en_us.json');
    expect(() => typePath('coach')).toThrow(RangeError);
    expect(() => typePath('ns:')).toThrow(RangeError);
    expect(wagonNameKey('rwat_example:coach')).toBe('wagon.rwat_example.coach');
    expect(railNameKey('rwat_example:wooden_track')).toBe('rail.rwat_example.wooden_track');
    expect(lightNameKey('rwat_example:shunter', 'FHL')).toBe('light.rwat_example.shunter.FHL');
    const keys = layout.lang_keys.map((entry) => entry.key);
    expect(keys).toEqual(['wagon.<namespace>.<id>', 'rail.<namespace>.<id>', 'light.<namespace>.<id>.<group>']);
  });

  it('holds JSON, text and binary files apart by their names', () => {
    expect(fileKind(MCMETA)).toBe('json');
    expect(fileKind('a/b.JSON')).toBe('json');
    expect(fileKind('a/coach.obj')).toBe('text');
    expect(fileKind('a/coach.mtl')).toBe('text');
    expect(fileKind('a/door.anim')).toBe('text');
    expect(fileKind(CONVERSION_MARKER)).toBe('text');
    expect(fileKind('a/body.png')).toBe('binary');
    expect(fileKind('a/horn.ogg')).toBe('binary');
    expect(fileKind('LICENSE')).toBe('binary');
    expect(fileKind('a.b/LICENSE')).toBe('binary');
    expect(SUPPORTED_FORMAT).toBe(layout.format);
  });

  it('finds the pack at the top, in its folder, or says it is none or several', () => {
    expect(findPackRoot(['pack.mcmeta', 'x/pack.mcmeta'])).toEqual({ root: '' });
    expect(findPackRoot(['MyPack/pack.mcmeta', 'MyPack/assets/a.png'])).toEqual({ root: 'MyPack/' });
    expect(findPackRoot(['MyPack/backup/pack.mcmeta', 'MyPack/pack.mcmeta'])).toEqual({ root: 'MyPack/' });
    expect(findPackRoot(['a/b/pack.mcmeta'])).toEqual({ root: 'a/b/' });
    expect(findPackRoot(['assets/a.png', 'notpack.mcmeta'])).toEqual({ problem: 'not-a-pack' });
    expect(findPackRoot(['B/pack.mcmeta', 'A/pack.mcmeta', 'A/old/pack.mcmeta'])).toEqual({ problem: 'several-packs', roots: ['A/', 'B/'] });
  });
});
