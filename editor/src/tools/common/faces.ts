/**
 * The faces of a model a markup tool takes as level (docs/proposals/editor.md §2.3): the
 * floor under a zone (tools/floor/height.ts), a cushion's top a chair is put on
 * (tools/seats/cushion.ts). Plain data.
 */

/** A face whose unit normal's y is this close to 1 (it faces up) — or to −1 (down), where a tool takes both — lies level. */
export const LEVEL = 0.95;
