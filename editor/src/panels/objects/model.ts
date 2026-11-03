/**
 * The objects tab's table as data: the rows of a {@link LoadedModel}, the search and role
 * filters, the sorting, the counts of the legend. Pure, no DOM, tested in Node.
 *
 * A row is one object of the model as the model worker read it (`LoadedModel.objects`),
 * with what the table shows of it: its role, the control the engine built it into
 * (`ObjectInfo.control`: the key, and the group when it is not the key's own), its light
 * group, the flags and marks of its name (read by `ports/objectRole`, the one reading of
 * the convention), its materials, whether they have a texture (`LoadedModel.materials`),
 * and the number of triangles it is drawn with.
 */

import type { LoadedModel, ObjectInfo } from '../../core/contracts';
import { coupled, door, hasToken, parseRole } from '../../ports/objectRole';
import { roleRank } from './roles';

export interface ObjectRow {
  /** Position in the model's object list (the file's order). */
  index: number;
  name: string;
  /** Role id of schema/obj-conventions.json. */
  role: string;
  /** The control's key `<KIND>_<n>` (a door leaf's `DOOR_<n>`), or the coupler head's end; null when the object is none. */
  key: string | null;
  /** The control group the name sets with `_CG_<group>`; null without it (the control's group is then its own key). */
  controlGroup: string | null;
  /** The light group the name sets with `_LCG_<group>`; null without it. */
  lightGroup: string | null;
  /** True for an object that glows or shines: it has a light group, `FULLBRIGHT` or is a headlight. */
  lit: boolean;
  /** Flags and modifiers the name carries: `TOGGLE`, `INVERT`, `FULLBRIGHT`, `ROT 90`, … */
  flags: string[];
  /** The materials of the object's parts, in order, each once. */
  materials: string[];
  /** Whether a material of the object has a texture (`LoadedModel.materials`): null for an object with no faces. */
  textured: boolean | null;
  /** Triangles the object is drawn with. */
  faces: number;
}

const FLAGS = ['TOGGLE', 'PRESS', 'INVERT', 'HIDE', 'NOTOUCH', 'NOINTERACT', 'GLOBAL', 'LINVERT', 'FULLBRIGHT', 'INTERIOR'] as const;

function numberText(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
}

/** What the name says as short marks for the table: control flags, light flags, hinge degrees and slide. */
export function flagsOf(name: string): string[] {
  const flags: string[] = FLAGS.filter((flag) => hasToken(name.replace(/\.\d{3}$/u, ''), flag));
  const role = door(name) ?? parseRole(name);
  if (role.pivotDegrees !== null) flags.push(`ROT ${numberText(role.pivotDegrees)}`);
  const slide = role.control?.slide;
  if (slide !== undefined) {
    slide.forEach((distance, axis) => {
      if (distance !== 0) flags.push(`TL ${numberText(distance)} ${'XYZ'[axis]}`);
    });
  }
  if (role.headlight) flags.push('HEADLIGHT');
  return flags;
}

/**
 * The control key and its group (when it is not the key's own) of the control the engine
 * built the object into, or a coupler head's end; and its light group: the engine's, else
 * what the name says (an object the engine draws nothing of has none of the engine's).
 */
function identity(info: ObjectInfo): { key: string | null; controlGroup: string | null; lightGroup: string | null } {
  const control = info.control ?? null;
  const head = control === null ? coupled(info.name) : null;
  return {
    key: control?.key ?? (head === null ? null : head.front ? 'COUPLED_FRONT' : 'COUPLED_REAR'),
    controlGroup: control !== null && control.group !== control.key ? control.group : null,
    lightGroup: info.lightGroup ?? (door(info.name) ?? parseRole(info.name)).lightGroup,
  };
}

/** The rows of a model, in its object order. */
export function buildRows(model: LoadedModel): ObjectRow[] {
  const materials = new Map<string, string[]>();
  const faces = new Map<string, number>();
  for (const part of model.parts) {
    const list = materials.get(part.object) ?? [];
    if (!list.includes(part.material)) list.push(part.material);
    materials.set(part.object, list);
    faces.set(part.object, (faces.get(part.object) ?? 0) + part.positions.length / 9);
  }
  return model.objects.map((info: ObjectInfo, index) => {
    const used = materials.get(info.name) ?? [];
    const { key, controlGroup, lightGroup } = identity(info);
    const flags = flagsOf(info.name);
    return {
      index,
      name: info.name,
      role: info.role,
      key,
      controlGroup,
      lightGroup,
      flags,
      lit: lightGroup !== null || flags.includes('FULLBRIGHT') || flags.includes('HEADLIGHT'),
      materials: used,
      textured: used.length === 0 ? null : used.some((material) => Object.hasOwn(model.materials, material)),
      faces: faces.get(info.name) ?? 0,
    };
  });
}

export interface RowFilter {
  /** Case-insensitive text looked for in the name, key, group, flags and materials; blank passes every row. */
  text: string;
  /** The roles to show; null shows every role. */
  roles: ReadonlySet<string> | null;
  /** Only the objects that glow or shine (`lit`), whatever their role. */
  lit?: boolean;
}

export const NO_FILTER: RowFilter = { text: '', roles: null };

/** The rows that pass the filter, in the order given. */
export function filterRows(rows: readonly ObjectRow[], filter: RowFilter): ObjectRow[] {
  const needle = filter.text.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter.roles !== null && !filter.roles.has(row.role)) return false;
    if (filter.lit === true && !row.lit) return false;
    if (needle === '') return true;
    const haystack = [row.name, row.key ?? '', row.controlGroup ?? '', row.lightGroup ?? '', ...row.flags, ...row.materials].join('\n').toLowerCase();
    return haystack.includes(needle);
  });
}

/** The columns the table sorts by; `file` is the order of the OBJ. */
export type SortKey = 'file' | 'name' | 'role' | 'key' | 'group' | 'material' | 'texture' | 'faces';

export const SORT_KEYS: readonly SortKey[] = ['file', 'name', 'role', 'key', 'group', 'material', 'texture', 'faces'];

export type SortDirection = 'asc' | 'desc';

const collator = new Intl.Collator('en', { numeric: true });

/** The group the table shows and sorts by: the control group, else the light group. */
export function groupOf(row: ObjectRow): string {
  return row.controlGroup ?? row.lightGroup ?? '';
}

function compareBy(key: SortKey, a: ObjectRow, b: ObjectRow): number {
  switch (key) {
    case 'file':
      return a.index - b.index;
    case 'name':
      return collator.compare(a.name, b.name);
    case 'role':
      return roleRank(a.role) - roleRank(b.role) || collator.compare(a.role, b.role);
    case 'key':
      return collator.compare(a.key ?? '', b.key ?? '');
    case 'group':
      return collator.compare(groupOf(a), groupOf(b));
    case 'material':
      return collator.compare(a.materials.join(' '), b.materials.join(' '));
    case 'texture':
      return Number(a.textured === true) - Number(b.textured === true);
    case 'faces':
      return a.faces - b.faces;
  }
}

/** The rows sorted by a column, ties in the file's order (a new array). A column with blanks puts them last ascending. */
export function sortRows(rows: readonly ObjectRow[], key: SortKey, direction: SortDirection = 'asc'): ObjectRow[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const blankA = (key === 'key' && a.key === null) || (key === 'group' && groupOf(a) === '');
    const blankB = (key === 'key' && b.key === null) || (key === 'group' && groupOf(b) === '');
    if (blankA !== blankB) return blankA ? 1 : -1;
    return sign * compareBy(key, a, b) || a.index - b.index;
  });
}

/** How many rows have each role. */
export function roleCounts(rows: readonly ObjectRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.role, (counts.get(row.role) ?? 0) + 1);
  return counts;
}

/** The roles that occur, in the engine's order (`parse_order`), the unknown ones last. */
export function rolesPresent(rows: readonly ObjectRow[]): string[] {
  return [...roleCounts(rows).keys()].sort((a, b) => roleRank(a) - roleRank(b) || (a < b ? -1 : 1));
}
