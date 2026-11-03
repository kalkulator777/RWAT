/**
 * Golden runner of fixtures/golden/obj_frame/ (editor.md §4.5; fixtures/golden/README.md):
 * ./objFrame against `stock/ObjFrame.java`, the reference that writes the expected —
 * points and boxes from the OBJ frame to the model frame and back.
 */

import { describe, expect, it } from 'vitest';
import { mismatch, readGoldenFolder } from '../testing/golden.node';
import { REPO_ROOT } from '../testing/repo.node';
import { box, boxToObj, point, toObj, Y_LIFT } from './objFrame';

const FOLDER = `${REPO_ROOT}fixtures/golden/obj_frame`;

const golden = readGoldenFolder(FOLDER);

describe('golden obj_frame', () => {
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

// ---- what the port makes of an input, laid out as ObjFrameGolden lays the engine's

interface Input {
  point_obj?: [number, number, number];
  point_model?: [number, number, number];
  box_obj?: { min: number[]; max: number[] };
  box_model?: { min: number[]; max: number[] };
}

function sixToBox(b: readonly number[]): { min: number[]; max: number[] } {
  return { min: b.slice(0, 3), max: b.slice(3, 6) };
}

function compute(input: Input): unknown {
  if (input.point_obj !== undefined) return { model: point(...input.point_obj) };
  if (input.point_model !== undefined) return { obj: toObj(...input.point_model) };
  if (input.box_obj !== undefined) return { model: sixToBox(box(input.box_obj.min, input.box_obj.max)) };
  const back = input.box_model as { min: number[]; max: number[] };
  return { obj: boxToObj(back.min, back.max) };
}

describe('objFrame', () => {
  it('lifts the wheel tread onto the railhead', () => {
    expect(Y_LIFT).toBe(0.43625);
  });

  it('turns a box there and back to the same corners', () => {
    const turned = box([-4, 0.5, -1], [4, 2.5, 1]);
    expect(boxToObj(turned.slice(0, 3), turned.slice(3))).toEqual({ min: [-4, 0.5, -1], max: [4, 2.5, 1] });
  });
});
