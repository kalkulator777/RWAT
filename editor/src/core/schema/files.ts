/**
 * Where the pack format's schema files come from. The schema is the repository's
 * `schema/*.json`, byte for byte; the built site carries it at `schema/` next to the
 * page (vite.config.ts `publishSchema`), and tests read it from disk (files.node.ts).
 * Everything else in core/schema takes the parsed files, so it does not care which.
 */

/** Parsed schema files by file name (`wagon_type.schema.json`, `pack-layout.json`, …). */
export type SchemaFiles = Readonly<Record<string, unknown>>;

/** The `$id` prefix of every schema file. */
export const SCHEMA_ID_BASE = 'https://kalkulator777.github.io/RWAT/schema/';

/** Lists the schema files (`schemas`) and the units, frames and statuses the forms print. */
export const LAYOUT_FILE = 'pack-layout.json';

/** Not a schema: the OBJ name conventions. */
export const CONVENTIONS_FILE = 'obj-conventions.json';

type Fetch = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * Fetches the schema files from the folder `base` names (the site's `schema/`, as a URL
 * ending in '/'). pack-layout.json comes first: it lists the other schemas.
 */
export async function fetchSchemaFiles(
  base: string | URL,
  fetchFile: Fetch = (url) => fetch(url),
): Promise<SchemaFiles> {
  const root = String(base);
  const get = async (name: string): Promise<unknown> => {
    const response = await fetchFile(new URL(name, root).href);
    if (!response.ok) throw new Error(`schema file ${name}: HTTP ${response.status}`);
    return response.json();
  };
  const layout = await get(LAYOUT_FILE);
  const listed = (layout as { schemas?: unknown }).schemas;
  const names = Array.isArray(listed) ? listed.filter((n): n is string => typeof n === 'string') : [];
  const rest = await Promise.all([...names, CONVENTIONS_FILE].map(async (n) => [n, await get(n)] as const));
  return { [LAYOUT_FILE]: layout, ...Object.fromEntries(rest) };
}
