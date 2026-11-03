/**
 * The floor zones of a wagon type as its file writes them (`interior`, schema
 * `wagon_type.schema.json#/$defs/zone`), and the commands that edit them. Everything is in
 * the OBJ frame, as the file has it (`x-frame: obj`): a zone's plan is x along the car and
 * z across it, its `min.y` the floor's height; `max.y` the engine does not read.
 *
 * `interior` is a list of zones; the old form, one zone as an object, is read as a list of
 * one and written back as a list at the first edit. Removing the last zone removes
 * `interior`: a type whose list is empty does not load ("'interior' lists no zones").
 */

import type { Command, JsonPointer, Link, Op } from '../../core/contracts';
import { isJsonObject } from '../../core/json';

/** A zone in the OBJ frame: its least and greatest corners. */
export interface ZoneBox {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

/** A plan rectangle in the OBJ frame: x along the car, z across. */
export interface PlanRect {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

/** How far above the floor a new zone's top is, as the converter writes it (`max.y` = `min.y` + 2.5); the engine does not read it. */
export const HEADROOM = 2.5;

const INTERIOR: JsonPointer = '/interior';

function corner(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  return value.every((n) => typeof n === 'number' && Number.isFinite(n)) ? (value as [number, number, number]) : null;
}

/** One zone of the file, or null when its corners are not three numbers each. */
export function zoneOf(value: unknown): ZoneBox | null {
  if (!isJsonObject(value)) return null;
  const min = corner(value.min);
  const max = corner(value.max);
  if (min === null || max === null) return null;
  return { minX: min[0], minY: min[1], minZ: min[2], maxX: max[0], maxY: max[1], maxZ: max[2] };
}

/** The `interior` of a type's JSON as a list: the list, the old single zone as one, nothing when absent. */
function interiorList(typeJson: unknown): unknown[] {
  if (!isJsonObject(typeJson)) return [];
  const interior = typeJson.interior;
  if (Array.isArray(interior)) return interior;
  return isJsonObject(interior) ? [interior] : [];
}

/** True when the file writes its one zone in the old form, an object rather than a list. */
export function isOldForm(typeJson: unknown): boolean {
  return isJsonObject(typeJson) && isJsonObject(typeJson.interior);
}

/** The zones of a type's JSON in the file's order; a zone that cannot be read is null, so the indices stay the file's. */
export function zonesOf(typeJson: unknown): (ZoneBox | null)[] {
  return interiorList(typeJson).map(zoneOf);
}

/** A zone's JSON as the file writes it. */
export function zoneJson(zone: ZoneBox): { min: number[]; max: number[] } {
  return { min: [zone.minX, zone.minY, zone.minZ], max: [zone.maxX, zone.maxY, zone.maxZ] };
}

/** A zone over a plan rectangle (its corners put in order) at floor height `y`, its top {@link HEADROOM} above. */
export function zoneOver(rect: PlanRect, y: number): ZoneBox {
  return {
    minX: Math.min(rect.minX, rect.maxX),
    minY: y,
    minZ: Math.min(rect.minZ, rect.maxZ),
    maxX: Math.max(rect.minX, rect.maxX),
    maxY: y + HEADROOM,
    maxZ: Math.max(rect.minZ, rect.maxZ),
  };
}

/** A zone's plan. */
export function planOf(zone: ZoneBox): PlanRect {
  return { minX: zone.minX, minZ: zone.minZ, maxX: zone.maxX, maxZ: zone.maxZ };
}

/** The link of zone `index` of wagon `wagon` (core/contracts `Link`). */
export function zoneLink(wagon: string, index: number): Link {
  return { kind: 'zone', type: wagon, index };
}

/** The indices of the wagon's zones in the selection, in its order. */
export function selectedZones(selection: readonly Link[], wagon: string): number[] {
  return selection.flatMap((link) => (link.kind === 'zone' && link.type === wagon ? [link.index] : []));
}

/** The op that turns the old single zone into a list of it, before an edit addresses the list; none for a list. */
function listOps(file: string, typeJson: unknown): Op[] {
  return isOldForm(typeJson) ? [{ op: 'set', file, at: INTERIOR, value: interiorList(typeJson) }] : [];
}

/** Adds a zone at the end of the list (zone `count`), the list made when the type has none. */
export function addZone(file: string, typeJson: unknown, zone: ZoneBox, coalesceKey?: string): Command {
  const zones = interiorList(typeJson);
  const ops: Op[] =
    zones.length === 0
      ? [{ op: 'set', file, at: INTERIOR, value: [zoneJson(zone)] }]
      : [...listOps(file, typeJson), { op: 'insert', file, at: `${INTERIOR}/-`, value: zoneJson(zone) }];
  return { label: 'tools.floor.cmd.add', labelParams: { index: zones.length }, ops, ...(coalesceKey === undefined ? {} : { coalesceKey }) };
}

/**
 * Puts zone `index` where `zone` says, its corners written whole where they changed; no op
 * for a corner already so. `label` names the gesture in the journal.
 */
export function setZone(
  file: string,
  typeJson: unknown,
  index: number,
  zone: ZoneBox,
  options: { label?: string; coalesceKey?: string } = {},
): Command {
  const before = interiorList(typeJson)[index];
  const ops: Op[] = [];
  if (before !== undefined) {
    const now = zoneJson(zone);
    const old = isJsonObject(before) ? before : {};
    const changed = (key: 'min' | 'max'): boolean => JSON.stringify(old[key]) !== JSON.stringify(now[key]);
    if (changed('min') || changed('max')) {
      ops.push(...listOps(file, typeJson));
      if (!isJsonObject(before)) ops.push({ op: 'set', file, at: `${INTERIOR}/${index}`, value: now });
      else {
        if (changed('min')) ops.push({ op: 'set', file, at: `${INTERIOR}/${index}/min`, value: now.min });
        if (changed('max')) ops.push({ op: 'set', file, at: `${INTERIOR}/${index}/max`, value: now.max });
      }
    }
  }
  const command: Command = { label: options.label ?? 'tools.floor.cmd.set', labelParams: { index }, ops };
  if (options.coalesceKey !== undefined) command.coalesceKey = options.coalesceKey;
  return command;
}

/** One number of zone `index`: `corner` min or max, `axis` 0 x, 1 y, 2 z. */
export function setZoneNumber(file: string, typeJson: unknown, index: number, corner: 'min' | 'max', axis: 0 | 1 | 2, value: number): Command {
  const zone = zonesOf(typeJson)[index];
  if (zone === undefined || zone === null) return { label: 'tools.floor.cmd.set', labelParams: { index }, ops: [] };
  const key = (['X', 'Y', 'Z'] as const)[axis];
  const changed: ZoneBox = { ...zone, [`${corner}${key}`]: value };
  return setZone(file, typeJson, index, changed);
}

/** Zone `index`'s floor at `y`: its top keeps its height above the floor. */
export function setZoneHeight(file: string, typeJson: unknown, index: number, y: number): Command {
  const zone = zonesOf(typeJson)[index];
  if (zone === undefined || zone === null) return { label: 'tools.floor.cmd.height', labelParams: { index }, ops: [] };
  return setZone(file, typeJson, index, { ...zone, minY: y, maxY: y + (zone.maxY - zone.minY) }, { label: 'tools.floor.cmd.height' });
}

/** Removes zone `index`; the last one takes `interior` with it. */
export function removeZone(file: string, typeJson: unknown, index: number): Command {
  const zones = interiorList(typeJson);
  const command: Command = { label: 'tools.floor.cmd.remove', labelParams: { index }, ops: [] };
  if (index < 0 || index >= zones.length) return command;
  command.ops =
    zones.length === 1 ? [{ op: 'remove', file, at: INTERIOR }] : [{ op: 'remove', file, at: `${INTERIOR}/${index}` }];
  return command;
}

/** Moves zone `from` to place `to` in the list (zone 0 is where the floor check starts its walk). */
export function moveZoneTo(file: string, typeJson: unknown, from: number, to: number): Command {
  const zones = interiorList(typeJson);
  const command: Command = { label: 'tools.floor.cmd.order', labelParams: { from, to }, ops: [] };
  if (from === to || from < 0 || to < 0 || from >= zones.length || to >= zones.length) return command;
  command.ops = [
    ...listOps(file, typeJson),
    { op: 'remove', file, at: `${INTERIOR}/${from}` },
    { op: 'insert', file, at: `${INTERIOR}/${to}`, value: zones[from] },
  ];
  return command;
}
