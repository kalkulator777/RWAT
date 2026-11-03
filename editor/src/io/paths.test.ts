import { describe, expect, it } from 'vitest';
import { compareForWriting, comparePaths, normalizeEntryName, packPathProblem, parentPath } from './paths';

describe('packPathProblem', () => {
  it('accepts paths inside a pack, in any case', () => {
    for (const path of ['pack.mcmeta', 'assets/ns/Wagon_Models/Coach.json', 'a/b.c/d e/é.png', 'a/...']) {
      expect(packPathProblem(path)).toBeNull();
    }
  });

  it('names what is wrong with a path that leaves the pack or is not one', () => {
    expect(packPathProblem('')).toBe('empty');
    expect(packPathProblem('/etc/passwd')).toBe('absolute');
    expect(packPathProblem('C:/x')).toBe('drive');
    expect(packPathProblem('../x')).toBe('parent');
    expect(packPathProblem('a/../x')).toBe('parent');
    expect(packPathProblem('a//x')).toBe('not-normal');
    expect(packPathProblem('./x')).toBe('not-normal');
    expect(packPathProblem('a/')).toBe('not-normal');
    expect(packPathProblem('a\\x')).toBe('backslash');
    expect(packPathProblem('a\u0000x')).toBe('control');
  });
});

describe('normalizeEntryName', () => {
  it('reads an archive name the way the converter reads an IR zip', () => {
    expect(normalizeEntryName('assets\\ns\\x.png')).toEqual({ path: 'assets/ns/x.png' });
    expect(normalizeEntryName('./a//b/./c')).toEqual({ path: 'a/b/c' });
    expect(normalizeEntryName('A/B')).toEqual({ path: 'A/B' });
  });

  it('refuses a name that climbs out, is absolute or has a drive', () => {
    expect(normalizeEntryName('../x')).toEqual({ problem: 'parent' });
    expect(normalizeEntryName('a/../../x')).toEqual({ problem: 'parent' });
    expect(normalizeEntryName('..\\x')).toEqual({ problem: 'parent' });
    expect(normalizeEntryName('/x')).toEqual({ problem: 'absolute' });
    expect(normalizeEntryName('\\\\server\\share')).toEqual({ problem: 'absolute' });
    expect(normalizeEntryName('c:\\x')).toEqual({ problem: 'drive' });
    expect(normalizeEntryName('a\nb')).toEqual({ problem: 'control' });
    expect(normalizeEntryName('./')).toEqual({ problem: 'empty' });
  });
});

describe('order and parents', () => {
  it('orders by code point, as Python sorts the converter paths', () => {
    // U+FFFD sorts before U+10000 by code point; by UTF-16 units it would come after.
    expect(comparePaths('\u{10000}', '\uFFFD')).toBeGreaterThan(0);
    expect(['b', 'a/b', 'a', 'B'].sort(comparePaths)).toEqual(['B', 'a', 'a/b', 'b']);
    expect(comparePaths('a', 'a')).toBe(0);
    expect(comparePaths('a', 'ab')).toBeLessThan(0);
  });

  it('writes pack.mcmeta last', () => {
    expect(['pack.mcmeta', 'z', 'a'].sort(compareForWriting)).toEqual(['a', 'z', 'pack.mcmeta']);
  });

  it('finds the folder of a path', () => {
    expect(parentPath('a/b/c.json')).toBe('a/b');
    expect(parentPath('c.json')).toBe('');
  });
});
