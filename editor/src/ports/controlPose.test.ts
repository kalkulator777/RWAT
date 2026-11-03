/**
 * Golden runner of fixtures/golden/control_pose/ (editor.md §4.5; fixtures/golden/README.md):
 * the editor's `controlValue`, `controlVisible` and `controlTransform` (./controlPose.ts)
 * against Java's `ControlValue.value`, `visible` and `ControlPose.transform`, the
 * reference that writes the expected. A case gives a control's name, its raw position and
 * its hinge (pivot and unit axis, OBJ frame; none: no turn); the expected is the value, the
 * visibility and the transform as 16 floats row by row.
 */

import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../testing/repo.node';
import { mismatch, readGoldenFolder, readGoldenPorts } from '../testing/goldenCompare.node';
import { controlTransform, controlValue, controlVisible, rowMajor, type Vec3 } from './controlPose';
import { parseRole } from './objectRole';

const FOLDER = `${REPO_ROOT}fixtures/golden/control_pose`;

interface Input {
  name: string;
  position: number;
  pivot?: Vec3;
  axis?: Vec3;
}

function pose(input: Input): Record<string, unknown> {
  const role = parseRole(input.name);
  const control = role.control;
  if (control === null) throw new Error(`${input.name} is no control`);
  const value = controlValue(control, input.position);
  return {
    value,
    visible: controlVisible(control, input.position),
    transform: rowMajor(controlTransform(value, control.slide, input.pivot ?? null, input.axis ?? [0, 1, 0], role.pivotDegrees ?? 0)),
  };
}

describe('golden control_pose', () => {
  const files = readGoldenFolder(FOLDER);

  it('names this port in ports.json and has cases', () => {
    expect(readGoldenPorts(FOLDER)).toMatchObject({ reference: 'java', ports: expect.arrayContaining(['ts']) as unknown });
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(file.cases.length, file.name).toBeGreaterThanOrEqual(10);
  });

  for (const file of files) {
    describe(file.name, () => {
      for (const c of file.cases) {
        it(c.id, () => {
          expect(mismatch(pose(c.input as Input), c.expected, file.tolerance), c.note).toBeNull();
        });
      }
    });
  }
});

describe('controlTransform beyond the golden cases', () => {
  it('is a pure slide without a hinge or a swing', () => {
    expect(controlTransform(0.5, [2, 4, 6], null, [0, 1, 0], 90)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1]);
    expect(controlTransform(1, [0, 0, 0], [1, 1, 1], [0, 1, 0], 0)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  });

  it('turns a point on the hinge into itself', () => {
    const m = controlTransform(1, [0, 0, 0], [1, 2, 3], [0, 0, 1], 90);
    const [px, py, pz] = [1, 2, 3];
    const out = [
      (m[0] ?? 0) * px + (m[4] ?? 0) * py + (m[8] ?? 0) * pz + (m[12] ?? 0),
      (m[1] ?? 0) * px + (m[5] ?? 0) * py + (m[9] ?? 0) * pz + (m[13] ?? 0),
      (m[2] ?? 0) * px + (m[6] ?? 0) * py + (m[10] ?? 0) * pz + (m[14] ?? 0),
    ];
    expect(out[0]).toBeCloseTo(1, 6);
    expect(out[1]).toBeCloseTo(2, 6);
    expect(out[2]).toBeCloseTo(3, 6);
  });
});
