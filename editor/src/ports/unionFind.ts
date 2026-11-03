/**
 * Sets of the numbers `0…n−1` joined pair by pair — a union–find forest in an array, each
 * entry its number's parent, a root its own: port of `stock/UnionFind.java`, the one
 * union–find of the engine's core. The parts of a floor joined where they touch and where
 * an open door bridges them (./floorCheck, ./cabArea), the faces of a glowing mesh joined
 * at shared corners (./lampIslands). Pure.
 */

/** A forest: a plain array or a typed one. */
export type Forest = number[] | Int32Array;

/** `n` sets of one each: every number its own root (`UnionFind.of`). */
export function forest(n: number): Int32Array {
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  return parent;
}

/** The root of `i`'s set, halving the path on the way (`UnionFind.find`). */
export function find(parent: Forest, i: number): number {
  let at = i;
  while (parent[at] !== at) {
    parent[at] = parent[parent[at] as number] as number;
    at = parent[at] as number;
  }
  return at;
}

/** Joins the sets of `a` and `b`: the root of `a`'s set under the root of `b`'s (`UnionFind.union`). */
export function union(parent: Forest, a: number, b: number): void {
  parent[find(parent, a)] = find(parent, b);
}
