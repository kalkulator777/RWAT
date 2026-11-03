/**
 * A zone's floor height from the model (docs/proposals/editor.md §2.3): a click on the
 * floor takes the y of the vertex under the pointer as the OBJ writes it, and a new zone
 * with no zone near to take its height from starts on the model's floor under it — the
 * largest level up-facing surface there. OBJ frame; pure: no DOM, no signals.
 */

import type { LoadedModel, Vec3 } from '../../core/contracts';
import { floatDecimal } from './snap';
import type { PlanRect } from './zones';

/**
 * The y of the vertex of `object` nearest to `point` (where a click met it), as the OBJ
 * writes it; null when the model has no such object drawn with faces.
 */
export function vertexYNear(model: LoadedModel, object: string, point: Vec3): number | null {
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const part of model.parts) {
    if (part.object !== object) continue;
    const p = part.positions;
    for (let i = 0; i + 2 < p.length; i += 3) {
      const d = Math.hypot((p[i] as number) - point[0], (p[i + 1] as number) - point[1], (p[i + 2] as number) - point[2]);
      if (d < bestDistance) {
        bestDistance = d;
        best = p[i + 1] as number;
      }
    }
  }
  return best === null ? null : floatDecimal(best);
}

/** A face this close to level (the y of its normal) is a floor. */
const LEVEL = 0.95;

/** The z of the plan's cross product (b − a) × (p − a): which side of the edge a→b the point p is on. */
function side(ax: number, az: number, bx: number, bz: number, px: number, pz: number): number {
  return (bx - ax) * (pz - az) - (bz - az) * (px - ax);
}

/** True if the plan's triangle a, b, c holds the point (px, pz). */
function holds(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, px: number, pz: number): boolean {
  const s1 = side(ax, az, bx, bz, px, pz);
  const s2 = side(bx, bz, cx, cz, px, pz);
  const s3 = side(cx, cz, ax, az, px, pz);
  return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
}

/**
 * The floor of the model under a plan rectangle: of the drawn faces that face up and lie
 * level over the rectangle (their middle in it, or their plan over its middle: a floor of
 * a few long faces), the height with the most area — the floor outweighs a seat or a
 * step, and the roof's top, as large, loses the tie to the lower floor; null when nothing
 * level faces up there.
 */
export function floorUnder(model: LoadedModel, rect: PlanRect): number | null {
  const areaAt = new Map<number, number>();
  const px = (rect.minX + rect.maxX) / 2;
  const pz = (rect.minZ + rect.maxZ) / 2;
  for (const part of model.parts) {
    if (!part.drawn) continue;
    const p = part.positions;
    for (let i = 0; i + 8 < p.length; i += 9) {
      const ax = p[i] as number, ay = p[i + 1] as number, az = p[i + 2] as number;
      const bx = p[i + 3] as number, by = p[i + 4] as number, bz = p[i + 5] as number;
      const cx = p[i + 6] as number, cy = p[i + 7] as number, cz = p[i + 8] as number;
      const mx = (ax + bx + cx) / 3;
      const mz = (az + bz + cz) / 3;
      const inside = mx >= rect.minX && mx <= rect.maxX && mz >= rect.minZ && mz <= rect.maxZ;
      if (!inside && !holds(ax, az, bx, bz, cx, cz, px, pz)) continue;
      // the face's normal by its corners in the OBJ's order (counter-clockwise seen from the front)
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const length = Math.hypot(nx, ny, nz);
      if (length === 0 || ny / length < LEVEL) continue;
      const y = floatDecimal((ay + by + cy) / 3);
      areaAt.set(y, (areaAt.get(y) ?? 0) + length / 2);
    }
  }
  let best: number | null = null;
  let bestArea = 0;
  for (const [y, area] of areaAt) {
    if (area > bestArea * (1 + 1e-9) || (best !== null && Math.abs(area - bestArea) <= bestArea * 1e-9 && y < best)) {
      best = y;
      bestArea = area;
    }
  }
  return best;
}
