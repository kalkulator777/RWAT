import { describe, expect, it } from 'vitest';
import { createSchema, walkFields } from '../core/schema';
import { readSchemaFiles } from '../core/schema/files.node';
import { descriptorAt, fitsType, isSpatial, variantOf } from './fields';

const schema = createSchema(readSchemaFiles());
const type = schema.fields.root('wagon_type');
const model = schema.fields.root('wagon_model');

describe('field descriptors seen from a value', () => {
  it('find the descriptor at a pointer through objects, lists, dictionaries and the branch of a oneOf', () => {
    expect(descriptorAt(type, {}, '/brakes/train_kn')?.unit?.id).toBe('kN');
    expect(descriptorAt(type, { bogies: [1, 2] }, '/bogies/1')?.shape).toBe('number');
    expect(descriptorAt(model, {}, '/liveries/blue')?.limits.pattern).toBe('^[a-z0-9_./-]+$');
    expect(descriptorAt(model, { sounds: { idle: { main: 'a' } } }, '/sounds/idle/main')?.shape).toBe('string');
    // absent: the branch that has the key
    expect(descriptorAt(model, {}, '/sounds/idle/pitch')?.shape).toBe('array');
    expect(descriptorAt(type, {}, '/nope')).toBeUndefined();
    expect(descriptorAt(type, {}, '/length/x')).toBeUndefined();
  });

  it('pick the branch of a oneOf by the type of the value', () => {
    const idle = descriptorAt(model, {}, '/sounds/idle');
    if (idle === undefined) throw new Error('no idle');
    expect(variantOf(idle, 'minecraft:x')?.shape).toBe('string');
    expect(variantOf(idle, { main: 'x' })?.shape).toBe('object');
    expect(variantOf(idle, 5)).toBeUndefined();
    expect(variantOf(idle, undefined)).toBeUndefined();
  });

  it('tell an integer from a number', () => {
    const format = descriptorAt(schema.fields.root('pack_mcmeta_rwat'), {}, '/rwat/format');
    if (format === undefined) throw new Error('no format');
    expect(fitsType(format, 1)).toBe(true);
    expect(fitsType(format, 1.5)).toBe(false);
    expect(fitsType(format, '1')).toBe(false);
  });

  it('take the floor, the doors and the chairs for spatial markup, and nothing of a model', () => {
    const spatial = (type.properties ?? []).filter(isSpatial).map((p) => p.key);
    expect(spatial).toEqual(['interior', 'doors']);
    const cab = (type.properties ?? []).find((p) => p.key === 'cab');
    expect((cab?.properties ?? []).filter(isSpatial).map((p) => p.key)).toEqual(['seats', 'seat']);
    expect([...walkFields(model)].filter(isSpatial)).toEqual([]);
  });
});
