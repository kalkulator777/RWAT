/**
 * Texts of the pack format come from the schema itself, not from a translation of the
 * editor's own (docs/proposals/editor.md §6.2): field descriptions from `description` and
 * `x-description-ru`, units, frames and statuses from schema/pack-layout.json, roles and
 * flags from schema/obj-conventions.json. These helpers pick the interface language's
 * text out of such a JSON node; loading the schema is core/schema's business.
 *
 * Naming in the schema: the Russian twin of keyword `k` is `x-k-ru` (`description` →
 * `x-description-ru`, `name` → `x-name-ru`, `default` → `x-default-ru`), of an extension
 * keyword `x-k` it is `x-k-ru` (`x-engine-default` → `x-engine-default-ru`); a few
 * pack-layout entries use `k-ru` (`label-ru`) and lists of facts are `{ "en", "ru" }`
 * pairs.
 */

import type { Lang } from './define';

function textAt(node: unknown, key: string): string | undefined {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return undefined;
  const value = (node as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

/** The keys the Russian twin of `key` may have in the schema, in the order they are tried. */
export function russianKeys(key: string): string[] {
  return key.startsWith('x-') ? [`${key}-ru`] : [`x-${key}-ru`, `${key}-ru`];
}

/**
 * The node's text for `key` (by default its description) in the language. When the node
 * has it only in the other language, that one is given rather than nothing; the schema
 * tests are what keep both languages complete.
 */
export function schemaText(node: unknown, lang: Lang, key = 'description'): string | undefined {
  const english = textAt(node, key);
  let russian: string | undefined;
  for (const candidate of russianKeys(key)) {
    russian ??= textAt(node, candidate);
  }
  return lang === 'ru' ? (russian ?? english) : (english ?? russian);
}

/** The text of an `{ "en": …, "ru": … }` pair in the language, falling back to the other one. */
export function pairText(pair: unknown, lang: Lang): string | undefined {
  const english = textAt(pair, 'en');
  const russian = textAt(pair, 'ru');
  return lang === 'ru' ? (russian ?? english) : (english ?? russian);
}
