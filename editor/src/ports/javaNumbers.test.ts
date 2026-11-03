/**
 * Golden runner of fixtures/golden/java_numbers/ (editor.md §4.5; fixtures/golden/README.md):
 * `parseJavaFloat` and `formatFixed` against Java's `Float.parseFloat` and
 * `String.format(Locale.ROOT, "%.<n>f")`, the reference that writes the expected.
 * Every `*.json` of the folder is read; a case with `input.text` is a parse, one with
 * `input.value` and `input.digits` a format.
 */

import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../testing/repo.node';
import { mismatch, readGoldenFolder, readGoldenPorts } from '../testing/goldenCompare.node';
import { formatFixed, parseJavaFloat } from './javaNumbers';

const FOLDER = `${REPO_ROOT}fixtures/golden/java_numbers`;

const SPECIAL: Record<string, number> = { NaN: NaN, Infinity: Infinity, '-Infinity': -Infinity };

function toNumber(value: unknown): number {
  return typeof value === 'string' ? (SPECIAL[value] as number) : (value as number);
}

describe('golden java_numbers', () => {
  const files = readGoldenFolder(FOLDER);

  it('names this port in ports.json and has cases', () => {
    expect(readGoldenPorts(FOLDER)).toMatchObject({ reference: 'java', ports: expect.arrayContaining(['ts']) as unknown });
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(file.cases.length, file.name).toBeGreaterThanOrEqual(10);
  });

  for (const file of files) {
    describe(file.name, () => {
      for (const c of file.cases) {
        it(c.id, () => {
          const input = c.input as { text?: string; value?: unknown; digits?: number };
          const actual = input.text !== undefined ? parseJavaFloat(input.text) : formatFixed(toNumber(input.value), input.digits as number);
          expect(mismatch(actual, c.expected, file.tolerance), c.note).toBeNull();
        });
      }
    });
  }
});

describe('parseJavaFloat beyond the golden cases', () => {
  it('keeps a minus zero and reads long exponents without arithmetic', () => {
    expect(Object.is(parseJavaFloat('-0'), -0)).toBe(true);
    expect(parseJavaFloat('1e999999999999999999999')).toBe(Infinity);
    expect(parseJavaFloat('-1e-999999999999999999999')).toBe(-0);
    expect(parseJavaFloat('0e999999')).toBe(0);
  });

  it('reads hexadecimal floats to the nearest float and refuses malformed ones', () => {
    expect(parseJavaFloat('-0x1.8p-1f')).toBe(-0.75);
    expect(parseJavaFloat('0x0p0')).toBe(0);
    expect(parseJavaFloat('0x1p999999')).toBe(Infinity);
    expect(parseJavaFloat('0x1p-999999')).toBe(0);
    expect(parseJavaFloat('0x1.p')).toBeNull();
    expect(parseJavaFloat('0x')).toBeNull();
  });

  it('rounds ties to even', () => {
    expect(parseJavaFloat('16777217')).toBe(16777216);
    expect(parseJavaFloat('16777219')).toBe(16777220);
  });
});

describe('formatFixed beyond the golden cases', () => {
  it('prints the digits of the shortest decimal, however small or large', () => {
    expect(formatFixed(1e-7, 7)).toBe('0.0000001');
    expect(formatFixed(0.0000005, 6)).toBe('0.000001');
    expect(formatFixed(123456789012345680000, 1)).toBe('123456789012345680000.0');
    expect(formatFixed(0.9996, 3)).toBe('1.000');
  });
});
