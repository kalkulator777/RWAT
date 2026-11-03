/**
 * The port of `convention/LampIslands.java` (`of`): cabin lamps out of a glowing part. An
 * IR `FULLBRIGHT` object is usually many separate lamps in one mesh, so its faces are
 * split into islands that share corner positions, and each big-enough island is a lamp
 * at the centre of its box. Golden: fixtures/golden/lamp_islands/.
 *
 * The rule, all in float (`Math.fround` after every operation, as Java's `float`):
 * 1. a corner's key is its position rounded to 1e-4 blocks, `Math.round(fround(c · 1e4))`
 *    on each axis (round half up, as Java's `Math.round(float)`); faces sharing a key are
 *    one island, through any chain of them — the key itself, no hash;
 * 2. an island's box is the bounds of all its faces' corners;
 * 3. it is a lamp if the box's diagonal `sqrt(dx² + dy² + dz²)` (float squares and sum,
 *    the root in double) is at least {@link MIN_LAMP_SIZE}; the lamp is at the box
 *    centre `(min + max) · 0.5`;
 * 4. lamps come in the order of each island's first face.
 *
 * Which glowing parts are lamps and which lamps light the inside is `ModelParts`'s
 * business (port `modelParts.ts`, M3). Pure.
 */

import type { Vec3 } from '../core/contracts';
import { find, forest, union } from './unionFind';

/** Islands smaller than this (bounding-box diagonal, blocks) aren't lamps: 0.3 as a float. */
export const MIN_LAMP_SIZE = Math.fround(0.3);

/** The largest float: the empty box starts at ±this. */
const MAX_FLOAT = Math.fround(3.4028234663852886e38);

/** Java's `Math.round(float)`: half up, NaN 0, the `int` range at most. */
function javaRound(f: number): number {
  if (Number.isNaN(f)) return 0;
  return Math.min(2147483647, Math.max(-2147483648, Math.round(f)));
}

/** A corner rounded to 1e-4 blocks: faces meeting at one are one island. −0 and 0 write the same. */
function key(x: number, y: number, z: number): string {
  return `${javaRound(Math.fround(x * 1.0e4))},${javaRound(Math.fround(y * 1.0e4))},${javaRound(Math.fround(z * 1.0e4))}`;
}

/**
 * `LampIslands.of`: the lamps of one glowing part, in its own frame.
 *
 * @param corners the part's faces, four corners each (a triangle repeats its last),
 *   `x, y, z` per corner in order — as the OBJ loader reads them; read as floats
 * @returns each lamp's `[x, y, z]` (floats), in the order of its island's first face
 */
export function of(corners: ArrayLike<number>): Vec3[] {
  const faces = Math.floor(corners.length / 12);
  const at = (i: number): number => Math.fround(corners[i]!);
  const parent = forest(faces);
  const firstFaceAt = new Map<string, number>();
  for (let i = 0; i < faces; i++) {
    for (let c = 0; c < 4; c++) {
      const p = i * 12 + c * 3;
      const k = key(at(p), at(p + 1), at(p + 2));
      const other = firstFaceAt.get(k);
      if (other === undefined) firstFaceAt.set(k, i);
      else union(parent, i, other);
    }
  }
  // island root → its box (min x y z, max x y z), in the order of each island's first face
  const boxes = new Map<number, number[]>();
  for (let i = 0; i < faces; i++) {
    const root = find(parent, i);
    let box = boxes.get(root);
    if (box === undefined) {
      box = [MAX_FLOAT, MAX_FLOAT, MAX_FLOAT, -MAX_FLOAT, -MAX_FLOAT, -MAX_FLOAT];
      boxes.set(root, box);
    }
    for (let c = 0; c < 4; c++) {
      const p = i * 12 + c * 3;
      for (let axis = 0; axis < 3; axis++) {
        box[axis] = Math.min(box[axis]!, at(p + axis));
        box[axis + 3] = Math.max(box[axis + 3]!, at(p + axis));
      }
    }
  }
  const lamps: Vec3[] = [];
  for (const box of boxes.values()) {
    const [x0, y0, z0, x1, y1, z1] = box as [number, number, number, number, number, number];
    const dx = Math.fround(x1 - x0);
    const dy = Math.fround(y1 - y0);
    const dz = Math.fround(z1 - z0);
    const sum = Math.fround(Math.fround(Math.fround(dx * dx) + Math.fround(dy * dy)) + Math.fround(dz * dz));
    if (Math.sqrt(sum) >= MIN_LAMP_SIZE) {
      lamps.push([Math.fround(Math.fround(x0 + x1) * 0.5), Math.fround(Math.fround(y0 + y1) * 0.5), Math.fround(Math.fround(z0 + z1) * 0.5)]);
    }
  }
  return lamps;
}
