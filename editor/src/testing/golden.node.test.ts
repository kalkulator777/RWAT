/**
 * The shared part of the golden runners (./golden.node.ts): it compares as
 * fixtures/golden/README.md ("Как сверять") and tools/tests/golden.py `close` say, and it
 * tells what is wrong with a folder.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { goldenNumber, mismatch, readGoldenFolder, shortestFloat, toNumber } from './golden.node';

describe('mismatch', () => {
  it('takes numbers within the tolerance, finite ones only', () => {
    expect(mismatch(1.0000001, 1, 1e-6)).toBeNull();
    expect(mismatch(1.00001, 1, 1e-6)).toBe('$: expected 1, got 1.00001');
    expect(mismatch(-0, 0, 0)).toBeNull();
    expect(mismatch(NaN, 1, 1)).not.toBeNull();
    expect(mismatch(Infinity, 1e308, Infinity)).not.toBeNull();
    expect(mismatch('1', 1, 0)).not.toBeNull();
  });

  it('reads "NaN", "Infinity" and "-Infinity" as those numbers, and null as no number', () => {
    expect(mismatch(NaN, 'NaN', 0)).toBeNull();
    expect(mismatch('NaN', 'NaN', 0)).toBeNull();
    expect(mismatch(-Infinity, '-Infinity', 0)).toBeNull();
    expect(mismatch(Infinity, '-Infinity', 0)).not.toBeNull();
    expect(mismatch(NaN, null, 0)).not.toBeNull();
    expect(mismatch(null, 'NaN', 0)).not.toBeNull();
  });

  it('holds strings and booleans exactly', () => {
    expect(mismatch('a', 'a', 1)).toBeNull();
    expect(mismatch('a', 'b', 1)).toBe('$: expected "b", got "a"');
    expect(mismatch(1, true, 1)).not.toBeNull();
  });

  it('goes into arrays, typed arrays, objects and maps, keys in order, and names the place', () => {
    expect(mismatch(new Float32Array([0.5, 1]), [0.5, 1], 0)).toBeNull();
    expect(mismatch([1, [2, 3]], [1, [2, 4]], 0)).toBe('$[1][1]: expected 4, got 3');
    expect(mismatch([1], [1, 2], 0)).not.toBeNull();
    expect(mismatch({ a: 1, b: { c: 'x' } }, { a: 1, b: { c: 'y' } }, 0)).toBe('$.b.c: expected "y", got "x"');
    expect(mismatch({ b: 1, a: 1 }, { a: 1, b: 1 }, 0)).toBe('$: expected the keys [a, b], got [b, a]');
    expect(mismatch(new Map([['door', [1]]]), { door: [1] }, 0)).toBeNull();
    expect(mismatch([1], { 0: 1 }, 0)).not.toBeNull();
  });
});

describe('the values of a case', () => {
  it('write and read the numbers JSON has none for by name', () => {
    expect([NaN, Infinity, -Infinity, 1.5].map(goldenNumber)).toEqual(['NaN', 'Infinity', '-Infinity', 1.5]);
    expect(['NaN', 'Infinity', '-Infinity', 2].map(toNumber)).toEqual([NaN, Infinity, -Infinity, 2]);
    expect(() => toNumber('nan')).toThrow();
  });

  it('write a float by its shortest decimal', () => {
    expect(shortestFloat(Math.fround(0.1))).toBe(0.1);
    expect(shortestFloat(Math.fround(16777217))).toBe(16777216);
  });
});

describe('readGoldenFolder', () => {
  function folder(files: Record<string, unknown>): string {
    const dir = mkdtempSync(join(tmpdir(), 'golden-'));
    for (const [name, value] of Object.entries(files)) writeFileSync(join(dir, name), JSON.stringify(value));
    return dir;
  }

  const ports = { reference: 'java', ports: ['ts'] };
  const file = (ids: string[]): unknown => ({
    description: 'd',
    frame: 'none',
    tolerance: 0,
    cases: ids.map((id) => ({ id, note: 'n', input: { x: 1 }, expected: null })),
  });

  it('reads every case file but ports.json, by name, and finds nothing wrong with a sound folder', () => {
    const dir = folder({ 'ports.json': ports, 'b.json': file(['b1', 'b2', 'b3', 'b4', 'b5']), 'a.json': file(['a1', 'a2', 'a3', 'a4', 'a5']) });
    const golden = readGoldenFolder(dir);
    expect(golden.ports).toEqual(ports);
    expect(golden.files.map((f) => f.name)).toEqual(['a.json', 'b.json']);
    expect(golden.files[0]!.cases[0]).toEqual({ id: 'a1', note: 'n', input: { x: 1 }, expected: null });
    expect(golden.problems).toEqual([]);
  });

  it('says what breaks the format: the schema, a second id, too few cases', () => {
    const dir = folder({ 'ports.json': ports, 'a.json': file(['a1', 'a1', 'Bad id']) });
    expect(readGoldenFolder(dir).problems).toEqual([
      expect.stringMatching(/^a\.json: data\/cases\/2\/id must match pattern/),
      'a.json: a second case a1',
      '2 cases, at least 10',
    ]);
  });

  it('reads input_file from the example pack only, parsed or as it is', () => {
    const value = (path: string): unknown => ({ ...(file(['a']) as object), cases: [{ id: 'a', note: 'n', input_file: { value: path }, expected: null }] });
    const pack = 'run/rwat_packs/RwatExamplePack/pack.mcmeta';
    const json = 'run/rwat_packs/RwatExamplePack/data/rwat_example/wagon_types/coach.json';
    const read = (path: string, raw: boolean): unknown =>
      (readGoldenFolder(folder({ 'ports.json': ports, 'a.json': value(path) }), { raw }).files[0]!.cases[0]!.input as { value: unknown }).value;
    expect(typeof read(pack, false)).toBe('string');
    expect(read(json, false)).toEqual(expect.objectContaining({ length: expect.any(Number) as unknown }));
    expect(typeof read(json, true)).toBe('string');
    expect(() => read('run/rwat_packs/MatoiVanillaPack/pack.mcmeta', false)).toThrow(/reads only files of/);
    expect(() => read('run/rwat_packs/RwatExamplePack/../MatoiVanillaPack/pack.mcmeta', false)).toThrow(/reads only files of/);
  });
});
