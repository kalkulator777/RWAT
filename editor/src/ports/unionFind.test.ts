/** ./unionFind against `stock/UnionFind.java`: the cases of `UnionFindTest`. */

import { describe, expect, it } from 'vitest';
import { find, forest, union } from './unionFind';

describe('unionFind', () => {
  it('starts every number alone and joins sets, not pairs', () => {
    const parent = forest(6);
    expect([...parent]).toEqual([0, 1, 2, 3, 4, 5]);
    union(parent, 0, 1);
    union(parent, 2, 3);
    union(parent, 1, 3); // joins {0, 1} and {2, 3}
    union(parent, 4, 4); // nothing to join
    const root = find(parent, 0);
    for (const i of [1, 2, 3]) expect(find(parent, i), `of ${i}`).toBe(root);
    expect(find(parent, 4)).not.toBe(root);
    expect(find(parent, 4)).toBe(4);
    expect(find(parent, 5)).toBe(5);
  });

  it('knows a set by the root of its second number, and a find halves its path, in a plain array too', () => {
    const parent = [0, 1, 2, 3];
    union(parent, 0, 1);
    union(parent, 1, 2);
    union(parent, 2, 3);
    expect(parent).toEqual([1, 2, 3, 3]);
    expect(find(parent, 0)).toBe(3);
    expect(parent).toEqual([2, 2, 3, 3]); // 0 now points at its grandparent, 2
  });
});
