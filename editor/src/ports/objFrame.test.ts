/**
 * Golden runner of fixtures/golden/obj_frame/ (editor.md §4.5; fixtures/golden/README.md):
 * ./objFrame against `stock/ObjFrame.java`, the reference that writes the expected —
 * points and boxes from the OBJ frame to the model frame and back.
 */

import Ajv2020 from 'ajv/dist/2020';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../testing/repo.node';
import { box, boxToObj, point, toObj, Y_LIFT } from './objFrame';

const FOLDER = `${REPO_ROOT}fixtures/golden/obj_frame`;

// ---- the golden case files (one copy per runner until a shared helper takes them over)

interface Case {
  id: string;
  note: string;
  input?: unknown;
  input_file?: string | Record<string, string>;
  expected: unknown;
}

interface CaseFile {
  tolerance: number;
  cases: Case[];
}

const NON_FINITE: Record<string, number> = { NaN: NaN, Infinity: Infinity, '-Infinity': -Infinity };

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

const files = readdirSync(FOLDER)
  .filter((name) => name.endsWith('.json') && name !== 'ports.json')
  .sort();

/** First place where `actual` differs from `expected` (numbers within `tol`, non-finite ones by name), or null. */
function mismatch(actual: unknown, expected: unknown, tol: number, path = '$'): string | null {
  const fail = `${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
  if (typeof expected === 'string' && expected in NON_FINITE) {
    return Object.is(actual, NON_FINITE[expected]) || actual === expected ? null : fail;
  }
  if (typeof expected === 'number') {
    return typeof actual === 'number' && Number.isFinite(actual) && Math.abs(actual - expected) <= tol ? null : fail;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return fail;
    for (let i = 0; i < expected.length; i++) {
      const found = mismatch(actual[i], expected[i], tol, `${path}[${i}]`);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof expected === 'object' && expected !== null) {
    if (typeof actual !== 'object' || actual === null || Array.isArray(actual)) return fail;
    const keys = Object.keys(expected);
    if (JSON.stringify(Object.keys(actual)) !== JSON.stringify(keys)) return `${path}: keys ${JSON.stringify(Object.keys(actual))}, expected ${JSON.stringify(keys)}`;
    for (const key of keys) {
      const found = mismatch((actual as Record<string, unknown>)[key], (expected as Record<string, unknown>)[key], tol, `${path}.${key}`);
      if (found !== null) return found;
    }
    return null;
  }
  return actual === expected ? null : fail;
}

describe('golden obj_frame', () => {
  it('names this port in ports.json, every file follows the golden schema, and there are enough cases', () => {
    expect(readJson(`${FOLDER}/ports.json`)).toMatchObject({ reference: 'java', ports: expect.arrayContaining(['ts']) as unknown });
    const ajv = new Ajv2020({ strict: false });
    const valid = ajv.compile(readJson(`${REPO_ROOT}fixtures/golden/schema.json`) as object);
    let cases = 0;
    for (const name of files) {
      const document = readJson(`${FOLDER}/${name}`);
      expect(valid(document), `${name}: ${ajv.errorsText(valid.errors)}`).toBe(true);
      cases += (document as CaseFile).cases.length;
    }
    expect(cases).toBeGreaterThanOrEqual(10);
  });

  for (const name of files) {
    const file = readJson(`${FOLDER}/${name}`) as CaseFile;
    describe(name, () => {
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
