/**
 * A finding in the interface's words (docs/proposals/editor.md §6.2): translated by its
 * code (`problem.<code>` in ./i18n.ts) from its own params, in the current language. A
 * code without a line keeps the English text the finding carries.
 *
 * Where a finding's params are English words of the tool (JSON type names, a reserved
 * field's note), they are put into the language too: type names from the strings here,
 * notes from the schema's own Russian texts of the field.
 */

import type { Problem, ProblemParam } from '../core/contracts';
import { getAt } from '../core/json';
import type { Pack } from '../core/pack';
import { schemaKindOf, type FieldDescriptor, type Schema } from '../core/schema';
import { catalog, lang, pairText, t, type MessageParams } from '../i18n';
import { descriptorAt, variantOf } from './fields';

/** What a message may look up: the pack the finding is about and the schema, for a field's own texts. */
export interface MessageContext {
  pack?: Pack | null;
  schema?: Schema | null;
}

function has(key: string): boolean {
  return catalog.get(lang.value, key) !== undefined;
}

/** `number or null` → `число или null`: each JSON type name the tool wrote, in the language. */
function typeNames(text: string, separator: string): string {
  return text
    .split(separator)
    .map((name) => (has(`problem.json.${name}`) ? t(`problem.json.${name}`) : name))
    .join(separator === ' or ' ? t('problem.json.or') : separator);
}

/** `string 'heavy'` → `строка 'heavy'`. */
function gotText(text: string): string {
  const space = text.indexOf(' ');
  const name = space < 0 ? text : text.slice(0, space);
  return (has(`problem.json.${name}`) ? t(`problem.json.${name}`) : name) + (space < 0 ? '' : text.slice(space));
}

function firstSentence(text: string): string {
  const end = text.search(/\.\s/);
  return end < 0 ? text.replace(/\.$/, '') : text.slice(0, end);
}

/** The descriptor of the field a finding points at (the branch of a `oneOf` its value takes), if the schema has one. */
export function findingField(problem: Problem, context: MessageContext): FieldDescriptor | undefined {
  const link = problem.at[0];
  if (link?.kind !== 'field' || !context.schema || !context.pack) return undefined;
  const kind = schemaKindOf(link.file);
  if (kind === undefined) return undefined;
  const value = context.pack.json(link.file);
  const d = descriptorAt(context.schema.fields.root(kind), value, link.at);
  return d && (variantOf(d, getAt(value, link.at)) ?? d);
}

function params(problem: Problem, context: MessageContext): MessageParams {
  const out: Record<string, ProblemParam> = { ...problem.params, text: problem.text };
  const string = (name: string): string | undefined => {
    const param = out[name];
    return typeof param === 'string' ? param : undefined;
  };
  if (problem.code === 'schema.type') {
    const expected = string('expected');
    const got = string('got');
    if (expected !== undefined) out.expected = typeNames(expected, ' or ');
    if (got !== undefined) out.got = gotText(got);
  } else if (problem.code === 'schema.no-form') {
    const forms = string('forms');
    if (forms !== undefined) out.forms = typeNames(forms, ', ');
  } else if (problem.code === 'schema.deprecated' || problem.code === 'schema.reserved') {
    const d = findingField(problem, context);
    const note =
      problem.code === 'schema.reserved'
        ? d?.status && pairText(d.status.note, lang.value)
        : d && firstSentence(pairText(d.description, lang.value) ?? '');
    if (note) out.note = note;
  }
  return out;
}

/** The finding's text in the interface language. */
export function problemMessage(problem: Problem, context: MessageContext = {}): string {
  let key = `problem.${problem.code}`;
  if (problem.code === 'schema.unknown-key' && typeof problem.params.nearest === 'string' && problem.params.nearest !== '') key += '.hint';
  if (!has(key)) return problem.text;
  return t(key, params(problem, context));
}
