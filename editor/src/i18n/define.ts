/**
 * How a module declares its interface strings (docs/proposals/editor.md §3.4).
 *
 * Every module keeps its own `i18n.ts` next to its code and default-exports
 * `defineStrings({ ru: {...}, en: {...} })`; the i18n module finds all of them by
 * itself (`import.meta.glob('../**\/i18n.ts')`), so a new module never edits a shared
 * file. Keys are `<module>.<name>` (`shell.title`, `checks.filter.errors`) and unique
 * across the editor. A key missing in one of the languages does not compile.
 *
 * Message syntax: `{name}` is a parameter (numbers are written with
 * {@link formatNumber}); `{count, plural, one {# вагон} few {# вагона} many {# вагонов}
 * other {# вагона}}` picks a branch by the language's plural rules (`=0 {…}` matches
 * exactly) and writes the number for `#`.
 *
 * This file imports nothing, so a module's `i18n.ts` can import it without an import
 * cycle through the catalog that collects them.
 *
 * @see formatNumber in ./format.ts
 */

/** The interface languages. */
export type Lang = 'ru' | 'en';

/** One module's strings: the same keys in both languages. */
export interface Strings {
  ru: Readonly<Record<string, string>>;
  en: Readonly<Record<string, string>>;
}

/** Declares a module's strings; the type parameter makes a key missing in either language an error. */
export function defineStrings<K extends string>(strings: {
  ru: Readonly<Record<K, string>>;
  en: Readonly<Record<K, string>>;
}): Strings {
  return strings;
}
