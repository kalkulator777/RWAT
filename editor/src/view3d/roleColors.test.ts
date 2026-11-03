import { describe, expect, it } from 'vitest';
import conventions from '../../../schema/obj-conventions.json';
import { GHOST_ROLES, isGhostRole, ROLE_COLORS, roleColor, roleColorCss, UNKNOWN_ROLE_COLOR, VIEW_BACKGROUND } from './roleColors';

/**
 * Colour-blindness simulation of Machado, Oliveira and Fernandes (2009) at full severity,
 * applied to linear RGB; the distance is CIE76 ΔE in CIELAB (D65). Two flat colours ΔE 15
 * apart are told apart at a glance.
 */
const VISION: Record<string, number[][]> = {
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

const MIN_ROLE_DISTANCE = 15;
const MIN_BACKGROUND_DISTANCE = 12;

function linear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function lab(rgb24: number, vision: number[][]): [number, number, number] {
  const rgb = [16, 8, 0].map((shift) => linear(((rgb24 >> shift) & 0xff) / 255));
  const [r, g, b] = vision.map((row) => Math.min(1, Math.max(0, row.reduce((sum, k, j) => sum + k * (rgb[j] as number), 0)))) as [
    number,
    number,
    number,
  ];
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function distance(a: number, b: number, vision: number[][]): number {
  const [l1, a1, b1] = lab(a, vision);
  const [l2, a2, b2] = lab(b, vision);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** Every pair closer than `min` for some vision, as text; with `against`, only the pairs with that one. */
function tooClose(colours: Record<string, number>, min: number, against?: string): string[] {
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

const wagonRoles = conventions.parse_order.steps;
/** The wagon roles the view paints in their colour, and the colour of a role nobody knows. */
const drawn: Record<string, number> = {
  ...Object.fromEntries(wagonRoles.filter((id) => !isGhostRole(id)).map((id) => [id, roleColor(id)])),
  unknown: UNKNOWN_ROLE_COLOR,
};

describe('the role colours', () => {
  it('have a colour for every wagon role and rail tile role of schema/obj-conventions.json, and no other', () => {
    expect(Object.keys(ROLE_COLORS)).toEqual([...wagonRoles, ...conventions.rail_tile.map((role) => role.id)]);
    expect(conventions.roles.map((role) => role.id).sort()).toEqual([...wagonRoles].sort());
  });

  it('make ghosts of exactly the roles the engine drops', () => {
    const dropped = conventions.roles.filter((role) => role.category === 'dropped').map((role) => role.id);
    expect([...GHOST_ROLES]).toEqual([...dropped, 'rail_hidden']);
    expect(isGhostRole('body')).toBe(false);
    expect(isGhostRole('skip')).toBe(true);
  });

  it('draw a role nobody knows in its own colour, and write colours for CSS', () => {
    expect(roleColor('wormhole')).toBe(UNKNOWN_ROLE_COLOR);
    expect(roleColorCss('wheelset')).toBe('#454545');
    expect(roleColorCss('rail')).toBe('#0072b2');
  });

  it('keep every two drawn wagon roles apart for normal vision and the three colour blindnesses', () => {
    expect(Object.keys(drawn)).toHaveLength(10);
    expect(tooClose(drawn, MIN_ROLE_DISTANCE)).toEqual([]);
  });

  it('keep every drawn wagon role apart from the view background, light and dark', () => {
    for (const [scheme, background] of Object.entries(VIEW_BACKGROUND)) {
      expect([scheme, tooClose({ ...drawn, background }, MIN_BACKGROUND_DISTANCE, 'background')]).toEqual([scheme, []]);
    }
  });

  it('would catch a pair that only normal vision tells apart', () => {
    expect(tooClose({ red: 0xd62728, green: 0x2ca02c }, MIN_ROLE_DISTANCE)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^deuteranopia: red ~ green/)]),
    );
  });
});
