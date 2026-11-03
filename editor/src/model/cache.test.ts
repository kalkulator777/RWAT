import { describe, expect, it } from 'vitest';
import { ModelCache, type Stamp } from './cache';
import { MISSING, packFiles, type EditedPack } from './files';

const stamps = (entries: Record<string, Stamp>): Map<string, Stamp> => new Map(Object.entries(entries));

describe('ModelCache', () => {
  it('keeps three models and drops the least recently used for a fourth', () => {
    const cache = new ModelCache<string>();
    const now = (): Stamp => 1;
    expect(cache.put('a', stamps({ x: 1 }), 'A')).toEqual([]);
    cache.put('b', stamps({ x: 1 }), 'B');
    cache.put('c', stamps({ x: 1 }), 'C');
    expect(cache.get('a', now)).toBe('A'); // a is used again: b is now the oldest
    expect(cache.put('d', stamps({ x: 1 }), 'D')).toEqual(['B']);
    expect(cache.keys()).toEqual(['c', 'a', 'd']);
    expect(cache.get('b', now)).toBeUndefined();
    expect(cache.size).toBe(3);
  });

  it('answers a model only while every file it was read from keeps its stamp', () => {
    const cache = new ModelCache<string>();
    const files = new Map<string, Stamp>([
      ['m.obj', 'opened'],
      ['t.png', MISSING],
    ]);
    cache.put('m', files, 'M');
    expect(cache.get('m', (path) => files.get(path) ?? MISSING)).toBe('M');
    files.set('t.png', 'opened'); // the missing texture was put in
    expect(cache.get('m', (path) => files.get(path) ?? MISSING)).toBeUndefined();
    expect(cache.size).toBe(0); // a stale model is dropped
  });

  it('replaces a model put again, and forgets one or all', () => {
    const cache = new ModelCache<string>(2);
    cache.put('m', stamps({}), 'old');
    cache.put('m', stamps({}), 'new');
    expect(cache.get('m', () => 0)).toBe('new');
    cache.put('n', stamps({}), 'N');
    cache.delete('m');
    expect(cache.keys()).toEqual(['n']);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('keeps its own copy of the stamps', () => {
    const cache = new ModelCache<string>();
    const files = stamps({ x: 1 });
    cache.put('m', files, 'M');
    files.set('x', 2);
    expect(cache.get('m', () => 1)).toBe('M');
  });

  it('wants room for one model at least', () => {
    expect(() => new ModelCache(0)).toThrow(RangeError);
  });
});

describe('packFiles', () => {
  it('stamps a file as opened until it is edited, then by the pack version; a missing file as missing', async () => {
    const status = new Map<string, string>([['a.obj', 'unchanged']]);
    const pack: EditedPack = {
      version: 7,
      has: (path) => status.has(path),
      bytes: (path) => Promise.resolve(new TextEncoder().encode(path)),
      status: (path) => status.get(path) ?? 'deleted',
    };
    const files = packFiles(pack);
    expect(files.stamp('a.obj')).toBe('opened');
    expect(files.stamp('b.png')).toBe(MISSING);
    status.set('a.obj', 'changed');
    expect(files.stamp('a.obj')).toBe('edited 7');
    expect(await files.has('a.obj')).toBe(true);
    expect(new TextDecoder().decode(await files.read('a.obj'))).toBe('a.obj');
  });
});
