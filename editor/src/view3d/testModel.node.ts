/**
 * Node only (tests of view3d and its Playwright tests): models for the view, built the way
 * the model worker will build them, before it is wired in (docs/proposals/editor.md §3.11,
 * M3: the worker is A3.1's). The OBJ is read by the port ports/obj, the textures found by
 * ports/mtl; the roles and light groups of the example pack's models are those the engine
 * gives their parts, from the golden `model_parts` (Java's `ModelParts`), so the view is
 * painted as the worker's roles will paint it.
 *
 * What the contract does not carry yet, a part's texture, is given as an extra field
 * `texture` (the pack path of its `map_Kd`, null for a material without one): the view
 * reads it when it is there (./modelScene.ts `textureOf`).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LoadedModel, ObjectInfo, PartBuffers, Vec3 } from '../core/contracts';
import { folderOf, parse as parseMtl, resolve as resolvePath } from '../ports/mtl';
import { CORNER_FLOATS, loadModel, QUAD_FLOATS } from '../ports/obj';
import { EXAMPLE_PACK, GOLDEN_DIR } from '../testing/repo.node';

/** A part with the pack path of its texture, as the view takes it (null: the material has none). */
export interface TexturedPart extends PartBuffers {
  texture: string | null;
}

/** A model whose parts carry their texture. */
export interface TestModel extends LoadedModel {
  parts: TexturedPart[];
}

/** The example pack's wagons that have a model. */
export type ExampleWagon = 'coach' | 'gondola' | 'shunter';

const NAMESPACE = 'rwat_example';

/** Where the engine puts a part (golden `model_parts`, `place`) → the role of schema/obj-conventions.json. */
const ROLE_OF_PLACE: Readonly<Record<string, string>> = {
  HIDDEN: 'hidden',
  SKIPPED: 'skip',
  UNTEXTURED: 'untextured',
  BODY: 'body',
  INTERIOR: 'interior',
  WHEEL: 'wheelset',
  ANIMATED: 'anim_object',
  DOOR_LEAF: 'door_leaf',
  CONTROL: 'control',
  COUPLER: 'coupler_head',
};

/** The part's triangles from the port's quads: a quad is two, a triangle (a quad with its last corner twice) one. V back as the OBJ has it. */
function triangles(quads: Float32Array): { positions: Float32Array; normals: Float32Array; uvs: Float32Array } {
  const corners: number[] = [];
  for (let q = 0; q < quads.length; q += QUAD_FLOATS) {
    const at = (i: number) => q + i * CORNER_FLOATS;
    const sameLast = [0, 1, 2, 3, 4, 5, 6, 7].every((k) => quads[at(2) + k] === quads[at(3) + k]);
    corners.push(at(0), at(1), at(2));
    if (!sameLast) corners.push(at(0), at(2), at(3));
  }
  const positions = new Float32Array(corners.length * 3);
  const normals = new Float32Array(corners.length * 3);
  const uvs = new Float32Array(corners.length * 2);
  corners.forEach((c, i) => {
    positions.set([quads[c] ?? 0, quads[c + 1] ?? 0, quads[c + 2] ?? 0], i * 3);
    // the port gives v as Minecraft samples it (1 − v); the view takes the OBJ's own
    uvs.set([quads[c + 3] ?? 0, 1 - (quads[c + 4] ?? 0)], i * 2);
    normals.set([quads[c + 5] ?? 0, quads[c + 6] ?? 1, quads[c + 7] ?? 0], i * 3);
  });
  return { positions, normals, uvs };
}

/**
 * The parts of an OBJ as the view takes them. `materials` gives a material's texture as
 * a pack path; a material it lacks has none.
 */
export function partsOf(objText: string, materials: ReadonlyMap<string, string> = new Map()): TexturedPart[] {
  return loadModel(objText).parts.map((part) => ({
    object: part.object,
    material: part.material,
    texture: materials.get(part.material) ?? null,
    ...triangles(part.quads),
  }));
}

/** Each object once, in the order of its first part, with its role, light group and bounding box. */
export function objectsOf(
  parts: readonly PartBuffers[],
  roleOf: (object: string) => string = () => 'body',
  lightGroupOf: (object: string) => string | undefined = () => undefined,
): ObjectInfo[] {
  const boxes = new Map<string, [Vec3, Vec3]>();
  for (const part of parts) {
    const box = boxes.get(part.object) ?? [
      [Infinity, Infinity, Infinity],
      [-Infinity, -Infinity, -Infinity],
    ];
    for (let i = 0; i < part.positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = part.positions[i + k] as number;
        box[0][k] = Math.min(box[0][k] as number, v);
        box[1][k] = Math.max(box[1][k] as number, v);
      }
    }
    boxes.set(part.object, box);
  }
  return [...boxes].map(([name, bbox]) => {
    const info: ObjectInfo = { name, role: roleOf(name), bbox };
    const group = lightGroupOf(name);
    if (group !== undefined) info.lightGroup = group;
    return info;
  });
}

interface GoldenPart {
  object: string;
  place: string;
  front: boolean;
  light: [number, boolean, boolean, boolean];
}

/** The engine's parts of an example wagon (golden `model_parts`, case `example-pack-<id>`). */
function goldenParts(id: ExampleWagon): { parts: GoldenPart[]; groups: string[] } {
  const file = JSON.parse(readFileSync(join(GOLDEN_DIR, 'model_parts', 'parts.json'), 'utf8')) as {
    cases: { id: string; expected: { parts: GoldenPart[]; light_groups: string[] } }[];
  };
  const found = file.cases.find((c) => c.id === `example-pack-${id}`);
  if (found === undefined) throw new Error(`golden model_parts has no case example-pack-${id}`);
  return { parts: found.expected.parts, groups: found.expected.light_groups };
}

/** The pack path of an example wagon's file inside its stock folder. */
export function examplePath(id: ExampleWagon, file: string): string {
  return `assets/${NAMESPACE}/stock/${id}/${file}`;
}

/** The bytes of a file of the example pack. */
export function exampleFile(path: string): Buffer {
  return readFileSync(join(EXAMPLE_PACK, path));
}

/**
 * An example wagon's model as the view gets it: parts with textures, objects with the
 * engine's roles and light groups. `textures` lists every texture the parts use, as null
 * (Node decodes no images; the Playwright test decodes them in the page).
 */
export function exampleModel(id: ExampleWagon): TestModel {
  const objPath = examplePath(id, `${id}.obj`);
  const folder = folderOf(objPath);
  const materials = new Map<string, string>();
  for (const [name, map] of parseMtl(exampleFile(examplePath(id, `${id}.mtl`)).toString('utf8'))) {
    const path = resolvePath(folder, map);
    if (path !== null) materials.set(name, path);
  }
  const parts = partsOf(exampleFile(objPath).toString('utf8'), materials);
  const golden = goldenParts(id);
  if (golden.parts.length !== parts.length || golden.parts.some((g, i) => g.object !== parts[i]?.object)) {
    throw new Error(`golden model_parts and the OBJ of ${id} list different parts`);
  }
  const roles = new Map<string, string>();
  const groups = new Map<string, string>();
  golden.parts.forEach((g) => {
    const role = g.place === 'BOGIE' ? (g.front ? 'bogie_front' : 'bogie_rear') : (ROLE_OF_PLACE[g.place] ?? 'body');
    // an object's role is that of its drawn parts; untextured only if none is drawn
    if (!roles.has(g.object) || roles.get(g.object) === 'untextured') roles.set(g.object, role);
    const group = golden.groups[g.light[0]];
    if (group !== undefined) groups.set(g.object, group);
  });
  const textures: Record<string, ImageBitmap | null> = {};
  for (const part of parts) if (part.texture !== null) textures[part.texture] = null;
  return {
    id: `${NAMESPACE}:${id}`,
    parts,
    objects: objectsOf(parts, (name) => roles.get(name) ?? 'body', (name) => groups.get(name)),
    textures,
    problems: [],
  };
}

/** A box as one part of `object`: twelve triangles facing out, normals per face, UVs 0…1 on each face. */
export function boxPart(object: string, min: Vec3, max: Vec3, material = 'm', texture: string | null = null): TexturedPart {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const faces: { n: Vec3; corners: Vec3[] }[] = [
    { n: [1, 0, 0], corners: [[max[0], min[1], max[2]], [max[0], min[1], min[2]], [max[0], max[1], min[2]], [max[0], max[1], max[2]]] },
    { n: [-1, 0, 0], corners: [[min[0], min[1], min[2]], [min[0], min[1], max[2]], [min[0], max[1], max[2]], [min[0], max[1], min[2]]] },
    { n: [0, 1, 0], corners: [[min[0], max[1], max[2]], [max[0], max[1], max[2]], [max[0], max[1], min[2]], [min[0], max[1], min[2]]] },
    { n: [0, -1, 0], corners: [[min[0], min[1], min[2]], [max[0], min[1], min[2]], [max[0], min[1], max[2]], [min[0], min[1], max[2]]] },
    { n: [0, 0, 1], corners: [[min[0], min[1], max[2]], [max[0], min[1], max[2]], [max[0], max[1], max[2]], [min[0], max[1], max[2]]] },
    { n: [0, 0, -1], corners: [[max[0], min[1], min[2]], [min[0], min[1], min[2]], [min[0], max[1], min[2]], [max[0], max[1], min[2]]] },
  ];
  const square: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  for (const face of faces) {
    for (const i of [0, 1, 2, 0, 2, 3]) {
      positions.push(...(face.corners[i] as Vec3));
      normals.push(...face.n);
      uvs.push(...(square[i] as [number, number]));
    }
  }
  return {
    object,
    material,
    texture,
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
  };
}

/** A model of boxes: `[object, role, min, max]` each. */
export function boxModel(id: string, boxes: readonly (readonly [string, string, Vec3, Vec3])[]): TestModel {
  const parts = boxes.map(([object, , min, max]) => boxPart(object, min, max));
  const roles = new Map(boxes.map(([object, role]) => [object, role]));
  return { id, parts, objects: objectsOf(parts, (name) => roles.get(name) ?? 'body'), textures: {}, problems: [] };
}
