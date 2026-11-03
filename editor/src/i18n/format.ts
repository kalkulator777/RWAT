/**
 * Numbers in the interface (docs/proposals/editor.md §6.2): written as JSON and Blender
 * write them, whatever the interface language — '.' before the fraction, no digit
 * grouping, an ASCII minus — because authors carry numbers between Blender, the pack's
 * JSON and the editor. Only the words around them are translated.
 *
 * This is display formatting. Texts the engine itself writes (FloorCheck's `%.2f`) are
 * reproduced by the port of Java's formatting (ports/javaNumbers), not by this.
 */

const formats = new Map<number, Intl.NumberFormat>();

function numberFormat(maxFractionDigits: number): Intl.NumberFormat {
  let format = formats.get(maxFractionDigits);
  if (!format) {
    // en-US gives '.' and '-' on every platform; grouping is switched off.
    format = new Intl.NumberFormat('en-US', {
      useGrouping: false,
      minimumFractionDigits: 0,
      maximumFractionDigits: maxFractionDigits,
    });
    formats.set(maxFractionDigits, format);
  }
  return format;
}

/**
 * A number for the interface: at most `maxFractionDigits` digits after the point,
 * trailing zeros dropped (`1.5`, `494`, `0.063`), never `-0`. NaN and infinities are
 * written the way JSON tools and Java write them: `NaN`, `Infinity`, `-Infinity`.
 */
export function formatNumber(value: number, maxFractionDigits = 3): string {
  if (Number.isNaN(value)) return 'NaN';
  if (!Number.isFinite(value)) return value > 0 ? 'Infinity' : '-Infinity';
  const digits = Math.min(20, Math.max(0, Math.trunc(maxFractionDigits)));
  const text = numberFormat(digits).format(value);
  return text === '-0' ? '0' : text;
}

/**
 * A number with its unit label (the label comes from schema/pack-layout.json#units in
 * the interface language): `42 т`, `2.5 блок (= 1 м)`. A no-break space keeps the two
 * on one line; a degree sign follows the number directly (`90°`).
 */
export function formatQuantity(value: number, unit: string, maxFractionDigits = 3): string {
  const number = formatNumber(value, maxFractionDigits);
  if (unit === '') return number;
  return unit === '°' ? `${number}°` : `${number}\u00a0${unit}`;
}
