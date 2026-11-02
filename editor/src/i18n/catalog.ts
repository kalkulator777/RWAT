/**
 * The catalog of interface strings and the message syntax (see ./define.ts). Pure: no
 * signals, no DOM, so it is tested in Node.
 */

import type { Lang, Strings } from './define';
import { formatNumber } from './format';

/**
 * Values for a message's placeholders; the same shapes as a finding's params
 * (core/contracts `ProblemParam`), so a finding is translated with its own params. A
 * list is written as its numbers joined by ', '.
 */
export type MessageParams = Readonly<Record<string, string | number | readonly number[]>>;

/** A module's strings file as `import.meta.glob(..., { eager: true })` returns it. */
export interface StringsModule {
  default?: Strings;
}

export interface Catalog {
  /** The message for the key in the language, or undefined when no module defines it. */
  get(lang: Lang, key: string): string | undefined;
  /** Every key, sorted. */
  keys(): string[];
  /** What is wrong with the modules' strings (duplicate keys, a key in one language only, placeholders that differ); empty when all is well. */
  readonly problems: readonly string[];
}

/** Builds the catalog from the modules' strings files, keyed by file path. Later duplicates are reported and ignored. */
export function createCatalog(modules: Readonly<Record<string, StringsModule>>): Catalog {
  const ru = new Map<string, string>();
  const en = new Map<string, string>();
  const owner = new Map<string, string>();
  const problems: string[] = [];

  for (const path of Object.keys(modules).sort()) {
    const strings = modules[path]?.default;
    if (!strings || typeof strings !== 'object' || !strings.ru || !strings.en) {
      problems.push(`${path}: no default export of defineStrings({ ru, en })`);
      continue;
    }
    const keys = new Set([...Object.keys(strings.ru), ...Object.keys(strings.en)]);
    for (const key of [...keys].sort()) {
      const ruText = strings.ru[key];
      const enText = strings.en[key];
      if (ruText === undefined || enText === undefined) {
        problems.push(`${path}: '${key}' has no ${ruText === undefined ? 'ru' : 'en'} text`);
      }
      const first = owner.get(key);
      if (first !== undefined) {
        problems.push(`${path}: '${key}' is already defined in ${first}`);
        continue;
      }
      owner.set(key, path);
      if (ruText !== undefined) ru.set(key, ruText);
      if (enText !== undefined) en.set(key, enText);
      if (ruText !== undefined && enText !== undefined) {
        const ruNames = placeholders(ruText).join(', ');
        const enNames = placeholders(enText).join(', ');
        if (ruNames !== enNames) {
          problems.push(`${path}: '${key}' has placeholders {${ruNames}} in ru but {${enNames}} in en`);
        }
      }
    }
  }

  return {
    get: (lang, key) => (lang === 'ru' ? ru : en).get(key),
    keys: () => [...owner.keys()].sort(),
    problems,
  };
}

/** The placeholder names a message uses, plural branches included, sorted and without repeats. */
export function placeholders(message: string): string[] {
  const names = new Set<string>();
  const walk = (text: string): void => {
    for (const body of argumentsOf(text)) {
      const parts = body.split(',');
      names.add((parts[0] ?? '').trim());
      if ((parts[1] ?? '').trim() === 'plural') {
        for (const branch of pluralBranches(parts.slice(2).join(',')).values()) walk(branch);
      }
    }
  };
  walk(message);
  return [...names].sort();
}

/** The bodies of a message's top-level `{…}` arguments. */
function argumentsOf(message: string): string[] {
  const bodies: string[] = [];
  let i = 0;
  for (;;) {
    const open = message.indexOf('{', i);
    if (open < 0) return bodies;
    const close = closingBrace(message, open);
    if (close < 0) return bodies;
    bodies.push(message.slice(open + 1, close));
    i = close + 1;
  }
}

const pluralRules = new Map<Lang, Intl.PluralRules>();

function pluralCategory(lang: Lang, value: number): string {
  let rules = pluralRules.get(lang);
  if (!rules) {
    rules = new Intl.PluralRules(lang);
    pluralRules.set(lang, rules);
  }
  return rules.select(value);
}

/** Index of the brace that closes the one at `open`, or -1. */
function closingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

/** `one {…} few {…} other {…}` → selector → text. */
function pluralBranches(body: string): Map<string, string> {
  const branches = new Map<string, string>();
  let i = 0;
  while (i < body.length) {
    const open = body.indexOf('{', i);
    if (open < 0) break;
    const selector = body.slice(i, open).trim();
    const close = closingBrace(body, open);
    if (close < 0 || selector === '') break;
    branches.set(selector, body.slice(open + 1, close));
    i = close + 1;
  }
  return branches;
}

function formatArgument(body: string, params: MessageParams | undefined, lang: Lang): string {
  const parts = body.split(',');
  const name = (parts[0] ?? '').trim();
  const value = params?.[name];
  if (parts.length === 1) {
    if (value === undefined) return `{${body}}`;
    if (typeof value === 'number') return formatNumber(value);
    return typeof value === 'string' ? value : value.map((n) => formatNumber(n)).join(', ');
  }
  const type = (parts[1] ?? '').trim();
  if (type !== 'plural' || typeof value !== 'number') return `{${body}}`;
  const branches = pluralBranches(parts.slice(2).join(','));
  const branch =
    branches.get(`=${value}`) ?? branches.get(pluralCategory(lang, value)) ?? branches.get('other') ?? '';
  return formatMessage(branch.replaceAll('#', formatNumber(value)), params, lang);
}

/** Fills a message's placeholders; an unknown placeholder or a broken brace is left as written. */
export function formatMessage(message: string, params: MessageParams | undefined, lang: Lang): string {
  let out = '';
  let i = 0;
  while (i < message.length) {
    const open = message.indexOf('{', i);
    if (open < 0) {
      out += message.slice(i);
      break;
    }
    const close = closingBrace(message, open);
    if (close < 0) {
      out += message.slice(i);
      break;
    }
    out += message.slice(i, open) + formatArgument(message.slice(open + 1, close), params, lang);
    i = close + 1;
  }
  return out;
}
