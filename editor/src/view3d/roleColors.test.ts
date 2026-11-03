import { describe, expect, it } from 'vitest';
import conventions from '../../../schema/obj-conventions.json';
import { tooClose } from './colours.node';
import { GHOST_ROLES, isGhostRole, ROLE_COLORS, roleColor, roleColorCss, UNKNOWN_ROLE_COLOR, VIEW_BACKGROUND } from './roleColors';

/** Two drawn roles at least this far apart (ΔE, ./colours.node.ts), for every vision; and a role from the background. */
const MIN_ROLE_DISTANCE = 15;
const MIN_BACKGROUND_DISTANCE = 12;

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
