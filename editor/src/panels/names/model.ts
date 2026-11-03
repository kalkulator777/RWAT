/**
 * The names of a pack (schema/pack-layout.json `lang_keys`, editor.md §2.1 step 5, §6.1):
 * which lang keys the pack's wagons, rail styles and light groups have, what each language
 * says, and the ops that change one. Pure: no DOM, no signals.
 *
 * - `wagon.<ns>.<id>` — a wagon type's name (fallback: the type id);
 * - `rail.<ns>.<id>` — a rail style's name (fallback: the style id);
 * - `light.<ns>.<type>.<group>` — a light group's name on a type (fallback: the mod's key,
 *   a `_LABEL_`, the group's code); the groups come from the model's OBJ, so until the model
 *   is parsed (M3) the table lists the keys the lang files have and adds one by hand;
 * - any other key of the lang files is listed as it is.
 *
 * A name is written into the lang file it already comes from, else into its namespace's
 * `assets/<ns>/lang/<lang>.json` (created when missing). An emptied name is removed: the
 * game then shows the fallback.
 */

import type { Op } from '../../core/contracts';
import { escapeSegment, isJsonObject } from '../../core/json';
import { langPath, putJson, railNameKey, wagonNameKey, type NameEntry, type Pack } from '../../core/pack';

/** The languages the names table always shows, in this order (Minecraft's codes). */
export const NAME_LANGS: readonly string[] = ['en_us', 'ru_ru'];

export type NameKind = 'wagon' | 'rail' | 'light' | 'other';

export interface NameRow {
  key: string;
  kind: NameKind;
  /** The namespace whose lang file a new name goes into. */
  namespace: string;
  /** What the game shows without the key: an id, or a light group's code. */
  fallback: string;
  /** The name in each language, and the file it comes from. */
  values: Record<string, NameEntry | undefined>;
}

/** The languages of the table: en and ru, then any other the pack has. */
export function nameLangs(pack: Pack): string[] {
  return [...NAME_LANGS, ...pack.langs().filter((code) => !NAME_LANGS.includes(code))];
}

function namespaceOf(id: string): string {
  return id.slice(0, id.indexOf(':'));
}

/** The rows of the names table: wagons, rail styles, light groups, other keys; each part in key order. */
export function nameRows(pack: Pack, langs: readonly string[] = nameLangs(pack)): NameRow[] {
  const names = new Map(langs.map((code) => [code, pack.names(code)] as const));
  const values = (key: string): Record<string, NameEntry | undefined> => Object.fromEntries(langs.map((code) => [code, names.get(code)?.get(key)]));
  const rows: NameRow[] = [];
  const listed = new Set<string>();
  const add = (key: string, kind: NameKind, namespace: string, fallback: string): void => {
    if (listed.has(key)) return;
    listed.add(key);
    rows.push({ key, kind, namespace, fallback, values: values(key) });
  };
  for (const entry of pack.stock()) add(wagonNameKey(entry.id), 'wagon', namespaceOf(entry.id), entry.id);
  for (const style of pack.railStyles()) add(railNameKey(style.id), 'rail', namespaceOf(style.id), style.id);
  const rest = new Map<string, string>();
  for (const code of langs) {
    for (const [key, entry] of names.get(code) ?? []) if (!rest.has(key)) rest.set(key, entry.file);
  }
  const sorted = [...rest].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [key, file] of sorted) {
    const namespace = file.split('/')[1] ?? '';
    if (key.startsWith('light.')) add(key, 'light', namespace, key.slice(key.lastIndexOf('.') + 1));
  }
  for (const [key, file] of sorted) add(key, 'other', file.split('/')[1] ?? '', key);
  return rows;
}

/**
 * The ops that make the name of `key` in `lang` be `text` (an empty text removes it):
 * into the file the key comes from, else into `namespace`'s lang file, created when the
 * pack has none. None when nothing changes or the lang file is not a JSON object.
 */
export function nameOps(pack: Pack, key: string, namespace: string, lang: string, text: string): Op[] {
  const entry = pack.names(lang).get(key);
  const file = entry?.file ?? langPath(namespace, lang);
  const at = `/${escapeSegment(key)}`;
  if (text === '') return entry === undefined ? [] : [{ op: 'remove', file, at }];
  if (entry?.value === text) return [];
  if (!pack.has(file)) return [putJson(file, { [key]: text })];
  return isJsonObject(pack.json(file)) ? [{ op: 'set', file, at, value: text }] : [];
}
