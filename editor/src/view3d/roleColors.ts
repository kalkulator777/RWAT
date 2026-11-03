/**
 * The one place that says what colour a model object's role is drawn in: the 3D view's
 * "Roles" display and the objects tab's legend both read it, so the picture and the
 * table never disagree (docs/proposals/editor.md §3.8, §6.3).
 *
 * Role ids are the `roles[].id` of schema/obj-conventions.json (wagon roles in the order
 * of its `parse_order`), then the rail tile's (`rail_tile[].id`); a test keeps the table
 * and the schema's lists equal. The drawn wagon roles take the Okabe–Ito colours, a violet
 * and two greys (the body, which is most of a model, and the wheelsets): every two of them
 * stay apart under simulated protanopia, deuteranopia and tritanopia, and apart from the
 * view's background (./roleColors.test.ts). Colour is never the only mark either: every
 * role has a name in the legend and in the table.
 *
 * The roles the engine does not draw (category `dropped` of the convention: `HIDE`, a
 * model's `skip`, a material without a texture; the rail tile's `HIDE`) are ghosts: greys
 * the view draws see-through and can hide as a whole.
 *
 * Plain data, no DOM and no three: the view turns the number into its own colour.
 */

/** Colour of a role as 0xRRGGBB. */
export const ROLE_COLORS: Readonly<Record<string, number>> = {
  // dropped at load: greys, drawn as ghosts by the view
  hidden: 0x6b7280,
  skip: 0xa3a3a3,
  untextured: 0xd4d4d8,
  // doors, controls, couplers, geometry
  door_leaf: 0xe69f00,
  control: 0xd55e00,
  coupler_head: 0xcc79a7,
  bogie_front: 0x0072b2,
  bogie_rear: 0x009e73,
  wheelset: 0x454545,
  anim_object: 0x9a5cf0,
  interior: 0x56b4e9,
  body: 0xc4c4c4,
  // rail tile
  rail: 0x0072b2,
  rail_hidden: 0x6b7280,
  rail_base: 0x9aa5b1,
};

/** What a role the table does not know is drawn in. */
export const UNKNOWN_ROLE_COLOR = 0xf0e442;

/** The roles drawn as ghosts: those the engine drops. */
export const GHOST_ROLES: ReadonlySet<string> = new Set(['hidden', 'skip', 'untextured', 'rail_hidden']);

/** The view's background in the light and the dark colour scheme: the role colours are kept apart from both. */
export const VIEW_BACKGROUND: Readonly<Record<'light' | 'dark', number>> = { light: 0xe9ecf1, dark: 0x1c1f24 };

/** The role's colour as 0xRRGGBB. */
export function roleColor(role: string): number {
  return ROLE_COLORS[role] ?? UNKNOWN_ROLE_COLOR;
}

/** The role's colour as a CSS `#rrggbb`. */
export function roleColorCss(role: string): string {
  return `#${roleColor(role).toString(16).padStart(6, '0')}`;
}

/** True if objects of the role are ghosts: the engine does not draw them. */
export function isGhostRole(role: string): boolean {
  return GHOST_ROLES.has(role);
}
