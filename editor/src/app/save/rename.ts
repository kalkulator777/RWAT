/**
 * Renaming a wagon (editor.md §3.5; pack-capabilities.md §3, §10): one command of the
 * journal over every file the id is in, so undo takes it back at once and leaves the files
 * byte for byte as they were.
 *
 * - The type `data/<ns>/wagon_types/<id>.json` and the model
 *   `assets/<ns>/wagon_models/<id>.json` move to the new id (the id is the file's path: the
 *   two are paired by it alone).
 * - The old id is added to the type's `aliases`, so the wagons players saved under it load
 *   as the renamed type (`WagonTypeLoader`, server side). The new id leaves the list if it
 *   was in it: an alias that is a loaded type's id is dropped with an error.
 * - The names the engine reads by the type's id move with it, in every lang file of the
 *   pack, where they stand in the file: `wagon.<ns>.<id>` (`RollingStockItem`) and
 *   `light.<ns>.<id>.<group>` (`LightNames`).
 *
 * Refused, with the reason: an id that is no type id or no file path; another namespace
 * (*decision:* the model's paths without `ns:` — OBJ, animations, liveries — are read in
 * its namespace, and the names go into that namespace's lang files: moving across
 * namespaces is a move of the wagon's assets, not a rename, so it is left to the author);
 * a new id a file of the pack has already, or that another type of the pack lists as an
 * alias (the engine would drop that alias); an old id that another type lists as an alias
 * (two types would claim it); a type file that is not a JSON object or whose `aliases` is
 * not a list; a name key the new id would take that a lang file has already with another text.
 */

import type { Command, Op } from '../../core/contracts';
import { isJsonObject } from '../../core/json';
import { putMember } from '../../core/json/parse';
import { lightNameKey, modelPath, typePath, wagonNameKey, type Pack } from '../../core/pack';
import { packPathProblem } from '../../core/paths';

/** `common.schema.json#/$defs/type_id` (a test holds the two together). */
export const TYPE_ID = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/u;

/** Why a rename is refused: an i18n key and its values. */
export interface RenameRefusal {
  key: string;
  params?: Record<string, string | number>;
}

function namespaceOf(id: string): string {
  return id.slice(0, id.indexOf(':'));
}

/** The aliases a type file lists (strings only), or null when the file is not an object or the list is not a list. */
function aliasesOf(value: unknown): string[] | null {
  if (!isJsonObject(value)) return null;
  if (!Object.hasOwn(value, 'aliases')) return [];
  const list = value.aliases;
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : null;
}

/**
 * The lang keys of the type: its name and its light groups' names. A light key of another
 * type whose id starts with this one's (`ns:coach` and `ns:coach.b` share `light.ns.coach.`)
 * is that type's: the longest id wins.
 */
function ownsKey(key: string, id: string, others: readonly string[]): boolean {
  if (key === wagonNameKey(id)) return true;
  const prefix = lightNameKey(id, '');
  if (!key.startsWith(prefix) || key.length === prefix.length) return false;
  return !others.some((other) => {
    const longer = lightNameKey(other, '');
    return longer.length > prefix.length && key.startsWith(longer) && key.length > longer.length;
  });
}

/** The key renamed to the new id (one the type owns). */
function movedKey(key: string, from: string, to: string): string {
  if (key === wagonNameKey(from)) return wagonNameKey(to);
  return lightNameKey(to, key.slice(lightNameKey(from, '').length));
}

/** The command that renames the wagon `from` to `to` (see the module's comment), or why it cannot. */
export function renameTypeCommand(pack: Pack, from: string, toInput: string): { command: Command } | { errors: RenameRefusal[] } {
  const to = toInput.trim();
  const entry = pack.stock().find((item) => item.id === from);
  if (entry === undefined) return { errors: [{ key: 'save.rename.error.missing', params: { id: from } }] };
  if (to === from) return { errors: [{ key: 'save.rename.error.same' }] };
  if (!TYPE_ID.test(to) || packPathProblem(typePath(to)) !== null) return { errors: [{ key: 'save.rename.error.id', params: { id: to } }] };
  if (namespaceOf(to) !== namespaceOf(from)) {
    return { errors: [{ key: 'save.rename.error.namespace', params: { from: namespaceOf(from), to: namespaceOf(to) } }] };
  }

  const errors: RenameRefusal[] = [];
  const newType = typePath(to);
  const newModel = modelPath(to);
  if (pack.has(newType) || pack.has(newModel)) errors.push({ key: 'save.rename.error.taken', params: { id: to } });

  const others = pack.stock().filter((item) => item.id !== from);
  for (const other of others) {
    if (other.type === null) continue;
    const aliases = aliasesOf(pack.json(other.type)) ?? [];
    if (aliases.includes(to)) errors.push({ key: 'save.rename.error.aliasOfOther', params: { id: to, type: other.id } });
    if (aliases.includes(from)) errors.push({ key: 'save.rename.error.oldClaimed', params: { id: from, type: other.id } });
  }

  const ops: Op[] = [];
  if (entry.type !== null) {
    const aliases = aliasesOf(pack.json(entry.type));
    if (aliases === null) {
      errors.push({ key: 'save.rename.error.typeFile', params: { file: entry.type } });
    } else {
      const value = pack.json(entry.type) as Record<string, unknown>;
      const kept = Array.isArray(value.aliases) ? (value.aliases as unknown[]).filter((item) => item !== to) : [];
      ops.push({ op: 'set', file: entry.type, at: '/aliases', value: kept.includes(from) ? kept : [...kept, from] });
      ops.push({ op: 'renameFile', file: entry.type, to: newType });
    }
  }
  if (entry.model !== null) ops.push({ op: 'renameFile', file: entry.model, to: newModel });

  const otherIds = others.map((item) => item.id);
  for (const declaration of pack.declarations()) {
    if (declaration.kind !== 'lang') continue;
    const value = pack.json(declaration.path);
    if (!isJsonObject(value)) continue;
    const keys = Object.keys(value);
    const moving = keys.filter((key) => ownsKey(key, from, otherIds));
    if (moving.length === 0) continue;
    // the members in their order, each moved key in its own place
    const renamed: Record<string, unknown> = {};
    for (const key of keys) {
      if (!moving.includes(key)) {
        if (!Object.hasOwn(renamed, key)) putMember(renamed, key, value[key]);
        continue;
      }
      const target = movedKey(key, from, to);
      if (Object.hasOwn(value, target) && !moving.includes(target) && value[target] !== value[key]) {
        errors.push({ key: 'save.rename.error.nameTaken', params: { key: target, file: declaration.path } });
      }
      putMember(renamed, target, value[key]);
    }
    ops.push({ op: 'set', file: declaration.path, at: '', value: renamed });
  }
  if (errors.length > 0) return { errors };
  return { command: { label: 'save.rename.command', labelParams: { from, to }, ops } };
}

/** The file to select after a rename: the type, else the model. */
export function renamedFile(pack: Pack, to: string): string {
  return pack.has(typePath(to)) ? typePath(to) : modelPath(to);
}
