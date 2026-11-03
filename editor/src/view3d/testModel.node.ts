/**
 * Node only (tests of view3d): models for the view. The example pack's are read by the
 * model pipeline as the model worker reads them (model/testing.node: the engine's roles of
 * ports/modelParts, the textures found as the game finds them, stood in for); small ones
 * are boxes, one object each, with the role given.
 */

import type { LoadedModel, ObjectInfo, PartBuffers, Vec3 } from '../core/contracts';
import { emptyModel } from '../model/build';
import { NO_LIGHT, type Place } from '../ports/modelParts';

export { exampleModel } from '../model/testing.node';

/** The engine's place of a part of a role, as far as the view's tests care. */
const PLACE_OF_ROLE: Readonly<Record<string, Place>> = {
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

/** True for the roles the engine does not draw. */
function dropped(role: string): boolean {
  return role === 'hidden' || role === 'skip' || role === 'untextured';
}

/** A box as one part of `object`: twelve triangles facing out, normals per face, UVs 0…1 on each face. */
export function boxPart(object: string, min: Vec3, max: Vec3, options: { material?: string; texture?: string | null; role?: string } = {}): PartBuffers {
  const role = options.role ?? 'body';
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
    material: options.material ?? 'm',
    texture: options.texture ?? null,
    role,
    drawn: !dropped(role),
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
  };
}

/** The object of a box part, its role the part's. */
export function boxObject(part: PartBuffers, min: Vec3, max: Vec3): ObjectInfo {
  return {
    name: part.object,
    role: part.role,
    engine: { place: PLACE_OF_ROLE[part.role] ?? 'BODY', front: part.role === 'bogie_front', owner: null, index: -1, light: NO_LIGHT },
    bbox: [min, max],
  };
}

/** A model of boxes: `[object, role, min, max]` each, a part and an object a box. */
export function boxModel(id: string, boxes: readonly (readonly [string, string, Vec3, Vec3])[]): LoadedModel {
  const parts = boxes.map(([object, role, min, max]) => boxPart(object, min, max, { role }));
  return { ...emptyModel(id, `assets/test/wagon_models/${id}.json`), parts, objects: parts.map((part, i) => boxObject(part, boxes[i]![2], boxes[i]![3])) };
}
