import { describe, expect, it } from 'vitest';
import common from '../../../schema/common.schema.json';
import layout from '../../../schema/pack-layout.json';
import wagonType from '../../../schema/wagon_type.schema.json';
import { pairText, russianKeys, schemaText } from './schemaText';

describe('schemaText', () => {
  it("takes a field's description from description and x-description-ru", () => {
    const vec3 = common.$defs.vec3;
    expect(schemaText(vec3, 'en')).toBe(vec3.description);
    expect(schemaText(vec3, 'ru')).toBe(vec3['x-description-ru']);
    expect(schemaText(wagonType.properties.mass_t, 'ru')).toMatch(/[а-я]/);
  });

  it('finds the Russian twin of other keywords: x-k-ru for k and for x-k, k-ru in pack-layout', () => {
    expect(russianKeys('description')).toEqual(['x-description-ru', 'description-ru']);
    expect(russianKeys('x-engine-default')).toEqual(['x-engine-default-ru']);
    const node = { name: 'OBJ frame', 'x-name-ru': 'Кадр OBJ', 'x-engine-default': '7·mass_t + 200', 'x-engine-default-ru': '7·mass_t + 200 Н', label: 'Reserved', 'label-ru': 'Зарезервировано' };
    expect(schemaText(node, 'ru', 'name')).toBe('Кадр OBJ');
    expect(schemaText(node, 'en', 'name')).toBe('OBJ frame');
    expect(schemaText(node, 'ru', 'x-engine-default')).toBe('7·mass_t + 200 Н');
    expect(schemaText(node, 'ru', 'label')).toBe('Зарезервировано');
  });

  it('gives the other language rather than nothing, and nothing for what is not an object', () => {
    expect(schemaText({ description: 'Only English' }, 'ru')).toBe('Only English');
    expect(schemaText({ 'x-description-ru': 'Только русский' }, 'en')).toBe('Только русский');
    expect(schemaText({ description: 3 }, 'en')).toBeUndefined();
    expect(schemaText(null, 'en')).toBeUndefined();
    expect(schemaText(['description'], 'en')).toBeUndefined();
  });
});

describe('pairText', () => {
  it('reads the { en, ru } pairs of pack-layout.json', () => {
    const tonne = layout.units.find((u) => u.unit === 't');
    expect(pairText(tonne, 'ru')).toBe('т');
    expect(pairText(tonne, 'en')).toBe('tonne');
    expect(pairText({ en: 'only' }, 'ru')).toBe('only');
    expect(pairText(undefined, 'en')).toBeUndefined();
  });
});
