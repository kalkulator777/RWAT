/**
 * Java's number rules, which JavaScript has otherwise (docs/proposals/editor.md §4.3) —
 * the one place the editor has them:
 *
 * - `Float.parseFloat` ({@link parseJavaFloat}): `ObjectRole` reads `OFFSET`, `RANGE`,
 *   `TL` and `ROT_<degrees>` with it, the OBJ loader and `IrAnim` their numbers;
 * - `Integer.parseInt` ({@link parseJavaInt}): the OBJ loader's indices;
 * - `String.format(Locale.ROOT, "%.<n>f")` ({@link formatFixed}): the numbers of
 *   `FloorCheck`'s texts;
 * - `Double.toString` ({@link javaDoubleToString}): numbers in the messages of
 *   `WagonTypeParser` and `FloorCheck`.
 *
 * Golden: fixtures/golden/java_numbers/ (`parse_float`, `format_fixed`,
 * `double_to_string`). Pure: it runs in workers and in Node.
 */

import { javaTrim } from './mtl';

// ---------------------------------------------------------------- Float.parseFloat

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
 * `Float.parseFloat(text)` as the float's value (a double that holds a float), or null
 * where Java throws `NumberFormatException`. The whole text is read, not a prefix
 * (`"1.5abc"` is refused, where JS `parseFloat` gives 1.5). Java's grammar: blanks up to
 * U+0020 around dropped, a sign, a decimal with an optional exponent and an optional
 * `f`/`F`/`d`/`D`, a hexadecimal `0x…p…` (its binary exponent required), `NaN`,
 * `Infinity`; `nan`, `inf`, a no-break space, non-ASCII digits and an empty text are
 * refused. Read straight to the nearest float (ties to even), not through a double:
 * `1.0000000596046447753906250001` is `1.0000001192092896`, where
 * `Math.fround(Number(…))` rounds twice and gives 1.
 *
 * A plain decimal — what an OBJ is made of — takes the fast way: `Number` and
 * `Math.fround`, exact unless the double lies half-way between two floats (then the
 * decimal is rounded exactly). Reading a large OBJ leans on that speed.
 *
 * Java: `java.lang.Float.parseFloat`.
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

// ---------------------------------------------------------------- Integer.parseInt

const DECIMAL_DIGIT = /\p{Nd}/u;

/** `Character.digit(unit, 10)`: 0…9, or −1. A run of Unicode decimal digits starts at a zero, ten a set. */
function digitOf(unit: number): number {
  if (unit >= 0x30 && unit <= 0x39) return unit - 0x30;
  if (unit < 0x80 || (unit >= 0xd800 && unit <= 0xdfff) || !DECIMAL_DIGIT.test(String.fromCharCode(unit))) return -1;
  let zero = unit;
  while (DECIMAL_DIGIT.test(String.fromCharCode(zero - 1))) zero--;
  return (unit - zero) % 10;
}

/**
 * `Integer.parseInt`: an optional sign, then decimal digits — any Unicode decimal digit
 * of the BMP, as `Character.digit` takes them — and nothing else (no blanks); past the
 * `int` range it refuses.
 *
 * @returns the int, or null where Java throws NumberFormatException
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

// ---------------------------------------------------------------- String.format("%.nf")

/**
 * `String.format(Locale.ROOT, "%.<digits>f", x)`: the shortest decimal that identifies the
 * double (what `Double.toString` prints, as in JS), rounded half up to `digits` places,
 * where `toFixed` rounds the binary value (`1.005` gives `1.01` here, `1.00` there; `2.5`
 * at 0 places gives `3`). A minus zero and a small negative keep their sign (`-0.00`);
 * large numbers print whole, with no exponent; NaN and the infinities print as `NaN`,
 * `Infinity`, `-Infinity`.
 *
 * Java: `java.util.Formatter`, conversion `f` (`FormattedFloatingDecimal`).
 */
export function formatFixed(x: number, digits: number): string {
  if (Number.isNaN(x)) return 'NaN';
  if (x === Infinity) return 'Infinity';
  if (x === -Infinity) return '-Infinity';
  const negative = x < 0 || Object.is(x, -0);
  const [mantissa = '0', exponentText = '0'] = Math.abs(x).toExponential().split('e');
  const significant = mantissa.replace('.', '');
  const keep = Number(exponentText) + 1 + digits; // significant digits that stay: the digits before the point, then `digits`
  let scaled = 0n; // the number times 10^digits, rounded
  if (x !== 0 && keep >= 0) {
    const kept = significant.slice(0, keep).padEnd(keep, '0');
    const roundUp = keep < significant.length && significant.charCodeAt(keep) >= 0x35; // the next digit is 5 or more
    scaled = BigInt(kept === '' ? '0' : kept) + (roundUp ? 1n : 0n);
  }
  const text = scaled.toString().padStart(digits + 1, '0');
  const whole = text.slice(0, text.length - digits);
  const body = digits === 0 ? whole : `${whole}.${text.slice(text.length - digits)}`;
  return negative ? `-${body}` : body;
}

// ---------------------------------------------------------------- Double.toString

/**
 * `Double.toString` of Java (JDK 19+): the shortest digits that read back as the same
 * double (the digits JavaScript picks; where one digit would do, the nearer of one or two,
 * so the smallest double is `4.9E-324`), plain from 10^-3 up to below 10^7 with at least
 * one decimal (`0.4`, `1.0`, `100.0`), otherwise `d.dddE±n` (`1.0E-5`, `1.2345E10`);
 * `-0.0`, `NaN`, `Infinity`, `-Infinity` by name.
 *
 * Java: `java.lang.Double.toString`.
 */
export function javaDoubleToString(x: number): string {
  if (Number.isNaN(x)) return 'NaN';
  if (!Number.isFinite(x)) return x > 0 ? 'Infinity' : '-Infinity';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  const sign = x < 0 ? '-' : '';
  const magnitude = Math.abs(x);
  let [mantissa = '', exponentText = '0'] = magnitude.toExponential().split('e');
  if (mantissa.length === 1) {
    // One digit is the shortest: Java takes the nearer of the decimals of one or two digits
    // that read back as the double. Only a subnormal's differs: 4.9E-324, where JS has 5e-324.
    const [two = '', twoExponent = '0'] = magnitude.toExponential(1).split('e');
    if (!two.endsWith('0')) [mantissa, exponentText] = [two, twoExponent];
  }
  const digits = mantissa.replace('.', '');
  const exponent = Number(exponentText);
  if (magnitude >= 1e-3 && magnitude < 1e7) {
    const point = exponent + 1;
    if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`;
    if (point >= digits.length) return `${sign}${digits}${'0'.repeat(point - digits.length)}.0`;
    return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
  }
  return `${sign}${digits[0] ?? ''}.${digits.length > 1 ? digits.slice(1) : '0'}E${exponent}`;
}
