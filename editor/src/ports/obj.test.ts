/**
 * Golden runner of fixtures/golden/obj/ (editor.md §4.5; fixtures/golden/README.md): the
 * port ./obj.ts against `ObjLoader.loadModel` and `ObjectRole.objectName`, the reference
 * that writes the expected. Everything of the folder is compared: object names, parts
 * (object, material, every corner of every quad) or the refusal, the `mtllib` files, and
 * the example pack's models in short (as ObjGolden sums them up). The loader reads its
 * numbers with ./javaNumbers.ts, whose runner is ports/javaNumbers.test.ts.
 */

import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../testing/repo.node';
import { mismatch, readGoldenFolder } from '../testing/golden.node';
import { CORNER_FLOATS, DEFAULT_OBJECT, loadModel, ObjError, objectName, QUAD_FLOATS, type ObjPart } from './obj';

const FOLDER = `${REPO_ROOT}fixtures/golden/obj`;

interface Input {
  line?: string;
  text?: string;
  summary?: boolean;
}

/** A part's quads as the Java runner writes them: each quad four corners of eight numbers. */
function quads(part: ObjPart): number[][][] {
  const out: number[][][] = [];
  for (let q = 0; q < part.quads.length; q += QUAD_FLOATS) {
    const quad: number[][] = [];
    for (let c = 0; c < 4; c++) quad.push(Array.from(part.quads.subarray(q + c * CORNER_FLOATS, q + (c + 1) * CORNER_FLOATS)));
    out.push(quad);
  }
  return out;
}

/** ObjGolden.summary: how many quads (of them triangles: the last corner twice), the box of the corners, the first quad. */
function summary(part: ObjPart): unknown {
  const all = quads(part);
  const max = Math.fround(3.4028234663852886e38);
  const lo = [max, max, max];
  const hi = [-max, -max, -max];
  let triangles = 0;
  for (const quad of all) {
    // Mesh.Vertex is a record: its floats compare as Float.compare does (Object.is)
    if (quad[2]!.every((v, i) => Object.is(v, quad[3]![i]))) triangles++;
    for (const corner of quad) {
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a]!, corner[a]!);
        hi[a] = Math.max(hi[a]!, corner[a]!);
      }
    }
  }
  return { count: all.length, triangles, min: lo, max: hi, first: all[0]!.map((corner) => corner.slice(0, 3)) };
}

/** What the port makes of a case's input, as ObjGolden asks it. */
function compute(input: Input): unknown {
  if (input.line !== undefined) return objectName(input.line);
  let model;
  try {
    model = loadModel(input.text!);
  } catch (e) {
    if (e instanceof ObjError) return { error: true };
    throw e;
  }
  return {
    libraries: model.materialLibraries,
    parts: model.parts.map((part) => ({ object: part.object, material: part.material, quads: input.summary === true ? summary(part) : quads(part) })),
  };
}

const golden = readGoldenFolder(FOLDER);

describe('golden obj', () => {
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

describe('loadModel beyond the golden cases', () => {
  const square = 'v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\n';

  it('takes a lone CR as a line end and Unicode digits as indices, as Java reads them', () => {
    const model = loadModel(`${square.replaceAll('\n', '\r')}o A\rf ١ ٢ ٣\r`);
    expect(model.parts.map((p) => [p.object, p.quads.length])).toEqual([['A', QUAD_FLOATS]]);
  });

  it('parts a line at Java’s blanks only: another control character stays in the token', () => {
    expect(() => loadModel(`${square}f 1\u001c2 3 4\n`)).toThrow(ObjError);
  });

  it('refuses a corner with no vertex index, a vt of one number, and names the line', () => {
    expect(() => loadModel(`${square}f / 2 3\n`)).toThrow(/line 5/);
    expect(() => loadModel(`${square}vt 0.5\nf 1/1 2/1 3/1\n`)).toThrow(ObjError);
    expect(() => loadModel(`${square}f 1//2 2 3\n`)).toThrow(ObjError);
    expect(() => loadModel(`${square}f 0 1 2\n`)).toThrow(ObjError);
  });

  it('skips what follows the third index and the coordinates past the third', () => {
    const model = loadModel(`v 0 0 0 1\nv 1 0 0 1\nv 1 1 0 1\nvn 0 0 1\nf 1//1/x 2//1/y 3//1/z\n`);
    expect(Array.from(model.parts[0]!.quads.subarray(0, CORNER_FLOATS))).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
  });

  it('keeps a mtllib that names nothing, as the engine does', () => {
    expect(loadModel('mtllib\n').materialLibraries).toEqual(['']);
  });

  it('grows past its first buffers', () => {
    const lines: string[] = [];
    for (let i = 0; i < 3000; i++) lines.push(`v ${i} 0 0`, `vt ${i} 1`, `vn 0 1 0`);
    for (let i = 1; i <= 2997; i++) lines.push(`f ${i}/${i}/${i} ${i + 1}/${i + 1}/${i + 1} ${i + 2}/${i + 2}/${i + 2} ${i + 3}/${i + 3}/${i + 3}`);
    lines.push(`f ${Array.from({ length: 40 }, (_, i) => i + 1).join(' ')}`);
    const model = loadModel(lines.join('\n'));
    expect(model.parts).toHaveLength(1);
    expect(model.parts[0]!.object).toBe(DEFAULT_OBJECT);
    expect(model.parts[0]!.quads.length).toBe((2997 + 38) * QUAD_FLOATS);
    expect(model.parts[0]!.quads[(2996 * 4 + 3) * CORNER_FLOATS]).toBe(2999);
  });
});
