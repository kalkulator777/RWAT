/**
 * The extension keywords (`x-…`) of the pack schemas, documented in
 * schema/pack-layout.json `keywords`. Ajv knows them as annotations, so strict mode does
 * not refuse the schemas, and the forms read them (fields.ts). A keyword the schemas use
 * and this table lacks fails the tests: a new one must be understood by the forms on
 * purpose (editor.md §3.7).
 */

export interface ExtensionKeyword {
  keyword: string;
  /** What its value is in a schema. */
  valueType: 'string' | 'array';
  /** Has a Russian twin `<keyword>-ru` (the `x-description-ru` of `description` is the other way round). */
  localized: boolean;
}

export const EXTENSION_KEYWORDS: readonly ExtensionKeyword[] = [
  { keyword: 'x-description-ru', valueType: 'string', localized: false },
  { keyword: 'x-engine-default', valueType: 'string', localized: true },
  { keyword: 'x-unit', valueType: 'string', localized: false },
  { keyword: 'x-frame', valueType: 'string', localized: false },
  { keyword: 'x-status', valueType: 'string', localized: false },
  { keyword: 'x-status-note', valueType: 'string', localized: true },
  { keyword: 'x-file', valueType: 'string', localized: false },
  { keyword: 'x-code', valueType: 'array', localized: false },
  { keyword: 'x-keys', valueType: 'string', localized: false },
];

/** The Russian twin of a keyword, as i18n/schemaText names it: `x-k-ru`. */
export function russianTwin(keyword: string): string {
  return keyword.startsWith('x-') ? `${keyword}-ru` : `x-${keyword}-ru`;
}

/** Every `x-…` keyword a schema may use: the table's and the Russian twins it lists. */
export const ALLOWED_EXTENSION_KEYWORDS: ReadonlySet<string> = new Set(
  EXTENSION_KEYWORDS.flatMap((k) => (k.localized ? [k.keyword, russianTwin(k.keyword)] : [k.keyword])),
);

/** The `x-…` keys used as keywords in a schema document (not inside `properties`/`$defs` maps, whose keys are names). */
export function extensionKeywordsUsed(node: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) extensionKeywordsUsed(item, found);
  } else if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith('x-')) found.add(key);
      const isNameMap = key === 'properties' || key === '$defs' || key === 'patternProperties';
      if (isNameMap && typeof value === 'object' && value !== null && !Array.isArray(value)) {
        for (const sub of Object.values(value as Record<string, unknown>)) extensionKeywordsUsed(sub, found);
      } else if (key !== 'examples' && key !== 'enum' && key !== 'const' && key !== 'default') {
        extensionKeywordsUsed(value, found);
      }
    }
  }
  return found;
}
