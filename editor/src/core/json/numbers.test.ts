import { describe, expect, it } from 'vitest';
import { formatLexeme, formatNumber, isFloatLexeme, pythonFloat } from './numbers';

/** [value, Python's repr(float(value))], written by Python 3.13. */
const PYTHON_REPR: [number, string][] = [
  [0.1, '0.1'],
  [1 / 3, '0.3333333333333333'],
  [2 / 3, '0.6666666666666666'],
  [1e-4, '0.0001'],
  [1e-5, '1e-05'],
  [1.5e-7, '1.5e-07'],
  [123.456, '123.456'],
  [1e15, '1000000000000000.0'],
  [1e16, '1e+16'],
  [9.999999999999998e15, '9999999999999998.0'],
  [1.2345678901234568e17, '1.2345678901234568e+17'],
  [5e-324, '5e-324'],
  [1.7976931348623157e308, '1.7976931348623157e+308'],
  [-2.5, '-2.5'],
  [0.000123, '0.000123'],
  [1e22, '1e+22'],
  [2 ** 53, '9007199254740992.0'],
  [100, '100.0'],
  [-0, '-0.0'],
  [0, '0.0'],
  [3e-4, '0.0003'],
  [2.675, '2.675'],
  [1.005, '1.005'],
  [-1e-300, '-1e-300'],
  [4.35, '4.35'],
  [0.07, '0.07'],
  [1234567.125, '1234567.125'],
];

describe('numbers as Python writes them', () => {
  it.each(PYTHON_REPR)('repr(float(%s)) is %s', (value, repr) => {
    expect(pythonFloat(value)).toBe(repr);
  });

  it('writes the non-finite as json.dumps does', () => {
    expect(pythonFloat(Number.NaN)).toBe('NaN');
    expect(pythonFloat(Infinity)).toBe('Infinity');
    expect(pythonFloat(-Infinity)).toBe('-Infinity');
  });

  it('writes a whole JavaScript number as an int, any other as a float', () => {
    expect(formatNumber(20)).toBe('20');
    expect(formatNumber(-7)).toBe('-7');
    expect(formatNumber(-0)).toBe('0');
    expect(formatNumber(1e20)).toBe('100000000000000000000');
    expect(formatNumber(1e21)).toBe('1000000000000000000000');
    expect(formatNumber(2 ** 70)).toBe('1180591620717411303424');
    expect(formatNumber(0.5)).toBe('0.5');
    expect(formatNumber(1e-5)).toBe('1e-05');
    expect(() => formatNumber(Number.NaN)).toThrow(RangeError);
    expect(() => formatNumber(Infinity)).toThrow(RangeError);
  });

  it('keeps the kind a lexeme has to Python: int or float', () => {
    expect(formatLexeme('100')).toBe('100');
    expect(formatLexeme('100.0')).toBe('100.0');
    expect(formatLexeme('1e2')).toBe('100.0');
    expect(formatLexeme('1E2')).toBe('100.0');
    expect(formatLexeme('-0')).toBe('0');
    expect(formatLexeme('-0.0')).toBe('-0.0');
    expect(formatLexeme('123456789012345678')).toBe('123456789012345678');
    expect(formatLexeme('-9007199254740993')).toBe('-9007199254740993');
    expect(formatLexeme('1.10')).toBe('1.1');
    expect(formatLexeme('1e400')).toBe('Infinity');
    expect(isFloatLexeme('20.0')).toBe(true);
    expect(isFloatLexeme('2e1')).toBe(true);
    expect(isFloatLexeme('-20')).toBe(false);
  });
});
