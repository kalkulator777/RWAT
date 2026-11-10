import { describe, expect, it } from 'vitest';
import { formatNumber, formatQuantity } from './format';

describe('formatNumber', () => {
  it('writes numbers as JSON and Blender do: a point, no grouping, an ASCII minus', () => {
    expect(formatNumber(1234567.5)).toBe('1234567.5');
    expect(formatNumber(-0.0625)).toBe('-0.063');
    expect(formatNumber(-12)).toBe('-12');
  });

  it('drops trailing zeros and never writes -0', () => {
    expect(formatNumber(2.5, 3)).toBe('2.5');
    expect(formatNumber(494)).toBe('494');
    expect(formatNumber(-0)).toBe('0');
    expect(formatNumber(-0.0001)).toBe('0');
  });

  it('keeps as many fraction digits as asked', () => {
    expect(formatNumber(1 / 3, 0)).toBe('0');
    expect(formatNumber(1 / 3, 6)).toBe('0.333333');
    expect(formatNumber(0.1 + 0.2, 10)).toBe('0.3');
  });

  it('writes NaN and the infinities the way the JSON tools and Java do', () => {
    expect(formatNumber(Number.NaN)).toBe('NaN');
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('Infinity');
    expect(formatNumber(Number.NEGATIVE_INFINITY)).toBe('-Infinity');
  });
});

describe('formatQuantity', () => {
  it('joins the number and the unit with a no-break space, the degree sign without one', () => {
    expect(formatQuantity(42, 'т')).toBe('42\u00a0т');
    expect(formatQuantity(1.25, 'kN', 1)).toBe('1.3\u00a0kN');
    expect(formatQuantity(90, '°')).toBe('90°');
    expect(formatQuantity(3, '')).toBe('3');
  });
});
