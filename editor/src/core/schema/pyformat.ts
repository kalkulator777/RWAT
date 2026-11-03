/**
 * Python's spelling of values, so a finding reads the same as validate_pack.py's:
 * `repr(str)`, `json.dumps(value, ensure_ascii=False)` and the 60-character `show`.
 * JSON read in JavaScript loses the difference between 5 and 5.0; an integral number
 * is always written as an integer.
 */

/** Python's `repr` of a string: single quotes unless it holds only single quotes. */
export function pyRepr(text: string): string {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === quote || ch === '\\') out += `\\${ch}`;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (code < 0x20 || (code >= 0x7f && code <= 0xa0) || code === 0xad) {
      out += code <= 0xff ? `\\x${code.toString(16).padStart(2, '0')}` : `\\u${code.toString(16).padStart(4, '0')}`;
    } else out += ch;
  }
  return out + quote;
}

/** Python's `repr(float)` for a finite number (exponent form below 1e-4 and from 1e16). */
export function pyNumber(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < 1e16) return Object.is(value, -0) ? '-0.0' : String(value);
  const [mantissa = '', exponentText = '0'] = value.toExponential().split('e');
  const exponent = Number(exponentText);
  if (exponent >= -4 && exponent < 16) return String(value);
  const sign = exponent < 0 ? '-' : '+';
  return `${mantissa}e${sign}${String(Math.abs(exponent)).padStart(2, '0')}`;
}

/** `json.dumps(value, ensure_ascii=False)`. */
export function pyJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return pyNumber(value);
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(pyJson).join(', ')}]`;
  const entries = Object.entries(value as Record<string, unknown>);
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}: ${pyJson(v)}`).join(', ')}}`;
}

/** validate_pack's `show`: the JSON text, cut to 57 characters and "..." from 61. */
export function show(value: unknown): string {
  const text = Array.from(pyJson(value));
  return text.length <= 60 ? text.join('') : `${text.slice(0, 57).join('')}...`;
}

/** The JSON type validate_pack names a value by. */
export function jsonType(value: unknown): 'null' | 'boolean' | 'integer' | 'number' | 'string' | 'array' | 'object' {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  if (typeof value === 'string') return 'string';
  return Array.isArray(value) ? 'array' : 'object';
}
