/**
 * Node only (tests of the view's colours: ./roleColors.test.ts, ./overlays.test.ts): how
 * far apart two colours look, for normal vision and the three colour blindnesses, and how
 * well one stands out from another by its lightness.
 *
 * Colour-blindness simulation of Machado, Oliveira and Fernandes (2009) at full severity,
 * applied to linear RGB; the distance is CIE76 ΔE in CIELAB (D65). Two flat colours ΔE 15
 * apart are told apart at a glance. The lightness contrast is WCAG 2's ratio of relative
 * luminances.
 */

/** The visions colours are told apart in: each a matrix on linear RGB. */
export const VISION: Readonly<Record<string, number[][]>> = {
  normal: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

function linear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function linearRgb(rgb24: number): [number, number, number] {
  return [16, 8, 0].map((shift) => linear(((rgb24 >> shift) & 0xff) / 255)) as [number, number, number];
}

function lab(rgb24: number, vision: number[][]): [number, number, number] {
  const rgb = linearRgb(rgb24);
  const [r, g, b] = vision.map((row) => Math.min(1, Math.max(0, row.reduce((sum, k, j) => sum + k * (rgb[j] as number), 0)))) as [number, number, number];
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** ΔE between two colours (0xRRGGBB) as a vision sees them. */
export function distance(a: number, b: number, vision: number[][]): number {
  const [l1, a1, b1] = lab(a, vision);
  const [l2, a2, b2] = lab(b, vision);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** Every pair closer than `min` for some vision, as text; with `against`, only the pairs with that one. */
export function tooClose(colours: Record<string, number>, min: number, against?: string): string[] {
  const names = Object.keys(colours);
  const found: string[] = [];
  for (const [vision, matrix] of Object.entries(VISION)) {
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const a = names[i] as string;
        const b = names[j] as string;
        if (against !== undefined && a !== against && b !== against) continue;
        const d = distance(colours[a] as number, colours[b] as number, matrix);
        if (d < min) found.push(`${vision}: ${a} ~ ${b} (ΔE ${d.toFixed(1)})`);
      }
    }
  }
  return found;
}

/** WCAG 2's contrast ratio of two colours (0xRRGGBB): 1 the same lightness, 21 black on white. */
export function contrast(a: number, b: number): number {
  const luminance = (rgb24: number): number => {
    const [r, g, b] = linearRgb(rgb24);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** A CSS `#rrggbb` as 0xRRGGBB. */
export function rgbOf(css: string): number {
  return Number.parseInt(css.slice(1), 16);
}
