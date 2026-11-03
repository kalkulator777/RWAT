/**
 * Golden runner of fixtures/golden/pivot_axis/ (editor.md §4.5; fixtures/golden/README.md):
 * the port ./pivotAxis.ts against `convention.PivotAxis`, the reference that writes the
 * expected. Everything of the folder is compared: how many distinct points, the hinge,
 * the axis. The corners come as written (`corners`, read as floats by the port) or from
 * the text of an OBJ (`obj`, `object`): the corners ./obj.ts keeps of every face of every
 * part of that object, in order — what the control builder hands PivotAxis (until
 * `modelParts.ts` does it, M3; as PivotAxisGolden does).
 */

import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../testing/repo.node';
import { mismatch, readGoldenFolder } from '../testing/golden.node';
import { CORNER_FLOATS, loadModel } from './obj';
import { of, points } from './pivotAxis';

const FOLDER = `${REPO_ROOT}fixtures/golden/pivot_axis`;

interface Input {
  corners?: (number | string)[][];
  obj?: string;
  object?: string;
}

/** Every corner of every face of every part of `object`, in order, as the loader keeps them. */
function cornersOf(obj: string, object: string): number[][] {
  const corners: number[][] = [];
  for (const part of loadModel(obj).parts) {
    if (part.object !== object) continue;
    for (let at = 0; at < part.quads.length; at += CORNER_FLOATS) corners.push(Array.from(part.quads.subarray(at, at + 3)));
  }
  if (corners.length === 0) throw new Error(`no faces of ${object}`);
  return corners;
}

/** What the port makes of a case's input, as PivotAxisGolden asks it. */
function compute(input: Input): unknown {
  const corners = input.corners !== undefined ? input.corners.map((c) => c.map(Number)) : cornersOf(input.obj!, input.object!);
  const hinge = of(corners);
  return { points: points(corners).length, centre: hinge.centre, axis: hinge.axis };
}

const golden = readGoldenFolder(FOLDER);

describe('golden pivot_axis', () => {
  it('names this port in ports.json, and the folder follows the golden format', () => {
    expect(golden.ports).toMatchObject({ reference: 'java', ports: expect.arrayContaining(['ts']) as unknown });
    expect(golden.problems).toEqual([]);
  });

  for (const file of golden.files) {
    describe(file.name, () => {
      for (const c of file.cases) {
        it(c.id, () => {
          expect(mismatch(compute(c.input as Input), c.expected, file.tolerance), c.note).toBeNull();
        });
      }
    });
  }
});

describe('PivotAxis beyond the golden cases', () => {
  it('has no hinge without a corner', () => {
    expect(() => of([])).toThrow(RangeError);
  });

  it('reads the corners as floats, and takes one NaN position for every NaN', () => {
    expect(points([[0.1, 0, 0], [Math.fround(0.1), 0, 0]])).toEqual([[Math.fround(0.1), 0, 0]]);
    expect(points([[NaN, 0, 0], [NaN, 0, 0], [0, 0, 0]])).toHaveLength(2);
  });
});
