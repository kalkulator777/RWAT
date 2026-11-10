import { describe, expect, it } from 'vitest';
import { PointerError, arrayIndex, childPointer, escapeSegment, formatPointer, getAt, isPrefixPointer, parsePointer } from './pointer';

describe('JSON pointers (RFC 6901)', () => {
  it('splits a pointer into unescaped segments and back', () => {
    expect(parsePointer('')).toEqual([]);
    expect(parsePointer('/')).toEqual(['']);
    expect(parsePointer('/doors/0/min')).toEqual(['doors', '0', 'min']);
    expect(parsePointer('/a~1b/m~0n/~01')).toEqual(['a/b', 'm~n', '~1']);
    expect(formatPointer(['a/b', 'm~n', '~1', 0])).toBe('/a~1b/m~0n/~01/0');
    expect(formatPointer([])).toBe('');
    expect(escapeSegment('door/left~1')).toBe('door~1left~01');
    expect(childPointer('/doors', 2)).toBe('/doors/2');
    expect(childPointer('', 'a/b')).toBe('/a~1b');
  });

  it('refuses what is no pointer', () => {
    expect(() => parsePointer('doors')).toThrow(PointerError);
    expect(() => parsePointer('/a~2')).toThrow(/'~' must be followed by 0 or 1/);
    expect(() => parsePointer('/a~')).toThrow(PointerError);
  });

  it('reads array indices only in their canonical form, the end only where allowed', () => {
    expect(arrayIndex('0', 3)).toBe(0);
    expect(arrayIndex('2', 3)).toBe(2);
    expect(arrayIndex('3', 3)).toBeNull();
    expect(arrayIndex('3', 3, true)).toBe(3);
    expect(arrayIndex('-', 3)).toBeNull();
    expect(arrayIndex('-', 3, true)).toBe(3);
    for (const bad of ['01', '+1', '1.0', '-1', '', ' 1', 'x']) expect(arrayIndex(bad, 5, true)).toBeNull();
  });

  it('tells an ancestor by whole segments', () => {
    expect(isPrefixPointer('', '/a')).toBe(true);
    expect(isPrefixPointer('/doors', '/doors/0')).toBe(true);
    expect(isPrefixPointer('/doors', '/doors')).toBe(true);
    expect(isPrefixPointer('/door', '/doors/0')).toBe(false);
  });

  it('finds the value at a pointer, own members only', () => {
    const value = { doors: [{ id: 'a', min: [1, 2, 3] }], 'a/b': { '~': 5 }, nothing: null };
    expect(getAt(value, '')).toBe(value);
    expect(getAt(value, '/doors/0/min/2')).toBe(3);
    expect(getAt(value, ['doors', '0', 'id'])).toBe('a');
    expect(getAt(value, '/a~1b/~0')).toBe(5);
    expect(getAt(value, '/nothing')).toBeNull();
    expect(getAt(value, '/doors/1')).toBeUndefined();
    expect(getAt(value, '/doors/-')).toBeUndefined();
    expect(getAt(value, '/doors/0/id/length')).toBeUndefined();
    expect(getAt(value, '/nothing/x')).toBeUndefined();
    expect(getAt(value, '/toString')).toBeUndefined();
    expect(getAt(value, '/missing/deeper')).toBeUndefined();
  });
});
