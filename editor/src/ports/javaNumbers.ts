/**
 * Java's number rules, which JavaScript has otherwise (docs/proposals/editor.md §4.3):
 * `Float.parseFloat` and `String.format(Locale.ROOT, "%.<n>f")`.
 *
 * Ported from the JDK as the engine leans on it: `ObjectRole` reads `OFFSET`, `RANGE`,
 * `TL` and `ROT_<degrees>` with `Float.parseFloat`, the OBJ loader its coordinates, and
 * `FloorCheck` prints its numbers with `%.2f` / `%.1f`. Golden: fixtures/golden/java_numbers/.
 * Pure: no imports.
 */

const FLOAT_BITS = 24;
/** The smallest float is 2^-149; every float is a multiple of it. */
const FLOAT_MIN_EXPONENT = -149;
/** 2^128: where rounding to the nearest float turns into infinity. */
const FLOAT_OVERFLOW = 2 ** 128;

/** Java's `String.trim`: every character up to U+0020 goes from both ends. */
function javaTrim(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && text.charCodeAt(start) <= 0x20) start++;
  while (end > start && text.charCodeAt(end - 1) <= 0x20) end--;
  return text.slice(start, end);
}

function bitLength(n: bigint): number {
  return n === 0n ? 0 : n.toString(2).length;
}

/**
 * The float nearest to `numerator / denominator × 2^binary` (both positive), ties to even —
 * one rounding, straight from the exact value, as Java reads a text into a float (rounding
 * through `double` first would round twice). Returned as the double that holds that float.
 */
function roundToFloat(numerator: bigint, denominator: bigint, binary: number): number {
  const high = 1n << BigInt(FLOAT_BITS);
  const low = 1n << BigInt(FLOAT_BITS - 1);
  // Start a little low: the quotient then has too many bits and the loop climbs to 24.
  let exponent = Math.max(bitLength(numerator) - bitLength(denominator) - FLOAT_BITS - 1, FLOAT_MIN_EXPONENT - binary);
  for (;;) {
    const num = exponent >= 0 ? numerator : numerator << BigInt(-exponent);
    const den = exponent >= 0 ? denominator << BigInt(exponent) : denominator;
    let quotient = num / den;
    const remainder = num % den;
    if (quotient >= high) {
      exponent++;
      continue;
    }
    if (quotient < low && exponent + binary > FLOAT_MIN_EXPONENT) {
      exponent--;
      continue;
    }
    const twice = remainder * 2n;
    if (twice > den || (twice === den && (quotient & 1n) === 1n)) quotient++;
    const value = Number(quotient) * 2 ** (exponent + binary);
    return value >= FLOAT_OVERFLOW ? Infinity : value;
  }
}

const NAMED = /^([+-]?)(NaN|Infinity)$/;
const DECIMAL = /^([+-]?)(\d+\.?\d*|\.\d+)(?:[eE]([+-]?\d+))?[fFdD]?$/;
const HEXADECIMAL = /^([+-]?)0[xX]([0-9a-fA-F]+\.?[0-9a-fA-F]*|\.[0-9a-fA-F]+)[pP]([+-]?\d+)[fFdD]?$/;

/** Splits `ddd.ddd` into the integer of all its digits and the count of digits after the point. */
function splitPoint(digits: string): { all: string; fraction: number } {
  const point = digits.indexOf('.');
  if (point < 0) return { all: digits, fraction: 0 };
  return { all: digits.slice(0, point) + digits.slice(point + 1), fraction: digits.length - point - 1 };
}

function decimalValue(digits: string, exponentText: string | undefined): number {
  const { all, fraction } = splitPoint(digits);
  const mantissa = BigInt(all === '' ? '0' : all);
  if (mantissa === 0n) return 0;
  // The exponent is clamped before any arithmetic: a text like 1e999999999999 is infinity.
  const exponent = Math.max(-100000, Math.min(100000, Number(exponentText ?? '0'))) - fraction;
  const magnitude = exponent + mantissa.toString().length; // the value is from 10^(magnitude-1) to 10^magnitude
  if (magnitude > 40) return Infinity;
  if (magnitude < -50) return 0;
  return exponent >= 0 ? roundToFloat(mantissa * 10n ** BigInt(exponent), 1n, 0) : roundToFloat(mantissa, 10n ** BigInt(-exponent), 0);
}

function hexadecimalValue(digits: string, exponentText: string): number {
  const { all, fraction } = splitPoint(digits);
  const mantissa = BigInt('0x' + (all === '' ? '0' : all));
  if (mantissa === 0n) return 0;
  const exponent = Math.max(-100000, Math.min(100000, Number(exponentText))) - 4 * fraction;
  if (exponent + bitLength(mantissa) > 200) return Infinity;
  if (exponent + bitLength(mantissa) < -200) return 0;
  return roundToFloat(mantissa, 1n, exponent);
}

/**
 * `Float.parseFloat(text)` as the float's value (a double that holds a float), or null
 * where Java throws `NumberFormatException`. The whole text is read, not a prefix
 * (`"1.5abc"` is refused, where JS `parseFloat` gives 1.5). Accepts blanks up to U+0020 at
 * both ends, a sign, `NaN`, `Infinity`, decimals with an exponent, a suffix `f`/`F`/`d`/`D`
 * and hexadecimal floats (`0x1p3`, which need their binary exponent); refuses `nan`, `inf`,
 * a no-break space, non-ASCII digits and an empty text. Reads straight into a float, so
 * `1.0000000596046447753906250001` gives 1.0000001192092896.
 *
 * Java: `java.lang.Float.parseFloat`.
 */
export function parseJavaFloat(text: string): number | null {
  const s = javaTrim(text);
  const named = NAMED.exec(s);
  if (named !== null) {
    if (named[2] === 'NaN') return NaN;
    return named[1] === '-' ? -Infinity : Infinity;
  }
  const decimal = DECIMAL.exec(s);
  if (decimal !== null) {
    const magnitude = decimalValue(decimal[2] ?? '', decimal[3]);
    return decimal[1] === '-' ? -magnitude : magnitude;
  }
  const hex = HEXADECIMAL.exec(s);
  if (hex !== null) {
    const magnitude = hexadecimalValue(hex[2] ?? '', hex[3] ?? '0');
    return hex[1] === '-' ? -magnitude : magnitude;
  }
  return null;
}

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
