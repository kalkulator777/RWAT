/**
 * Numbers as the pack's JSON files write them: the way Python's `json.dumps` does
 * (tools/ir2rwat.py `dump`, the reference of golden `json_dump`), so that a file the
 * editor writes looks like one the converter or the example pack's generator wrote.
 *
 * Python tells an int from a float, JavaScript does not. A number read from a file
 * keeps its kind through its lexeme ({@link formatLexeme}: `100.0` stays `100.0`, `1e2`
 * becomes `100.0`, `100` stays `100`); a JavaScript number has none, and is written as
 * an int when it is whole and as Python writes a float otherwise ({@link formatNumber};
 * editor.md §3.6: the engine and the tools read `20` and `20.0` alike).
 */

const INTEGER_LEXEME = /^-?(?:0|[1-9][0-9]*)$/;

/**
 * `repr(float)` of Python: the shortest digits that read back as the same double (the
 * same digits JavaScript picks), in fixed notation from 1e-4 up to below 1e16 with at
 * least one decimal (`20.0`), in exponent notation outside it with a signed exponent of
 * at least two digits (`1e-05`, `1e+16`). JavaScript writes those `0.00001` and
 * `10000000000000000`. Not finite: `NaN`, `Infinity`, `-Infinity`, as `json.dumps` does.
 */
export function pythonFloat(x: number): string {
  if (Number.isNaN(x)) return 'NaN';
  if (!Number.isFinite(x)) return x > 0 ? 'Infinity' : '-Infinity';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  const sign = x < 0 ? '-' : '';
  // toExponential() without digits gives the shortest round-trip digits: d.ddde±x
  const [mantissa = '', exponentText = '0'] = Math.abs(x).toExponential().split('e');
  const digits = mantissa.replace('.', '');
  const exponent = Number(exponentText);
  const point = exponent + 1; // digits × 10^(point − digits.length): Python's decpt
  if (point > 16 || point <= -4) {
    const head = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    const magnitude = String(Math.abs(exponent)).padStart(2, '0');
    return `${sign}${head}e${exponent < 0 ? '-' : '+'}${magnitude}`;
  }
  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${'0'.repeat(point - digits.length)}.0`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

/**
 * A JavaScript number as the editor writes it: a whole number as an int (all its
 * digits, never an exponent; `-0` as `0`), any other as {@link pythonFloat}.
 * Throws on NaN and the infinities: they are not JSON, and no pack field takes them.
 */
export function formatNumber(x: number): string {
  if (!Number.isFinite(x)) throw new RangeError(`${x} is not a JSON number`);
  if (Number.isInteger(x)) return Math.abs(x) < 1e21 ? String(x === 0 ? 0 : x) : BigInt(x).toString();
  return pythonFloat(x);
}

/**
 * A number as written in a JSON text, the way Python reads and writes it back: without
 * a fraction or exponent it is an int, written with all its digits (`-0` → `0`, past
 * 2^53 exactly); otherwise a float ({@link pythonFloat} of the nearest double, which
 * Python and JavaScript agree on).
 */
export function formatLexeme(lexeme: string): string {
  if (INTEGER_LEXEME.test(lexeme)) return BigInt(lexeme).toString();
  return pythonFloat(Number(lexeme));
}

/** True when the lexeme is a float to Python (it has a fraction or an exponent): `20.0`, `1e2`. */
export function isFloatLexeme(lexeme: string): boolean {
  return !INTEGER_LEXEME.test(lexeme);
}
