/**
 * Golden runner of fixtures/golden/java_numbers/ (editor.md §4.5; fixtures/golden/README.md):
 * `parseJavaFloat`, `formatFixed`, `javaDoubleToString` and `parseJavaInt` against Java's
 * `Float.parseFloat`, `String.format(Locale.ROOT, "%.<n>f")`, `Double.toString` and
 * `Integer.parseInt`, the reference that writes the expected. Every `*.json` of the folder
 * is read; a case with `input.text` is a parse, one with `input.value` and `input.digits` a
 * format, one with `input.double` a `toString`, one with `input.int` an int's parse.
 */

import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../testing/repo.node';
import { mismatch, readGoldenFolder, toNumber } from '../testing/golden.node';
import { formatFixed, javaDoubleToString, parseJavaFloat, parseJavaInt } from './javaNumbers';

const FOLDER = `${REPO_ROOT}fixtures/golden/java_numbers`;

const golden = readGoldenFolder(FOLDER);

describe('golden java_numbers', () => {
  it('names this port in ports.json, and the folder follows the golden format', () => {
    expect(golden.ports).toMatchObject({ reference: 'java', ports: expect.arrayContaining(['ts']) as unknown });
    expect(golden.problems).toEqual([]);
  });

  for (const file of golden.files) {
    describe(file.name, () => {
      for (const c of file.cases) {
        it(c.id, () => {
          const input = c.input as { text?: string; value?: unknown; digits?: number; double?: unknown; int?: string };
          const actual =
            input.text !== undefined
              ? parseJavaFloat(input.text)
              : input.int !== undefined
                ? parseJavaInt(input.int)
                : input.double !== undefined
                  ? javaDoubleToString(toNumber(input.double))
                  : formatFixed(toNumber(input.value), input.digits as number);
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

  it('rounds a decimal that a double puts half-way between two floats by its exact value', () => {
    // 1 + 2^-24 is the midpoint of 1 and 1 + 2^-23; the decimals around it round to it as doubles
    expect(parseJavaFloat('1.00000005960464477539062500000001')).toBe(1.0000001192092896);
    expect(parseJavaFloat('1.00000005960464477539062499999999')).toBe(1);
    expect(parseJavaFloat('-1.00000005960464477539062500000001f')).toBe(-1.0000001192092896);
    // half-way between the largest float and 2^128: to even, that is Infinity; just below it, the largest float
    expect(parseJavaFloat('340282356779733661637539395458142568448')).toBe(Infinity);
    expect(parseJavaFloat('340282356779733661637539395458142568447.9999999999')).toBe(Math.fround(3.4028234663852886e38));
    // half the smallest float: to even, 0; a hair more, the smallest float
    expect(parseJavaFloat('7.006492321624085354618647916449580656401309709382578858785341419448955413429303e-46')).toBe(0);
    expect(parseJavaFloat('7.0064923216240853546186479164495806564013097093825788587853414194489554134293031e-46')).toBe(2 ** -149);
  });

  it('reads hexadecimal floats to the nearest float, past the range to Infinity or 0', () => {
    expect(parseJavaFloat('0x1.000001p0')).toBe(1); // half-way: to even
    expect(parseJavaFloat('0x1.0000011p0')).toBe(1.0000001192092896);
    expect(parseJavaFloat('-0x1.8p-1d')).toBe(-0.75);
    expect(parseJavaFloat('0x0p99999999999')).toBe(0);
    expect(parseJavaFloat('0x1p128')).toBe(Infinity);
    expect(parseJavaFloat('0x1p-150')).toBe(0);
    expect(parseJavaFloat('0x1.0001p-150')).toBe(2 ** -149);
    expect(parseJavaFloat('0x1p-151')).toBe(0);
    expect(parseJavaFloat('0x1p-149')).toBe(2 ** -149);
    expect(parseJavaFloat('0x1p99999999999')).toBe(Infinity);
    expect(parseJavaFloat('0x1p')).toBeNull();
  });

  it('keeps the sign of zero and drops blanks only around the number', () => {
    expect(Object.is(parseJavaFloat(' -0.0f '), -0)).toBe(true);
    expect(parseJavaFloat('\u00011.5\u001f')).toBe(1.5);
    expect(parseJavaFloat('-NaN')).toBeNaN();
  });
});

describe('parseJavaInt', () => {
  it('takes a sign and decimal digits, Unicode ones too, and refuses the rest and past the int range', () => {
    expect(parseJavaInt('12')).toBe(12);
    expect(parseJavaInt('+7')).toBe(7);
    expect(parseJavaInt('-3')).toBe(-3);
    expect(parseJavaInt('١٢')).toBe(12); // Arabic-Indic digits
    expect(parseJavaInt('３')).toBe(3); // a full-width digit
    expect(parseJavaInt('2147483647')).toBe(2147483647);
    expect(parseJavaInt('-2147483648')).toBe(-2147483648);
    for (const refused of ['', '+', '-', '2147483648', '-2147483649', '99999999999', '1.0', ' 1', '1e2', '²', '𝟎']) {
      expect(parseJavaInt(refused), refused).toBeNull();
    }
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
