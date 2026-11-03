import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../core/contracts';
import { controlTransform, rowMajor } from '../ports/controlPose';
import { point } from '../ports/objFrame';
import { parseRole } from '../ports/objectRole';
import { columnMajor, movingMatrix, objDirection, objPoint } from './pose';
import type { ModelControl } from '../ports/modelParts';

function part(pivot: Vec3 | null, axis: Vec3, degrees: number, slide: Vec3): ModelControl {
  return { role: parseRole('THROTTLE_1').control!, interior: false, pivot, axis, degrees, slide, boxMin: [0, 0, 0], boxMax: [0, 0, 0] };
}

/** Column-major 4×4 times a point. */
function apply(m: ArrayLike<number>, p: Vec3): Vec3 {
  return [
    m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!,
    m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!,
    m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!,
  ];
}

describe('the frames', () => {
  it('turns model-frame points and directions back into the OBJ frame', () => {
    expect(objPoint(point(1, 2, 3))).toEqual([1, 2, 3]);
    expect(objDirection([0, 0, 1])).toEqual([-1, 0, 0]); // model forward is OBJ −X
    expect(objDirection([1, 0, 0])).toEqual([0, 0, 1]); // model +X (left) is OBJ +Z
    expect(objDirection([0, 1, 0])).toEqual([0, 1, 0]);
  });
});

describe('a moving part’s matrix', () => {
  it('is the engine’s motion in the model frame, told in the OBJ frame', () => {
    const pivot: Vec3 = [0.3, 2.9, -1.05];
    const axis: Vec3 = [-0.6, 0, 0.8];
    const slide: Vec3 = [0.1, -0.2, 0.4];
    const model = controlTransform(0.7, slide, pivot, axis, -50); // the engine, model frame
    const obj = movingMatrix(part(pivot, axis, -50, slide), 0.7); // the preview, OBJ frame
    for (const p of [[0, 0, 0], [1, 2, 3], [-4, 0.5, 2]] as Vec3[]) {
      const viaModel = objPoint(apply(model, point(p[0], p[1], p[2])));
      const viaObj = apply(obj, p);
      for (let i = 0; i < 3; i++) expect(viaObj[i]).toBeCloseTo(viaModel[i]!, 5);
    }
  });

  it('only slides without a hinge', () => {
    const m = movingMatrix(part(null, [0, 1, 0], 90, [0, 0, -0.95]), 1);
    expect(Array.from(m)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, Math.fround(0.95), 0, 0, 1]);
  });
});

describe('columnMajor', () => {
  it('is the transpose of a row-by-row frame', () => {
    const rows = Array.from({ length: 16 }, (_, i) => i);
    expect(Array.from(columnMajor(rows))).toEqual(rowMajor(rows));
    expect(Array.from(columnMajor(columnMajor(rows)))).toEqual(rows);
  });
});
