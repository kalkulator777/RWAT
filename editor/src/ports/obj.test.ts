/**
 * Golden runner of fixtures/golden/obj/ (editor.md §4.5; fixtures/golden/README.md): the
 * port ./obj.ts against `ObjLoader.loadModel` and `ObjectRole.objectName`, the reference
 * that writes the expected. Everything of the folder is compared: object names, parts
 * (object, material, every corner of every quad) or the refusal, the `mtllib` files, and
 * the example pack's models in short (as ObjGolden sums them up).
 *
 * The loader reads its numbers with its own `Float.parseFloat` (./obj.ts
 * `parseJavaFloat`), so that is checked against every case of
 * fixtures/golden/java_numbers/parse_float.json as well — the folder's runner is
 * ports/javaNumbers.test.ts; this only borrows its cases.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GOLDEN_DIR, REPO_ROOT } from '../testing/repo.node';
import { mismatch, readGoldenFolder } from '../testing/goldenCases.node';
import { CORNER_FLOATS, DEFAULT_OBJECT, loadModel, ObjError, objectName, parseJavaFloat, parseJavaInt, QUAD_FLOATS, type ObjPart } from './obj';

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

describe('the loader’s Float.parseFloat against java_numbers/parse_float.json', () => {
  const file = JSON.parse(readFileSync(`${GOLDEN_DIR}/java_numbers/parse_float.json`, 'utf8')) as {
    tolerance: number;
    cases: { id: string; note: string; input: { text: string }; expected: unknown }[];
  };
  for (const c of file.cases) {
    it(c.id, () => {
      expect(mismatch(parseJavaFloat(c.input.text), c.expected, file.tolerance), c.note).toBeNull();
    });
  }

  it('rounds a decimal that a double puts half-way between two floats by its exact value', () => {
    // 1 + 2^-24 is the midpoint of 1 and 1 + 2^-23; the decimals around it round to it as doubles
    expect(parseJavaFloat('1.00000005960464477539062500000001')).toBe(1.0000001192092896);
    expect(parseJavaFloat('1.00000005960464477539062499999999')).toBe(1);
    expect(parseJavaFloat('-1.00000005960464477539062500000001f')).toBe(-1.0000001192092896);
    // half-way between the largest float and 2^128: to even, that is Infinity; just below it, the largest float
    expect(parseJavaFloat('340282356779733661637539395458142568448')).toBe(Infinity);
    expect(parseJavaFloat('340282356779733661637539395458142568447.9999999999')).toBe(Math.fround(3.4028234663852886e38));
    // half the smallest float: to even, 0; a hair more, the smallest float
    expect(parseJavaFloat('7.006492321624085354618647916449580656401309709382578858785341419448955413429303e-46')).toBe(0);
    expect(parseJavaFloat('7.0064923216240853546186479164495806564013097093825788587853414194489554134293031e-46')).toBe(2 ** -149);
  });

  it('reads hexadecimal floats to the nearest float, past the range to Infinity or 0', () => {
    expect(parseJavaFloat('0x1.000001p0')).toBe(1); // half-way: to even
    expect(parseJavaFloat('0x1.0000011p0')).toBe(1.0000001192092896);
    expect(parseJavaFloat('-0x1.8p-1d')).toBe(-0.75);
    expect(parseJavaFloat('0x0p99999999999')).toBe(0);
    expect(parseJavaFloat('0x1p128')).toBe(Infinity);
    expect(parseJavaFloat('0x1p-150')).toBe(0);
    expect(parseJavaFloat('0x1.0001p-150')).toBe(2 ** -149);
    expect(parseJavaFloat('0x1p-151')).toBe(0);
    expect(parseJavaFloat('0x1p-149')).toBe(2 ** -149);
    expect(parseJavaFloat('0x1p99999999999')).toBe(Infinity);
    expect(parseJavaFloat('0x1p')).toBeNull();
  });

  it('keeps the sign of zero and drops blanks only around the number', () => {
    expect(Object.is(parseJavaFloat('-0'), -0)).toBe(true);
    expect(Object.is(parseJavaFloat(' -0.0f '), -0)).toBe(true);
    expect(parseJavaFloat('\u00011.5\u001f')).toBe(1.5);
    expect(parseJavaFloat('-NaN')).toBeNaN();
  });
});

describe('the loader’s Integer.parseInt', () => {
  it('takes a sign and decimal digits, Unicode ones too, and refuses the rest and past the int range', () => {
    expect(parseJavaInt('12')).toBe(12);
    expect(parseJavaInt('+7')).toBe(7);
    expect(parseJavaInt('-3')).toBe(-3);
    expect(parseJavaInt('١٢')).toBe(12); // Arabic-Indic digits
    expect(parseJavaInt('３')).toBe(3); // a full-width digit
    expect(parseJavaInt('2147483647')).toBe(2147483647);
    expect(parseJavaInt('-2147483648')).toBe(-2147483648);
    for (const refused of ['', '+', '-', '2147483648', '-2147483649', '99999999999', '1.0', ' 1', '1e2', '²', '𝟎']) {
      expect(parseJavaInt(refused), refused).toBeNull();
    }
  });
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
