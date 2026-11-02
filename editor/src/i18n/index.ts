/**
 * The interface language and its strings (docs/proposals/editor.md §6.2).
 *
 * - `lang` is a signal: a component that calls {@link t} while rendering re-renders when
 *   the language changes. The first language is the one remembered in this browser,
 *   else Russian for a `ru*` browser and English for any other.
 * - Strings are collected from every module's `i18n.ts` (see ./define.ts); nothing here
 *   lists the modules.
 * - Numbers are written the same in both languages (./format.ts); format texts come
 *   from the schema (./schemaText.ts).
 */

import { signal } from '@preact/signals';
import { createCatalog, formatMessage, type MessageParams, type StringsModule } from './catalog';
import type { Lang } from './define';

export { defineStrings, type Lang, type Strings } from './define';
export { createCatalog, formatMessage, placeholders, type Catalog, type MessageParams } from './catalog';
export { formatNumber, formatQuantity } from './format';
export { pairText, russianKeys, schemaText } from './schemaText';

/** The interface languages, in the order the language switch shows them. */
export const LANGS: readonly Lang[] = ['ru', 'en'];

/** Where the chosen language is remembered in the browser. */
export const LANG_STORAGE_KEY = 'rwat.editor.lang';

/** The language to start in: the remembered one, else Russian for a `ru*` browser language, else English. */
export function detectLang(remembered: string | null | undefined, browserLanguage: string | undefined): Lang {
  if (remembered === 'ru' || remembered === 'en') return remembered;
  return /^ru(?:-|$)/i.test(browserLanguage ?? '') ? 'ru' : 'en';
}

function rememberedLang(): string | null {
  try {
    return globalThis.localStorage?.getItem(LANG_STORAGE_KEY) ?? null;
  } catch {
    return null; // storage blocked: start from the browser's language
  }
}

/** The interface language. Change it with {@link setLang}, which also remembers it. */
export const lang = signal<Lang>(detectLang(rememberedLang(), globalThis.navigator?.language));

/** Switches the interface language and remembers it in this browser. */
export function setLang(next: Lang): void {
  lang.value = next;
  try {
    globalThis.localStorage?.setItem(LANG_STORAGE_KEY, next);
  } catch {
    // storage blocked: the choice holds until the page is closed
  }
}

/** Every module's strings: the modules' own `i18n.ts` files, found by path. */
export const catalog = createCatalog(import.meta.glob<StringsModule>('../**/i18n.ts', { eager: true }));

if (import.meta.env.DEV) {
  for (const problem of catalog.problems) console.warn(`i18n: ${problem}`);
}

const reportedMissing = new Set<string>();

/**
 * The interface string for the key in the current language, placeholders filled. A key
 * no module defines comes back as the key itself, so a gap is visible rather than blank.
 */
export function t(key: string, params?: MessageParams): string {
  const current = lang.value;
  const message = catalog.get(current, key) ?? catalog.get('en', key);
  if (message === undefined) {
    if (import.meta.env.DEV && !reportedMissing.has(key)) {
      reportedMissing.add(key);
      console.warn(`i18n: no string '${key}'`);
    }
    return key;
  }
  return formatMessage(message, params, current);
}
