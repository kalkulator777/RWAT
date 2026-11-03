/** Node only (tests, tools): the repository's schema folder read from disk. */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { SchemaFiles } from './files';

/** The repository's `schema/` folder. */
export const REPO_SCHEMA_DIR = fileURLToPath(new URL('../../../../schema/', import.meta.url));

/** Every `*.json` of a schema folder, parsed. */
export function readSchemaFiles(dir: string = REPO_SCHEMA_DIR): SchemaFiles {
  const out: Record<string, unknown> = {};
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    out[name] = JSON.parse(readFileSync(`${dir}/${name}`, 'utf8')) as unknown;
  }
  return out;
}
