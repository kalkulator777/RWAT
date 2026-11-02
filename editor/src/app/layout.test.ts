import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, LAYOUT_STORAGE_KEY, clampSize, layout, parseLayout, resize } from './layout';

afterEach(() => {
  localStorage.clear();
  layout.value = { ...DEFAULT_LAYOUT };
});

describe('clampSize', () => {
  it('keeps a size within the area limits, in whole pixels', () => {
    expect(clampSize('tree', 10)).toBe(160);
    expect(clampSize('tree', 9999)).toBe(560);
    expect(clampSize('inspector', 300.6)).toBe(301);
  });

  it('gives the default for anything that is not a finite number', () => {
    expect(clampSize('bottom', Number.NaN)).toBe(DEFAULT_LAYOUT.bottom);
    expect(clampSize('bottom', Number.POSITIVE_INFINITY)).toBe(DEFAULT_LAYOUT.bottom);
    expect(clampSize('bottom', '300')).toBe(DEFAULT_LAYOUT.bottom);
  });
});

describe('parseLayout', () => {
  it('reads what was stored, clamped, and the default for the rest or for garbage', () => {
    expect(parseLayout('{"tree":300,"inspector":1e6}')).toEqual({ tree: 300, inspector: 640, bottom: DEFAULT_LAYOUT.bottom });
    expect(parseLayout('not json')).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout('[1,2,3]')).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout(null)).toEqual(DEFAULT_LAYOUT);
  });
});

describe('resize', () => {
  it('changes one area and remembers the layout in the browser', () => {
    resize('tree', 333);
    expect(layout.value).toEqual({ ...DEFAULT_LAYOUT, tree: 333 });
    expect(parseLayout(localStorage.getItem(LAYOUT_STORAGE_KEY))).toEqual(layout.value);
  });
});
