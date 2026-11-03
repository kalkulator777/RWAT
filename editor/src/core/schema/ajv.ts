/**
 * Ajv (draft 2020-12) on the pack schemas. Strict about keywords — an unknown keyword is
 * a schema error — with the `x-…` vocabulary added as annotations. `strictTypes`,
 * `strictTuples` and `strictRequired` are off: the schemas leave out `type` beside
 * `properties` in places and name `required` keys of sibling schemas.
 */

import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import { EXTENSION_KEYWORDS, russianTwin } from './vocabulary';
import type { SchemaStore } from './store';

export type SchemaValidator = ValidateFunction;

export function createAjv(store: SchemaStore): Ajv2020 {
  const ajv = new Ajv2020({
    allErrors: true,
    verbose: true,
    strictSchema: true,
    strictNumbers: true,
    strictTypes: false,
    strictTuples: false,
    strictRequired: false,
  });
  for (const { keyword, valueType, localized } of EXTENSION_KEYWORDS) {
    for (const name of localized ? [keyword, russianTwin(keyword)] : [keyword]) {
      ajv.addKeyword({ keyword: name, schemaType: valueType });
    }
  }
  for (const document of store.documents.values()) ajv.addSchema(document);
  // Compile now: a schema Ajv refuses (an unknown keyword, a broken $ref) fails at load, not at the first check.
  for (const uri of store.documents.keys()) ajv.getSchema(uri);
  return ajv;
}
