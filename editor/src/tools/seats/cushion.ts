/**
 * Where a click on the model puts a chair (docs/proposals/editor.md §2.3: "клик по подушке
 * ставит at"): a chair's `at` is the top of its cushion, so a click on a small level face
 * — a cushion's top — takes that face's middle, at its height, as the OBJ writes them
 * (`[1.65, 2.1, -0.8]`, not where the pointer happened to be on it); a click on a larger
 * level face (a hood, a floor) takes the point clicked at that face's height; a click on
 * anything else, the point itself. A level face is the faces of one object at one height
 * facing one way, up or down within a few degrees, joined through their corners: the
 * bottom of a backrest standing on a cushion is no part of the cushion's top.
 *
 * The same small faces of the whole model are what a chair dragged from the top snaps to
 * ({@link spotsOf}). OBJ frame; pure: no DOM, no signals.
 */

import type { LoadedModel, Vec3 } from '../../core/contracts';
import { LEVEL } from '../common/faces';
import { clean, floatDecimal, free } from '../common/snap';

/** A level face no wider than this across, blocks, is a cushion: a click on it takes its middle. */
export const CUSHION_SIZE = 1.2;

/** Corners closer than this, blocks, are one corner; faces whose heights differ by less are at one height. */
const SAME = 1.0e-4;

/** A level face: its plan's box and its height, as the OBJ writes them, and whether it faces up. */
export interface LevelFace {
  readonly object: string;
  readonly up: boolean;
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
  readonly y: number;
}

/** The middle of a level face, at its height. */
export function middleOf(face: LevelFace): Vec3 {
  return [clean((face.minX + face.maxX) / 2), face.y, clean((face.minZ + face.maxZ) / 2)];
}

/** True for a face small enough to be a cushion. */
export function isCushion(face: LevelFace): boolean {
  return face.maxX - face.minX <= CUSHION_SIZE && face.maxZ - face.minZ <= CUSHION_SIZE;
}

function find(parent: Int32Array, i: number): number {
  let at = i;
  while (parent[at] !== at) {
    parent[at] = parent[parent[at] as number] as number;
    at = parent[at] as number;
  }
  return at;
}

function key(x: number, y: number, z: number): string {
  return `${Math.round(x / SAME)},${Math.round(y / SAME)},${Math.round(z / SAME)}`;
}

/** A level triangle of an object: its corners' index in the positions, its height, and whether it faces up. */
interface Level {
  readonly positions: Float32Array;
  readonly at: number;
  readonly y: number;
  readonly up: boolean;
}

/** The level triangles of the parts given (an object's, or every drawn one's), each object by itself. */
function levelTriangles(parts: readonly { object: string; positions: Float32Array }[]): Map<string, Level[]> {
  const out = new Map<string, Level[]>();
  for (const part of parts) {
    const p = part.positions;
    for (let i = 0; i + 8 < p.length; i += 9) {
      const ux = (p[i + 3] as number) - (p[i] as number);
      const uy = (p[i + 4] as number) - (p[i + 1] as number);
      const uz = (p[i + 5] as number) - (p[i + 2] as number);
      const vx = (p[i + 6] as number) - (p[i] as number);
      const vy = (p[i + 7] as number) - (p[i + 1] as number);
      const vz = (p[i + 8] as number) - (p[i + 2] as number);
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const length = Math.hypot(nx, ny, nz);
      if (length === 0 || Math.abs(ny) / length < LEVEL) continue;
      const y = ((p[i + 1] as number) + (p[i + 4] as number) + (p[i + 7] as number)) / 3;
      let list = out.get(part.object);
      if (list === undefined) {
        list = [];
        out.set(part.object, list);
      }
      list.push({ positions: p, at: i, y, up: ny > 0 });
    }
  }
  return out;
}

/** The level faces made of one object's level triangles: those at one height that share a corner, joined. */
function facesOf(object: string, triangles: readonly Level[]): { faces: LevelFace[]; faceOf: Int32Array } {
  const parent = new Int32Array(triangles.length);
  for (let i = 0; i < triangles.length; i++) parent[i] = i;
  const first = new Map<string, number>();
  triangles.forEach((triangle, t) => {
    const p = triangle.positions;
    for (let c = 0; c < 3; c++) {
      const at = triangle.at + c * 3;
      // one height and one facing in the key: faces at two heights that share a corner (a
      // step's edge), or facing two ways (a cushion's top under a backrest's bottom), stay apart
      const k = `${key(p[at] as number, triangle.y, p[at + 2] as number)}${triangle.up ? '+' : '-'}`;
      const other = first.get(k);
      if (other === undefined) first.set(k, t);
      else parent[find(parent, t)] = find(parent, other);
    }
  });
  const boxes = new Map<number, number[]>();
  const numbers = new Map<number, number>();
  const faceOf = new Int32Array(triangles.length);
  const order: number[] = [];
  triangles.forEach((triangle, t) => {
    const root = find(parent, t);
    let box = boxes.get(root);
    if (box === undefined) {
      box = [Infinity, Infinity, -Infinity, -Infinity, triangle.y, triangle.up ? 1 : 0];
      boxes.set(root, box);
      numbers.set(root, order.length);
      order.push(root);
    }
    const p = triangle.positions;
    for (let c = 0; c < 3; c++) {
      const at = triangle.at + c * 3;
      box[0] = Math.min(box[0] as number, p[at] as number);
      box[1] = Math.min(box[1] as number, p[at + 2] as number);
      box[2] = Math.max(box[2] as number, p[at] as number);
      box[3] = Math.max(box[3] as number, p[at + 2] as number);
    }
    faceOf[t] = numbers.get(root) as number;
  });
  const faces = order.map((root): LevelFace => {
    const [minX, minZ, maxX, maxZ, y, up] = boxes.get(root) as [number, number, number, number, number, number];
    return { object, up: up === 1, minX: floatDecimal(minX), minZ: floatDecimal(minZ), maxX: floatDecimal(maxX), maxZ: floatDecimal(maxZ), y: floatDecimal(y) };
  });
  return { faces, faceOf };
}

/** True if the plan's triangle at `at` of `p` holds (x, z), its edges included. */
function holds(p: Float32Array, at: number, x: number, z: number): boolean {
  const ax = p[at] as number, az = p[at + 2] as number;
  const bx = p[at + 3] as number, bz = p[at + 5] as number;
  const cx = p[at + 6] as number, cz = p[at + 8] as number;
  const s1 = (bx - ax) * (z - az) - (bz - az) * (x - ax);
  const s2 = (cx - bx) * (z - bz) - (cz - bz) * (x - bx);
  const s3 = (ax - cx) * (z - cz) - (az - cz) * (x - cx);
  // a point on an edge is in, whatever the rounding of the corners' floats
  const tolerance = 1.0e-5 * Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax)) + 1.0e-12;
  return (s1 >= -tolerance && s2 >= -tolerance && s3 >= -tolerance) || (s1 <= tolerance && s2 <= tolerance && s3 <= tolerance);
}

/** The level face of `object` a click at `point` landed on, or null for a click on no level face. */
export function levelFaceAt(model: LoadedModel, object: string, point: Vec3): LevelFace | null {
  const triangles = levelTriangles(model.parts.filter((part) => part.object === object)).get(object) ?? [];
  const near = 1.0e-3;
  // a top met from above before a bottom at the same place (a cushion under a backrest)
  const under = triangles.filter((tr) => Math.abs(tr.y - point[1]) <= near && holds(tr.positions, tr.at, point[0], point[2]));
  const hitTriangle = under.find((tr) => tr.up) ?? under[0];
  if (hitTriangle === undefined) return null;
  // the faces at the hit's height and facing its way only: the others are no part of it
  const level = triangles.filter((tr) => tr.up === hitTriangle.up && Math.abs(tr.y - hitTriangle.y) <= SAME);
  const { faces, faceOf } = facesOf(object, level);
  return faces[faceOf[level.indexOf(hitTriangle)] as number] ?? null;
}

/**
 * Where a click on `object` at `point` puts a chair: the middle of the cushion clicked; on a
 * larger level face, the point at the face's height; elsewhere the point itself — to a
 * thousandth of a block.
 */
export function placeAt(model: LoadedModel, object: string, point: Vec3): Vec3 {
  const face = levelFaceAt(model, object, point);
  if (face !== null && isCushion(face)) return middleOf(face);
  return [free(point[0]), face?.y ?? free(point[1]), free(point[2])];
}

const SPOTS = new WeakMap<LoadedModel, Vec3[]>();

/** The middles of the model's cushions — the small level faces facing up of the parts it draws — that a dragged chair snaps to; made once a model. */
export function spotsOf(model: LoadedModel | null): readonly Vec3[] {
  if (model === null) return [];
  let spots = SPOTS.get(model);
  if (spots === undefined) {
    spots = [];
    for (const [object, triangles] of levelTriangles(model.parts.filter((part) => part.drawn))) {
      for (const face of facesOf(object, triangles).faces) if (face.up && isCushion(face)) spots.push(middleOf(face));
    }
    SPOTS.set(model, spots);
  }
  return spots;
}
