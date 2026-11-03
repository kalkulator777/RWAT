/**
 * The port of `client/render/model/ObjLoader.java` (`loadModel`) and of the object-name
 * rule `convention/ObjectRole.java#objectName`: an OBJ's text → its parts, as the engine
 * splits and stores them. Golden: fixtures/golden/obj/ (reference Java; Python ports
 * the object name in tools/floorgen.py `object_name_of`).
 *
 * - A part is a run of faces of one `o`/`g` object and one `usemtl` material, in file
 *   order; the same object again is another part, an object with no faces makes none.
 * - A quad face stays a quad; a triangle is a quad with its last corner twice; a larger
 *   polygon is fanned from its first corner `(0, i, i + 1)` into such triangles; a face
 *   of fewer than three corners draws nothing.
 * - Each corner is `[x, y, z, u, v, nx, ny, nz]` as floats: `v` is `1 − v` of the file
 *   (Minecraft samples V from the top), 0 with no `vt`; the normal `0 1 0` with no `vn`.
 * - Numbers are read as `Float.parseFloat` reads them, indices as `Integer.parseInt`
 *   (./javaNumbers.ts `parseJavaFloat`, `parseJavaInt`), 1-based and positive only. A
 *   bad number, a missing coordinate or an index outside what was read so far refuses
 *   the whole file ({@link ObjError}), as the engine's exception does.
 * - Names: an object's is the whole rest of its `o`/`g` line ({@link objectName}), a
 *   material's the whole rest of its `usemtl` line (./mtl.ts `materialName`); `mtllib`
 *   files as written, blanks inside kept.
 *
 * The text is read as Java reads a UTF-8 file: lines end at `\n`, `\r` or `\r\n`. A
 * byte-order mark is no blank to Java, so a caller decoding bytes keeps it
 * (`new TextDecoder('utf-8', { ignoreBOM: true })`) to read the first line as the
 * engine does. Pure: no DOM, it runs in the model worker (editor.md §3.11) and in Node.
 */

import { parseJavaFloat, parseJavaInt } from './javaNumbers';
import { javaLines, javaTrim, materialName } from './mtl';

/** The object faces belong to before any `o`/`g` line, and after one that names nothing (`ObjectRole.DEFAULT_OBJECT`). */
export const DEFAULT_OBJECT = 'default';

/** Floats a corner takes in {@link ObjPart.quads}: x, y, z, u, v, nx, ny, nz. */
export const CORNER_FLOATS = 8;

/** Floats a quad takes in {@link ObjPart.quads}: four corners. */
export const QUAD_FLOATS = 4 * CORNER_FLOATS;

/** One run of faces (`ObjLoader.Part`): its object, its material and its quads. */
export interface ObjPart {
  readonly object: string;
  /** The `usemtl` name; empty before any `usemtl` and after one that names nothing. */
  readonly material: string;
  /** {@link QUAD_FLOATS} floats a quad, {@link CORNER_FLOATS} a corner: `[x, y, z, u, v, nx, ny, nz]`, OBJ frame. */
  readonly quads: Float32Array;
}

/** A whole file (`ObjLoader.Model`): its parts and its `mtllib` references, as written (relative to the OBJ). */
export interface ObjModel {
  readonly parts: ObjPart[];
  readonly materialLibraries: string[];
}

/** The loader refuses the file: where (1-based line, as the engine counts lines) and why. */
export class ObjError extends Error {
  readonly line: number;

  constructor(line: number, reason: string) {
    super(`line ${line}: ${reason}`);
    this.name = 'ObjError';
    this.line = line;
  }
}

/**
 * `ObjectRole.objectName`: the object an `o` or `g` line gives the faces after it — the
 * whole rest of the line after the keyword, trimmed, the blanks inside kept (`o Door
 * Leaf` is `Door Leaf`); {@link DEFAULT_OBJECT} if it names nothing; null if the line is
 * no `o`/`g` line. Blanks are the characters up to U+0020 (`String.trim`): a tab parts
 * the keyword from the name, a no-break space does not.
 */
export function objectName(line: string): string | null {
  const text = javaTrim(line);
  if (text === '' || (text[0] !== 'o' && text[0] !== 'g') || (text.length > 1 && text.charCodeAt(1) > 0x20)) return null;
  const name = javaTrim(text.slice(1));
  return name === '' ? DEFAULT_OBJECT : name;
}

/** Java's `\s` (without UNICODE_CHARACTER_CLASS), as `line.split("\\s+")` parts a line. */
const BLANKS = /[ \t\n\v\f\r]+/;

/** A growing run of floats. */
class Floats {
  data: Float32Array;
  length = 0;

  constructor(capacity: number) {
    this.data = new Float32Array(capacity);
  }

  /** Room for `count` more floats; returns where they go. */
  reserve(count: number): number {
    const at = this.length;
    if (at + count > this.data.length) {
      const grown = new Float32Array(Math.max(this.data.length * 2, at + count));
      grown.set(this.data.subarray(0, at));
      this.data = grown;
    }
    this.length = at + count;
    return at;
  }

  /** The floats so far, in an array of their own. */
  done(): Float32Array {
    return this.data.slice(0, this.length);
  }
}

/**
 * `ObjLoader.loadModel`: the parts of an OBJ and its `mtllib` references.
 *
 * @throws ObjError if the engine refuses the file
 */
export function loadModel(text: string): ObjModel {
  const positions = new Floats(3 * 1024);
  const uvs = new Floats(2 * 1024);
  const normals = new Floats(3 * 1024);
  const parts: ObjPart[] = [];
  const materialLibraries: string[] = [];
  let object = DEFAULT_OBJECT;
  let material = '';
  let current = new Floats(QUAD_FLOATS * 64);
  let corners = new Float32Array(CORNER_FLOATS * 8);

  const flush = (): void => {
    if (current.length === 0) return;
    parts.push({ object, material, quads: current.done() });
    current = new Floats(QUAD_FLOATS * 64);
  };

  const lines = javaLines(text);
  for (let n = 0; n < lines.length; n++) {
    const line = javaTrim(lines[n]!);
    if (line === '' || line.charCodeAt(0) === 0x23 /* # */) continue;
    const named = objectName(line);
    if (named !== null) {
      // an o/g line: the faces after it are this object's
      flush();
      object = named;
      continue;
    }
    const t = line.split(BLANKS);
    switch (t[0]) {
      case 'v':
        vector(t, 3, positions, n + 1);
        break;
      case 'vt':
        vector(t, 2, uvs, n + 1);
        break;
      case 'vn':
        vector(t, 3, normals, n + 1);
        break;
      case 'usemtl':
        flush();
        // the whole rest of the line, as the MTL's newmtl: "Dark Wood" is one material
        material = materialName(line, 'usemtl') ?? '';
        break;
      case 'f': {
        const count = t.length - 1;
        if (corners.length < count * CORNER_FLOATS) corners = new Float32Array(count * CORNER_FLOATS * 2);
        for (let i = 0; i < count; i++) corner(t[i + 1]!, corners, i * CORNER_FLOATS, positions, uvs, normals, n + 1);
        if (count === 4) {
          const at = current.reserve(QUAD_FLOATS); // first: it may move the data
          current.data.set(corners.subarray(0, QUAD_FLOATS), at);
        } else {
          // fan (0, i, i + 1); a triangle is a single step → a quad with its last corner twice
          for (let i = 1; i < count - 1; i++) {
            const at = current.reserve(QUAD_FLOATS);
            const out = current.data;
            out.set(corners.subarray(0, CORNER_FLOATS), at);
            out.set(corners.subarray(i * CORNER_FLOATS, (i + 1) * CORNER_FLOATS), at + CORNER_FLOATS);
            out.set(corners.subarray((i + 1) * CORNER_FLOATS, (i + 2) * CORNER_FLOATS), at + 2 * CORNER_FLOATS);
            out.set(corners.subarray((i + 1) * CORNER_FLOATS, (i + 2) * CORNER_FLOATS), at + 3 * CORNER_FLOATS);
          }
        }
        break;
      }
      case 'mtllib':
        // the file name may contain blanks: the rest of the line
        materialLibraries.push(javaTrim(line.slice('mtllib'.length)));
        break;
      default:
        break; // s, l, cstype, … — skipped
    }
  }
  flush();
  return { parts, materialLibraries };
}

/** A `v`, `vt` or `vn` line's first `size` numbers onto `into`; more are skipped, fewer refuse the file. */
function vector(t: string[], size: number, into: Floats, line: number): void {
  if (t.length <= size) throw new ObjError(line, `${t[0]} needs ${size} numbers, has ${t.length - 1}`);
  const at = into.reserve(size);
  for (let i = 0; i < size; i++) {
    const value = parseJavaFloat(t[i + 1]!);
    if (value === null) throw new ObjError(line, `${t[0]}: '${t[i + 1]}' is no number`);
    into.data[at + i] = value;
  }
}

/** One corner token `p`, `p/t`, `p//n` or `p/t/n` of a face, as its 8 floats into `out` at `at`. */
function corner(token: string, out: Float32Array, at: number, positions: Floats, uvs: Floats, normals: Floats, line: number): void {
  const idx = token.split('/');
  while (idx.length > 0 && idx[idx.length - 1] === '') idx.pop(); // String.split drops trailing empty strings
  if (idx.length === 0) throw new ObjError(line, `the corner '${token}' names no vertex`);
  const p = 3 * index(idx[0]!, positions.length / 3, token, line);
  out[at] = positions.data[p]!;
  out[at + 1] = positions.data[p + 1]!;
  out[at + 2] = positions.data[p + 2]!;
  out[at + 3] = 0;
  out[at + 4] = 0;
  if (idx.length > 1 && idx[1] !== '') {
    const uv = 2 * index(idx[1]!, uvs.length / 2, token, line);
    out[at + 3] = uvs.data[uv]!;
    out[at + 4] = Math.fround(1 - uvs.data[uv + 1]!); // OBJ's V origin is bottom-left; MC samples V from the top
  }
  out[at + 5] = 0;
  out[at + 6] = 1;
  out[at + 7] = 0;
  if (idx.length > 2 && idx[2] !== '') {
    const normal = 3 * index(idx[2]!, normals.length / 3, token, line);
    out[at + 5] = normals.data[normal]!;
    out[at + 6] = normals.data[normal + 1]!;
    out[at + 7] = normals.data[normal + 2]!;
  }
}

/** A 1-based index of a face corner → 0-based, checked against what was read so far. */
function index(text: string, count: number, token: string, line: number): number {
  const value = parseJavaInt(text);
  if (value === null || value < 1 || value > count) throw new ObjError(line, `the corner '${token}' names ${text} of ${count}`);
  return value - 1;
}
