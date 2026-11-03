import { describe, expect, it } from 'vitest';
import { ValuePathError, deepEqual, insertIn, isJsonObject, removeIn, setIn } from './value';

describe('JSON values', () => {
  it('compares as JSON: member order does not count, types do', () => {
    expect(deepEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(deepEqual({ a: 1 }, { b: 1 })).toBe(false);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEqual([1], { 0: 1 })).toBe(false);
    expect(deepEqual({}, [])).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
    expect(deepEqual(1, '1')).toBe(false);
    expect(isJsonObject([])).toBe(false);
    expect(isJsonObject(null)).toBe(false);
  });

  it('sets without changing the old value, sharing what it did not touch', () => {
    const old = { doors: [{ id: 'a', min: [1, 2, 3] }, { id: 'b' }], mass: 20 };
    const { root, previous } = setIn(old, ['doors', '0', 'min'], [4, 5, 6]);
    expect(previous).toEqual({ exists: true, value: [1, 2, 3] });
    expect(root).toEqual({ doors: [{ id: 'a', min: [4, 5, 6] }, { id: 'b' }], mass: 20 });
    expect(old.doors[0]?.min).toEqual([1, 2, 3]);
    expect((root as typeof old).doors[1]).toBe(old.doors[1]);
    expect(setIn(old, ['brakes'], { system: 'ep' }).previous).toEqual({ exists: false });
    expect(Object.keys(setIn(old, ['brakes'], 1).root as object)).toEqual(['doors', 'mass', 'brakes']);
    expect(setIn(old, ['doors', '1'], null).previous.value).toEqual({ id: 'b' });
    expect(setIn(old, [], 5)).toEqual({ root: 5, previous: { exists: true, value: old } });
  });

  it('sets a member named __proto__ as a member', () => {
    const { root } = setIn({}, ['__proto__'], { polluted: true });
    expect(Object.keys(root as object)).toEqual(['__proto__']);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(root)).toBe(Object.prototype);
  });

  it('refuses places it cannot reach', () => {
    const value = { a: [1], s: 'x' };
    expect(() => setIn(value, ['b', 'c'], 1)).toThrow(ValuePathError);
    expect(() => setIn(value, ['a', '1'], 1)).toThrow(/no such element to set/);
    expect(() => setIn(value, ['a', '5', 'x'], 1)).toThrow(/no such element/);
    expect(() => setIn(value, ['s', 'x'], 1)).toThrow(/not an object or array/);
    expect(() => removeIn(value, [])).toThrow(ValuePathError);
    expect(() => removeIn(value, ['b'])).toThrow(/no such member to remove/);
    expect(() => removeIn(value, ['a', '-'])).toThrow(/no such element to remove/);
    expect(() => insertIn(value, [], 1)).toThrow(ValuePathError);
    expect(() => insertIn({ b: {} }, ['b', '0'], 1)).toThrow(/not an array to insert into/);
    expect(() => insertIn(value, ['a', '2'], 1)).toThrow(/no such place/);
  });

  it('removes members and elements, inserts elements', () => {
    const old = { a: [1, 2, 3], b: { c: 1, d: 2 } };
    expect(removeIn(old, ['a', '1'])).toEqual({ root: { a: [1, 3], b: old.b }, value: 2, index: 1 });
    const removed = removeIn(old, ['b', 'c']);
    expect(removed).toEqual({ root: { a: old.a, b: { d: 2 } }, value: 1, index: null });
    expect(insertIn(old, ['a', '0'], 0)).toEqual({ root: { a: [0, 1, 2, 3], b: old.b }, index: 0 });
    expect(insertIn(old, ['a', '-'], 4)).toEqual({ root: { a: [1, 2, 3, 4], b: old.b }, index: 3 });
    expect(insertIn(old, ['a', '3'], 4).index).toBe(3);
    expect(old).toEqual({ a: [1, 2, 3], b: { c: 1, d: 2 } });
    expect(insertIn([[1]], ['0', '1'], 2).root).toEqual([[1, 2]]);
  });
});
