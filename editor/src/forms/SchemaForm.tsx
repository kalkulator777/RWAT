/**
 * A form of a pack file built from its schema (docs/proposals/editor.md §3.7): the file's
 * fields in the schema's order with the widgets of ./Field.tsx, its findings next to the
 * fields they are about, and the findings that are about no field on top. Edits go out as
 * commands (`onCommand`), which the caller hands to the journal.
 */

import { descriptorAt } from '../checks/fields';
import type { Command, Op, Problem } from '../core/contracts';
import { childPointer, parsePointer, formatPointer } from '../core/json';
import type { Pack } from '../core/pack';
import type { Schema, SchemaKind } from '../core/schema';
import { lang, pairText, schemaText, t } from '../i18n';
import { problemMessage } from '../checks/messages';
import type { FormContext, FormLayers } from './context';
import { Field } from './Field';

export interface SchemaFormProps {
  /** The pack path of the file. */
  file: string;
  kind: SchemaKind;
  /** The file's JSON value as it stands. */
  value: unknown;
  schema: Schema;
  /** Findings (of the whole pack: the file's are picked out). */
  problems: readonly Problem[];
  /** The pack, for the findings' wording. */
  pack?: Pack | null;
  readOnly?: boolean;
  /** Spatial markup as a summary rather than fields (the inspector until M4). */
  spatialNote?: boolean;
  /** A form over layers (./context.ts `FormLayers`, 2b): `value` is the result, each field derived, set or removed. */
  layers?: FormLayers;
  onCommand(command: Command): void;
}

/**
 * The file's findings by the pointer of the field they are about: a missing required key
 * is about that key's field, not the object that lacks it. Findings about the file as a
 * whole come back apart.
 */
export function problemsByField(file: string, problems: readonly Problem[]): { byField: Map<string, Problem[]>; whole: Problem[] } {
  const byField = new Map<string, Problem[]>();
  const whole: Problem[] = [];
  for (const problem of problems) {
    for (const link of problem.at) {
      if (!('file' in link) || link.file !== file) continue;
      if (link.kind !== 'field') {
        whole.push(problem);
        continue;
      }
      const key = problem.params.key;
      const at = problem.code === 'schema.required' && typeof key === 'string' ? childPointer(link.at, key) : link.at;
      const list = byField.get(at) ?? [];
      list.push(problem);
      byField.set(at, list);
    }
  }
  return { byField, whole };
}

/** The frame's name of schema/pack-layout.json in the interface language. */
function frameNameOf(schema: Schema, id: string): string {
  const frame = schema.store.layoutList('frames').find((f) => f.id === id);
  return (frame && schemaText(frame, lang.value, 'name')) ?? id;
}

/**
 * What the fields of a form need for a file (./context.ts): its value, its findings by
 * field, how an edit is committed. `SchemaForm` builds its own; a panel that lays out some
 * of a file's fields itself (the sounds tab) builds one here and draws them with `Field`.
 */
export function formContext(props: SchemaFormProps): FormContext {
  const { file, kind, value, schema } = props;
  const { byField } = problemsByField(file, props.problems);
  return {
    file,
    kind,
    root: value,
    readOnly: props.readOnly === true,
    problems: byField,
    messages: { pack: props.pack ?? null, schema },
    spatialNote: props.spatialNote === true,
    frameName: (id) => frameNameOf(schema, id),
    commit: (ops: Op[], label: string, field: string) => props.onCommand({ label, labelParams: { field }, ops }),
    ...(props.layers === undefined ? {} : { layers: props.layers }),
  };
}

export function SchemaForm(props: SchemaFormProps) {
  const { file, kind, value, schema } = props;
  void lang.value; // the whole form follows the language
  const root = schema.fields.root(kind);
  const { byField, whole } = problemsByField(file, props.problems);
  // A finding about a place no field shows (a field the schema does not describe, the file's root) is listed on top.
  const loose: Problem[] = [...whole];
  for (const [at, list] of byField) {
    const parent = at === '' ? undefined : formatPointer(parsePointer(at).slice(0, -1));
    const shown = at !== '' && (descriptorAt(root, value, at) !== undefined || (parent !== undefined && list.every((p) => p.code === 'schema.unknown-key') && descriptorAt(root, value, parent) !== undefined));
    if (!shown) loose.push(...list);
  }
  const ctx = formContext(props);
  const about = pairText(root.description, lang.value);
  return (
    <div class="schema-form" data-file={file} data-kind={kind}>
      {about !== undefined && <p class="form-help">{about}</p>}
      {loose.length > 0 && (
        <section class="form-problems" aria-label={t('forms.problems.file')}>
          <ul class="field-problems">
            {loose.map((problem, i) => (
              <li key={`${problem.code}:${i}`} class={`field-problem field-problem-${problem.severity}`} data-code={problem.code}>
                <strong>{t(`checks.severity.${problem.severity}`)}:</strong> {problemMessage(problem, ctx.messages)}
              </li>
            ))}
          </ul>
        </section>
      )}
      <Field d={root} at="" ctx={ctx} label="" />
    </div>
  );
}
