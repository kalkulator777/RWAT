/**
 * The pack format's schema in the editor (docs/proposals/editor.md §3.7, §3.10):
 * loading, `$ref` resolution, Ajv with the `x-…` vocabulary, findings, hints for unknown
 * keys, and descriptors of fields for the forms.
 */

import type { SchemaFiles } from './files';
import { FieldDescriber } from './fields';
import { SchemaStore } from './store';
import { SchemaChecker } from './validate';

export { fetchSchemaFiles, SCHEMA_ID_BASE, type SchemaFiles } from './files';
export { FieldDescriber, walkFields, type FieldDescriptor, type FieldLimits, type FieldShape, type FieldStatus } from './fields';
export { schemaKindOf } from './kinds';
export { EXTENSION_KEYWORDS, ALLOWED_EXTENSION_KEYWORDS, extensionKeywordsUsed, russianTwin } from './vocabulary';
export { SCHEMA_KINDS, SchemaStore, type NodeLocation, type SchemaKind, type SchemaNode, type Texts } from './store';
export { nearestKey, similarity, suggestion, SUGGESTION_THRESHOLD } from './suggest';
export { invalidJsonProblem, SchemaChecker, toProblem, type Finding } from './validate';

/** Everything the editor does with the schema, built once from the parsed schema files. */
export interface Schema {
  store: SchemaStore;
  checker: SchemaChecker;
  fields: FieldDescriber;
}

export function createSchema(files: SchemaFiles): Schema {
  const store = new SchemaStore(files);
  return { store, checker: new SchemaChecker(store), fields: new FieldDescriber(store) };
}
