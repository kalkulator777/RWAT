/**
 * The one place that says what colour a model object's role is drawn in: the 3D view's
 * "Roles" display and the objects tab's legend both read it, so the picture and the
 * table never disagree (docs/proposals/editor.md §3.8, §6.3).
 *
 * Role ids are the `roles[].id` of schema/obj-conventions.json (wagon roles in the order
 * of its `parse_order`, then the rail tile's). The palette is the Okabe–Ito one where it
 * can be, so neighbours stay apart for the common colour blindnesses; colour is never the
 * only mark either, every role has a name in the legend and in the table.
 *
 * Plain data, no DOM and no three: the view turns the number into its own colour.
 */

/** Colour of a role as 0xRRGGBB. */
export const ROLE_COLORS: Readonly<Record<string, number>> = {
  // dropped at load: greys, drawn as ghosts by the view
  hidden: 0x6b7280,
  skip: 0xa3a3a3,
  untextured: 0xd4d4d8,
  // geometry
  body: 0x9aa5b1,
  interior: 0x56b4e9,
  bogie_front: 0xe69f00,
  bogie_rear: 0xd55e00,
  wheelset: 0x7a4b00,
  // doors, controls, couplers
  door_leaf: 0x009e73,
  anim_object: 0x66d9b8,
  control: 0xcc79a7,
  coupler_head: 0x7b5ea7,
  // rail tile
  rail: 0x0072b2,
  rail_base: 0x9aa5b1,
  rail_hidden: 0x6b7280,
};

/** What a role the table does not know is drawn in. */
export const UNKNOWN_ROLE_COLOR = 0xf0e442;

/** The role's colour as 0xRRGGBB. */
export function roleColor(role: string): number {
  return ROLE_COLORS[role] ?? UNKNOWN_ROLE_COLOR;
}

/** The role's colour as a CSS `#rrggbb`. */
export function roleColorCss(role: string): string {
  return `#${roleColor(role).toString(16).padStart(6, '0')}`;
}
