import { describe, expect, it } from 'vitest';
import { blankOf, looseText, parseLoose, parseNumber, removeOps, renameKeyOps, setOps } from './values';

const F = 'data/ns/wagon_types/a.json';

describe('ops of a form edit', () => {
  it('set a field, creating the objects above it the file lacks', () => {
    expect(setOps(F, { mass_t: 1 }, '/mass_t', 2)).toEqual([{ op: 'set', file: F, at: '/mass_t', value: 2 }]);
    expect(setOps(F, { mass_t: 1 }, '/brakes/train_kn', 40)).toEqual([{ op: 'set', file: F, at: '/brakes', value: { train_kn: 40 } }]);
    expect(setOps(F, {}, '/sounds/idle/pitch', [1, 2])).toEqual([{ op: 'set', file: F, at: '/sounds', value: { idle: { pitch: [1, 2] } } }]);
    expect(setOps(F, { brakes: {} }, '/brakes/train_kn', 40)).toEqual([{ op: 'set', file: F, at: '/brakes/train_kn', value: 40 }]);
    expect(setOps(F, { bogies: [1, 2] }, '/bogies/1', 3)).toEqual([{ op: 'set', file: F, at: '/bogies/1', value: 3 }]);
  });

  it('do nothing where a scalar or a list is in the way', () => {
    expect(setOps(F, { brakes: 5 }, '/brakes/train_kn', 40)).toEqual([]);
    expect(setOps(F, { bogies: [] }, '/bogies/3/x', 1)).toEqual([]);
  });

  it('clear a field by removing its key, and nothing when there is none', () => {
    expect(removeOps(F, { brakes: { train_kn: 0 } }, '/brakes/train_kn')).toEqual([{ op: 'remove', file: F, at: '/brakes/train_kn' }]);
    expect(removeOps(F, {}, '/brakes/train_kn')).toEqual([]);
  });

  it('rename a key with its value, unless the new one is taken', () => {
    expect(renameKeyOps(F, { mas_t: 4 }, '', 'mas_t', 'mass_t')).toEqual([
      { op: 'remove', file: F, at: '/mas_t' },
      { op: 'set', file: F, at: '/mass_t', value: 4 },
    ]);
    expect(renameKeyOps(F, { a: 1, b: 2 }, '', 'a', 'b')).toEqual([]);
    expect(renameKeyOps(F, { a: 1 }, '', 'x', 'b')).toEqual([]);
  });
});

describe('numbers typed into a field', () => {
  it("take JSON's notation, with a point, and refuse anything else", () => {
    expect(parseNumber('1.5')).toEqual({ value: 1.5 });
    expect(parseNumber(' -2e3 ')).toEqual({ value: -2000 });
    expect(parseNumber('-0')).toEqual({ value: 0 });
    expect(parseNumber('1,5')).toEqual({ error: 'not-a-number' });
    expect(parseNumber('1.')).toEqual({ error: 'not-a-number' });
    expect(parseNumber('Infinity')).toEqual({ error: 'not-a-number' });
    expect(parseNumber('1e999')).toEqual({ error: 'not-a-number' });
    expect(parseNumber('2', true)).toEqual({ value: 2 });
    expect(parseNumber('2.5', true)).toEqual({ error: 'not-an-integer' });
  });
});

describe('values of no fixed type', () => {
  it('read JSON when it is JSON and text otherwise, and show a string bare when it reads back as itself', () => {
    expect(parseLoose('[34, 48]')).toEqual([34, 48]);
    expect(parseLoose('My trains')).toBe('My trains');
    expect(looseText('My trains')).toBe('My trains');
    expect(looseText('true')).toBe('"true"');
    expect(looseText({ text: 'x' })).toBe('{"text":"x"}');
    expect(looseText(undefined)).toBe('');
  });

  it('have a blank of each JSON type', () => {
    expect(['number', 'integer', 'boolean', 'object', 'array', 'string'].map((type) => blankOf([type]))).toEqual([0, 0, false, {}, [], '']);
  });
});
