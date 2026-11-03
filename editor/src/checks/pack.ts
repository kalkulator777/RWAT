/**
 * The findings of a whole pack (docs/proposals/editor.md §3.10): what opening it found
 * (the loader's) and what the schema says of each file that has a schema. The floor,
 * model and converter checks join here as their modules arrive.
 */

import type { Problem } from '../core/contracts';
import type { Pack } from '../core/pack';
import { schemaKindOf, type Schema } from '../core/schema';

/**
 * All findings of `pack`: the loader's first, then each schema-described file's in path
 * order. Without a `schema` (not loaded yet) only the loader's are given. A file whose
 * text is not JSON has the loader's `pack.broken-json` and no schema findings.
 */
export function checkPack(pack: Pack, schema: Schema | null): Problem[] {
  const problems = pack.problems();
  if (schema === null) return problems;
  for (const path of pack.paths()) {
    const kind = schemaKindOf(path);
    if (kind === undefined || pack.kind(path) !== 'json' || pack.jsonError(path) !== null) continue;
    problems.push(...schema.checker.problems(kind, path, pack.json(path)));
  }
  return problems;
}
