/**
 * The findings of a whole pack (docs/proposals/editor.md §3.10): what opening it found and
 * the loader's rules beyond the schema (./loader.ts), and what the schema says of each file
 * that has a schema. The floor, model and converter checks join here as their modules arrive.
 *
 * The schema's findings of a file are kept per schema and file and reused while the file's
 * value is the same object: the pack model never changes a value in place (core/json/value),
 * so after an edit only the edited file is checked again — a big pack stays quick.
 */

import type { Problem } from '../core/contracts';
import type { Pack } from '../core/pack';
import { schemaKindOf, type Schema } from '../core/schema';
import { loaderProblems } from './loader';

interface Checked {
  value: unknown;
  problems: Problem[];
}

/** Per schema: file → the value last checked and its findings. */
const checkedFiles = new WeakMap<Schema, Map<string, Checked>>();

function schemaProblems(schema: Schema, path: string, value: unknown): Problem[] {
  let files = checkedFiles.get(schema);
  if (files === undefined) {
    files = new Map();
    checkedFiles.set(schema, files);
  }
  const known = files.get(path);
  if (known !== undefined && known.value === value) return known.problems;
  const kind = schemaKindOf(path);
  const problems = kind === undefined ? [] : schema.checker.problems(kind, path, value);
  files.set(path, { value, problems });
  return problems;
}

/**
 * All findings of `pack`: what opening found and the loader's rules first, then each
 * schema-described file's in path order. Without a `schema` (not loaded yet) the schema's
 * are left out. A file whose text is not JSON has the loader's `pack.broken-json` and no
 * schema findings.
 */
export function checkPack(pack: Pack, schema: Schema | null): Problem[] {
  const problems = [...pack.problems(), ...loaderProblems(pack)];
  if (schema === null) return problems;
  for (const path of pack.paths()) {
    if (schemaKindOf(path) === undefined || pack.kind(path) !== 'json' || pack.jsonError(path) !== null) continue;
    problems.push(...schemaProblems(schema, path, pack.json(path)));
  }
  return problems;
}
