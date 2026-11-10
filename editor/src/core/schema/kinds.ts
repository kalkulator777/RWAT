/**
 * Which schema checks a file of a pack (tools/validate_pack.py `DECLARATIONS`).
 * Recipes and overrides are not files of a pack: the caller names their kind.
 */

import type { SchemaKind } from './store';

const DECLARATIONS: readonly (readonly [RegExp, SchemaKind])[] = [
  [/^data\/[^/]+\/wagon_types\/.+\.json$/, 'wagon_type'],
  [/^assets\/[^/]+\/wagon_models\/.+\.json$/, 'wagon_model'],
  [/^assets\/[^/]+\/rail_models\/.+\.json$/, 'rail_model'],
  [/^pack\.mcmeta$/, 'pack_mcmeta_rwat'],
];

/** The schema of a pack file by its path, or undefined for a file no schema describes (OBJ, PNG, lang, …). */
export function schemaKindOf(path: string): SchemaKind | undefined {
  return DECLARATIONS.find(([pattern]) => pattern.test(path))?.[1];
}
