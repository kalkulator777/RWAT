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
 * - Numbers are read as `Float.parseFloat` reads them ({@link parseJavaFloat}), indices
 *   as `Integer.parseInt`, 1-based and positive only. A bad number, a missing
 *   coordinate or an index outside what was read so far refuses the whole file
 *   ({@link ObjError}), as the engine's exception does.
 * - Names: an object's is the whole rest of its `o`/`g` line ({@link objectName}), a
 *   material's the whole rest of its `usemtl` line (./mtl.ts `materialName`); `mtllib`
 *   files as written, blanks inside kept.
 *
 * The text is read as Java reads a UTF-8 file: lines end at `\n`, `\r` or `\r\n`. A
 * byte-order mark is no blank to Java, so a caller decoding bytes keeps it
 * (`new TextDecoder('utf-8', { ignoreBOM: true })`) to read the first line as the
 * engine does. Pure: no DOM, it runs in the model worker (editor.md §3.11) and in Node.
 */

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

// ---------------------------------------------------------------- Java numbers

/**
 * `Integer.parseInt`: an optional sign, then decimal digits — any Unicode decimal digit
 * of the BMP, as `Character.digit` takes them — and nothing else; past the `int` range
 * it refuses.
 */
export function parseJavaInt(text: string): number | null {
  let i = 0;
  const sign = text.charCodeAt(0);
  if (sign === 0x2d /* - */ || sign === 0x2b /* + */) i = 1;
  if (i >= text.length) return null;
  let value = 0;
  for (; i < text.length; i++) {
    const digit = digitOf(text.charCodeAt(i));
    if (digit < 0) return null;
    value = value * 10 + digit;
    if (value > 2147483648) return null;
  }
  if (sign === 0x2d) return -value;
  return value > 2147483647 ? null : value;
}

const DECIMAL_DIGIT = /\p{Nd}/u;

/** `Character.digit(unit, 10)`: 0…9, or −1. A run of Unicode decimal digits starts at a zero, ten a set. */
function digitOf(unit: number): number {
  if (unit >= 0x30 && unit <= 0x39) return unit - 0x30;
  if (unit < 0x80 || (unit >= 0xd800 && unit <= 0xdfff) || !DECIMAL_DIGIT.test(String.fromCharCode(unit))) return -1;
  let zero = unit;
  while (DECIMAL_DIGIT.test(String.fromCharCode(zero - 1))) zero--;
  return (unit - zero) % 10;
}

/** A decimal as written in a file, nothing around it: the common case, read without the full grammar. */
const PLAIN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
/** Java's decimal floating-point literal, with its optional type suffix. */
const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?[fFdD]?$/;
/** Java's hexadecimal floating-point literal (`FloatingDecimal.HEX_FLOAT_PATTERN`): its binary exponent is required. */
const HEX = /^([+-])?0[xX](?:([0-9a-fA-F]+)\.?|([0-9a-fA-F]*)\.([0-9a-fA-F]+))[pP]([+-])?(\d+)[fFdD]?$/;
const SPECIAL = /^([+-]?)(NaN|Infinity)$/;

/** The largest float. */
const MAX_FLOAT = Math.fround(3.4028234663852886e38);
/** The float that would come after the largest if the exponent went on: half-way to it rounds to Infinity. */
const TWO_128 = 2 ** 128;
const F32 = new Float32Array(1);
const U32 = new Uint32Array(F32.buffer);

/**
 * `Float.parseFloat`: Java's grammar — blanks up to U+0020 around dropped, a sign, a
 * decimal with an optional exponent and an optional `f`/`F`/`d`/`D`, a hexadecimal
 * `0x…p…`, `NaN`, `Infinity` — read straight to the nearest float (ties to even), not
 * through a double: `1.0000000596046447753906250001` is `1.0000001192092896`, where
 * `Math.fround(Number(…))` rounds twice and gives 1.
 *
 * Golden: fixtures/golden/java_numbers/parse_float.json (this port's tests read it too).
 * The same rule is ports/javaNumbers.ts `parseJavaFloat` (editor.md §4.1); this one is
 * the OBJ loader's fast reading of it, and the two are to become one.
 *
 * @returns the float, or null where Java throws NumberFormatException (the whole text,
 *   not a prefix: `1.5abc` is refused)
 */
export function parseJavaFloat(text: string): number | null {
  if (PLAIN.test(text)) return decimalToFloat(text);
  const s = javaTrim(text);
  const special = SPECIAL.exec(s);
  if (special !== null) return special[2] === 'NaN' ? NaN : special[1] === '-' ? -Infinity : Infinity;
  const hex = HEX.exec(s);
  if (hex !== null) return hexToFloat(hex);
  if (!DECIMAL.test(s)) return null;
  return decimalToFloat(/[fFdD]$/.test(s) ? s.slice(0, -1) : s);
}

/**
 * A decimal (no suffix, no blanks) to the nearest float. `Number` gives the nearest
 * double; rounding that to a float is right unless the double lies exactly half-way
 * between two floats while the decimal does not — then the decimal is rounded exactly.
 */
function decimalToFloat(s: string): number {
  const d = Number(s);
  const f = Math.fround(d);
  if (f === d || !Number.isFinite(d) || !isFloatMidpoint(Math.abs(d))) return f;
  const m = /^([+-]?)(\d*)\.?(\d*)(?:[eE]([+-]?\d+))?$/.exec(s)!;
  const fraction = m[3]!;
  const exponent = Number(m[4] ?? '0') - fraction.length;
  const digits = BigInt(m[2]! + fraction);
  const value = exponent >= 0 ? roundToFloat(digits * 5n ** BigInt(exponent), 1n, exponent) : roundToFloat(digits, 5n ** BigInt(-exponent), exponent);
  return m[1] === '-' ? -value : value;
}

/** True if a positive double that is no float lies exactly half-way between two floats (MAX_FLOAT and 2^128 included). */
function isFloatMidpoint(a: number): boolean {
  const f = Math.fround(a);
  let lo: number;
  let hi: number;
  if (f === Infinity) {
    lo = MAX_FLOAT;
    hi = TWO_128;
  } else {
    F32[0] = f;
    const bits = U32[0]!;
    if (f < a) {
      lo = f;
      U32[0] = bits + 1;
      hi = F32[0] === Infinity ? TWO_128 : F32[0];
    } else {
      hi = f;
      U32[0] = bits - 1;
      lo = F32[0]!;
    }
  }
  return (lo + hi) / 2 === a;
}

/** A hexadecimal literal's groups (see {@link HEX}) to the nearest float. */
function hexToFloat(m: RegExpExecArray): number {
  const fraction = m[4] ?? '';
  const digits = ((m[2] ?? m[3] ?? '') + fraction).replace(/^0+/, '');
  let value = 0;
  if (digits !== '') {
    const significand = BigInt(`0x${digits}`);
    const exponent = (m[5] === '-' ? -1 : 1) * Number(m[6]) - 4 * fraction.length;
    const top = significand.toString(2).length - 1 + exponent; // the value is in [2^top, 2^(top+1))
    value = top >= 128 ? Infinity : top < -150 ? 0 : roundToFloat(significand, 1n, exponent);
  }
  return m[1] === '-' ? -value : value;
}

/** The float nearest `num / den × 2^exponent` (positive), ties to even; Infinity past the largest float. */
function roundToFloat(num: bigint, den: bigint, exponent: number): number {
  // q = ⌊num × 2^s / den⌋ with 2^23 ≤ q < 2^24: the float's 24 bits, its step 2^(exponent − s)
  let s = 24 - (num.toString(2).length - den.toString(2).length);
  if (scaled(num, den, s)[0] >= 1n << 24n) s--;
  if (exponent - s < -149) s = exponent + 149; // below the normal floats the step stays the smallest float's
  const [q, r, d] = scaled(num, den, s);
  const twice = 2n * r;
  const up = twice > d || (twice === d && (q & 1n) === 1n);
  const value = Number(up ? q + 1n : q) * 2 ** (exponent - s);
  return value >= TWO_128 ? Infinity : value;
}

/** `⌊num × 2^s / den⌋`, its remainder and the divisor it was taken by. */
function scaled(num: bigint, den: bigint, s: number): [bigint, bigint, bigint] {
  const n = s >= 0 ? num << BigInt(s) : num;
  const d = s >= 0 ? den : den << BigInt(-s);
  return [n / d, n % d, d];
}
