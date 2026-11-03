/**
 * ./packJson.ts beyond what the golden `wagon_type` reaches through the parser (its
 * runner is ./wagonType.test.ts): the paths, the hints, how a value is named.
 */

import { describe, expect, it } from 'vitest';
import {
  PackJsonError,
  asBool,
  at,
  checkKeys,
  describe as describeValue,
  get,
  nearestKey,
  optionalArray,
  optionalBool,
  optionalNumber,
  optionalObject,
  required,
} from './packJson';

describe('packJson', () => {
  it('names a field by its dotted path, an element by its index', () => {
    expect(at('', 'length')).toBe('length');
    expect(at('brakes', 'train_kn')).toBe('brakes.train_kn');
    expect(at('doors', 2)).toBe('doors[2]');
    expect(at(at('doors', 2), 'min')).toBe('doors[2].min');
  });

  it('describes values as the engine does', () => {
    expect(describeValue(undefined)).toBe('nothing');
    expect(describeValue(null)).toBe('null');
    expect(describeValue(true)).toBe('true');
    expect(describeValue(-0)).toBe('the number -0');
    expect(describeValue([])).toBe('an array');
    expect(describeValue({})).toBe('an object');
    expect(describeValue('x'.repeat(41))).toBe(`the string "${'x'.repeat(40)}…"`);
  });

  it('hints the nearest known key', () => {
    expect(nearestKey('livery', ['liveries'])).toBe('liveries');
    expect(nearestKey('ab', ['a', 'ab', 'abc'])).toBe('ab');
    expect(nearestKey('AB', ['ab'])).toBe('ab');
    expect(nearestKey('xy', ['ab'])).toBeNull();
    expect(nearestKey('cfront', ['c_front'])).toBe('c_front');
    expect(nearestKey('max_tractive', ['max_tractive_effort_kn'])).toBe('max_tractive_effort_kn');
    expect(nearestKey('maxx_tractive_effort_kn', ['max_tractive_effort_kn'])).toBe('max_tractive_effort_kn');
    expect(nearestKey('aplpy_s', ['apply_s'])).toBe('apply_s');
  });

  it('warns of each key a section does not know, with a hint where one is close', () => {
    const warnings: string[] = [];
    checkKeys({ max_speed: 1, mass_t: 2, colour: 'red' }, ['mass_t', 'max_speed_kmh'], 'stock', (w) => warnings.push(w));
    expect(warnings).toEqual([
      "unknown key 'stock.max_speed' (ignored) — did you mean 'stock.max_speed_kmh'?",
      "unknown key 'stock.colour' (ignored)",
    ]);
  });

  it('reads optional fields: the fallback when absent, the error of the wrong type when there', () => {
    const object = { n: 2, b: false, o: {}, a: [1], nil: null };
    expect(optionalNumber(object, 'n', '', 7)).toBe(2);
    expect(optionalNumber(object, 'x', '', 7)).toBe(7);
    expect(optionalBool(object, 'b', '', true)).toBe(false);
    expect(optionalObject(object, 'o', '')).toEqual({});
    expect(optionalObject(object, 'x', '')).toBeNull();
    expect(optionalArray(object, 'a', '')).toEqual([1]);
    expect(() => optionalNumber(object, 'nil', 'brakes', 0)).toThrow(new PackJsonError("'brakes.nil' must be a finite number, got null"));
    expect(() => asBool(1, 'cab.on')).toThrow("'cab.on' must be true or false, got the number 1");
    expect(() => required(object, 'id', 'doors[0]')).toThrow("missing required field 'doors[0].id'");
    expect(required(object, 'nil', '')).toBeNull();
  });

  it('reads only an object’s own members', () => {
    expect(get({}, 'toString')).toBeUndefined();
    expect(optionalNumber({}, 'constructor', '', 1)).toBe(1);
  });
});
