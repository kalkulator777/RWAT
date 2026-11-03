/**
 * An OBJ's text → the {@link LoadedModel} the objects tab lists: the interim stand-in for
 * the model worker (A3.1, `editor/src/model/**`), which hands the tab the same type with
 * roles of `ports/modelParts`. Pure, no DOM; textures are not decoded (`textures` is
 * empty), the tab does not draw.
 *
 * Triangles: a quad is two triangles, a quad with its last corner twice (how `ports/obj`
 * keeps a triangle) one. `bbox` is in the OBJ frame, the frame the file is written in.
 */

import type { LoadedModel, ObjectInfo, PartBuffers, Vec3 } from '../../core/contracts';
import { emptyModel } from '../../model/build';
import { NO_LIGHT, type Place } from '../../ports/modelParts';
import { CORNER_FLOATS, QUAD_FLOATS, loadModel, type ObjModel, type ObjPart } from '../../ports/obj';
import { door, parseRole } from '../../ports/objectRole';
import { classifyParts, type ClassifyContext } from './classify';

export interface BuildInput {
  /** The model's id for links: the wagon's `namespace:id`. */
  id: string;
  /** The OBJ's text, or the OBJ already read by `ports/obj`. */
  obj: string | ObjModel;
  /** The model declaration's `skip` prefixes. */
  skip?: readonly string[];
  /** The names the model's `.anim` files move. */
  animObjects?: ReadonlySet<string>;
  /** The materials with a texture; null when it is not known, then every material counts as textured. */
  texturedMaterials?: ReadonlySet<string> | null;
}

/** What building gives the tab besides the model: what it needs to say a texture is there. */
export interface BuiltModel {
  model: LoadedModel;
  /** The materials with a texture; null when unknown. */
  texturedMaterials: ReadonlySet<string> | null;
  /** The declaration's `skip` prefixes, which the explanation of a dropped object names. */
  skip: readonly string[];
}

/** The engine's place of a role this reading gives. */
const PLACE: Readonly<Record<string, Place>> = {
  hidden: 'HIDDEN',
  skip: 'SKIPPED',
  untextured: 'UNTEXTURED',
  body: 'BODY',
  interior: 'INTERIOR',
  bogie_front: 'BOGIE',
  bogie_rear: 'BOGIE',
  wheelset: 'WHEEL',
  anim_object: 'ANIMATED',
  door_leaf: 'DOOR_LEAF',
  control: 'CONTROL',
  coupler_head: 'COUPLER',
};

/** The triangles of a part's quads: positions, normals, uvs, three corners each. */
function buffers(part: ObjPart, role: string): PartBuffers {
  const quads = part.quads.length / QUAD_FLOATS;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const corner = (quad: number, at: number): void => {
    const o = quad * QUAD_FLOATS + at * CORNER_FLOATS;
    const q = part.quads;
    positions.push(q[o]!, q[o + 1]!, q[o + 2]!);
    uvs.push(q[o + 3]!, q[o + 4]!);
    normals.push(q[o + 5]!, q[o + 6]!, q[o + 7]!);
  };
  for (let quad = 0; quad < quads; quad++) {
    corner(quad, 0);
    corner(quad, 1);
    corner(quad, 2);
    const o = quad * QUAD_FLOATS;
    const q = part.quads;
    const same = [0, 1, 2].every((i) => q[o + 2 * CORNER_FLOATS + i] === q[o + 3 * CORNER_FLOATS + i]);
    if (!same) {
      corner(quad, 0);
      corner(quad, 2);
      corner(quad, 3);
    }
  }
  return {
    object: part.object,
    material: part.material,
    texture: null,
    role,
    drawn: role !== 'hidden' && role !== 'skip' && role !== 'untextured',
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    uvs: Float32Array.from(uvs),
  };
}

/** [min, max] of the points, or a zero box for none. */
function boxOf(parts: readonly PartBuffers[]): [Vec3, Vec3] {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    for (let i = 0; i < part.positions.length; i += 3) {
      for (let axis = 0; axis < 3; axis++) {
        const value = part.positions[i + axis]!;
        if (value < min[axis]!) min[axis] = value;
        if (value > max[axis]!) max[axis] = value;
      }
    }
  }
  return min[0] === Infinity ? [[0, 0, 0], [0, 0, 0]] : [min, max];
}

/** Builds the model of an OBJ's text. Throws {@link import('../../ports/obj').ObjError} for a file the engine refuses. */
export function buildLoadedModel(input: BuildInput): BuiltModel {
  const parsed = typeof input.obj === 'string' ? loadModel(input.obj) : input.obj;
  const textured = input.texturedMaterials ?? null;
  const skip = input.skip ?? [];
  const context: ClassifyContext = { skip, animObjects: input.animObjects ?? new Set() };
  const isTextured = (material: string): boolean => textured === null || textured.has(material);
  const roles = classifyParts(
    parsed.parts.map((part) => ({ object: part.object, textured: isTextured(part.material) })),
    context,
  );

  const parts = parsed.parts.map((part, at) => buffers(part, roles[at]!));
  const byObject = new Map<string, { parts: PartBuffers[]; roles: string[] }>();
  parts.forEach((part, at) => {
    const entry = byObject.get(part.object) ?? { parts: [], roles: [] };
    entry.parts.push(part);
    entry.roles.push(roles[at]!);
    byObject.set(part.object, entry);
  });

  const objects: ObjectInfo[] = [...byObject].map(([name, entry]) => {
    // an object is untextured only when all its parts are; otherwise the role of its drawn parts
    const drawn = entry.roles.find((role) => role !== 'untextured') ?? entry.roles[0]!;
    const control = door(name)?.control ?? parseRole(name).control;
    const engine = { place: PLACE[drawn] ?? 'BODY', front: drawn === 'bogie_front', owner: null, index: -1, light: NO_LIGHT };
    const object: ObjectInfo = { name, role: drawn, engine, bbox: boxOf(entry.parts) };
    if (control !== null && control !== undefined) object.control = control;
    const lightGroup = parseRole(name).lightGroup;
    if (lightGroup !== null) object.lightGroup = lightGroup;
    return object;
  });

  return { model: { ...emptyModel(input.id, ''), parts, objects }, texturedMaterials: textured, skip };
}
