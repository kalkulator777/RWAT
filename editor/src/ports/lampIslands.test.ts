/**
 * Golden runner of fixtures/golden/lamp_islands/ (editor.md §4.5; fixtures/golden/README.md):
 * the port ./lampIslands.ts against `convention.LampIslands.of`, the reference that writes
 * the expected. Everything of the folder is compared: the lamps, in order. The faces are
 * the case's numbers, four corners each, read as floats by the port.
 */

import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../testing/repo.node';
import { mismatch, readGoldenFolder } from '../testing/golden.node';
import { MIN_LAMP_SIZE, of } from './lampIslands';

const FOLDER = `${REPO_ROOT}fixtures/golden/lamp_islands`;

interface Input {
  faces: (number | string)[][];
}

/** What the port makes of a case's input, as LampIslandsGolden asks it. */
function compute(input: Input): unknown {
  for (const face of input.faces) if (face.length !== 12) throw new Error(`a face is 4 corners, 12 numbers: ${JSON.stringify(face)}`);
  return { lamps: of(input.faces.flat().map(Number)) };
}

const golden = readGoldenFolder(FOLDER);

describe('golden lamp_islands', () => {
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

describe('LampIslands beyond the golden cases', () => {
  /** A flat square face of side `size` at (x, 0, z), its corners in order. */
  const square = (x: number, z: number, size: number): number[] => [x, 0, z, x + size, 0, z, x + size, 0, z + size, x, 0, z + size];

  it('squares the box in float: a line of exactly the float 0.3 falls short, the next float up is a lamp', () => {
    expect(MIN_LAMP_SIZE).toBe(Math.fround(0.3));
    // fround(0.3f · 0.3f) is a hair below 0.09, so its root is below 0.3f (in double the line would be a lamp)
    const line = (s: number): number[] => [0, 0, 0, s, 0, 0, s, 0, 0, s, 0, 0];
    const bits = new Float32Array([MIN_LAMP_SIZE]);
    new Uint32Array(bits.buffer)[0]! += 1;
    const up = bits[0]!;
    expect(of(line(MIN_LAMP_SIZE))).toEqual([]);
    expect(of(line(up))).toEqual([[Math.fround(up * 0.5), 0, 0]]);
  });

  it('rounds a key half up: a corner at −0.00005 meets one at 0, a corner at +0.00005 does not', () => {
    // −0.00005 · 1e4 = −0.5 rounds to 0, as 0 does: one island; +0.5 rounds to 1: two
    expect(of([...square(-0.3, 0, 0.3), ...square(-0.00005, 0, 0.3)])).toHaveLength(1);
    expect(of([...square(-0.3, 0, 0.3), ...square(0.00005, 0, 0.3)])).toHaveLength(2);
  });

  it('rounds a NaN corner to 0 as Java does, so it joins the island at the origin, whose box is then NaN', () => {
    const nanFace = [NaN, 0, 0, NaN, 0, 0, NaN, 0, 0, NaN, 0, 0];
    expect(of(square(0, 0, 0.4))).toHaveLength(1);
    expect(of([...nanFace, ...square(0, 0, 0.4)])).toEqual([]);
  });

  it('leaves out the numbers of a partial face at the end', () => {
    expect(of([...square(0, 0, 0.4), 1, 2, 3])).toEqual([[0.2, 0, 0.2].map(Math.fround)]);
  });
});
