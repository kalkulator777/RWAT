/**
 * The widgets of a form built from the schema (docs/proposals/editor.md §3.7), one per
 * kind of field descriptor (core/schema `FieldDescriber`): a number with its unit, a
 * string, an enumeration, a flag, a fixed tuple of numbers (`vec3`, a range `[a, b]`), a
 * list of scalars (`bogies`, `aliases`), an object, a dictionary (`liveries`, `sounds.doors`),
 * a list of objects, a choice of forms (`oneOf`: a sound loop is a string or an object),
 * and a free JSON value for a field of no fixed type.
 *
 * Every field shows what the schema says of it in the interface language: its description,
 * unit, status (reserved, pending engine), deprecation and frame, the engine's value when it
 * is left out (a constant `default`, or the `x-engine-default` formula with its number
 * figured, ./engineDefaults.ts), and the findings that point at it. An edit is a command of
 * the journal (`ctx.commit`); clearing a field removes its key, so the engine's value
 * applies again — an explicit 0 is not an empty field.
 */

import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { fitsType, isSpatial, variantOf } from '../checks/fields';
import { problemMessage } from '../checks/messages';
import type { Op, Problem } from '../core/contracts';
import { childPointer, getAt, isJsonObject } from '../core/json';
import type { FieldDescriptor } from '../core/schema';
import { formatNumber, formatQuantity, lang, pairText, t } from '../i18n';
import type { FormContext } from './context';
import { engineDefault } from './engineDefaults';
import { blankOf, looseText, numberText, parseLoose, parseNumber, removeOps, renameKeyOps, setOps } from './values';

interface FieldProps {
  d: FieldDescriptor;
  /** The field's place in the file. */
  at: string;
  ctx: FormContext;
  /** What the field is called on the screen: its key, or `key[i]` in a list. */
  label: string;
  /** Only the control, without the label and notes: a branch of a choice draws the choice's own. */
  bare?: boolean;
}

/** A stable id for the field's control: the file and the pointer hashed (FNV-1a), so ids stay valid and unique in the page. */
export function fieldId(file: string, at: string): string {
  let hash = 0x811c9dc5;
  for (const char of `${file}#${at}`) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `f-${hash.toString(36)}`;
}

function unitOf(d: FieldDescriptor): string {
  return d.unit ? (pairText(d.unit.label, lang.value) ?? d.unit.id) : '';
}

/** How the field names itself in the journal: its pointer without the leading '/'. */
function fieldName(at: string): string {
  return at === '' ? '/' : at.slice(1);
}

function commitOps(ctx: FormContext, ops: Op[], label: string, at: string): void {
  if (ops.length > 0) ctx.commit(ops, label, fieldName(at));
}

function set(ctx: FormContext, at: string, value: unknown): void {
  commitOps(ctx, setOps(ctx.file, ctx.root, at, value), 'forms.command.set', at);
}

function clear(ctx: FormContext, at: string): void {
  commitOps(ctx, removeOps(ctx.file, ctx.root, at), 'forms.command.remove', at);
}

/** The findings at the field, or at it and anything inside it. */
function problemsOf(ctx: FormContext, at: string, inside: boolean): Problem[] {
  if (!inside) return [...(ctx.problems.get(at) ?? [])];
  const found: Problem[] = [];
  for (const [place, list] of ctx.problems) if (place === at || place.startsWith(`${at}/`)) found.push(...list);
  return found;
}

function defaultValueText(value: unknown, unit: string): string {
  if (typeof value === 'number') return formatQuantity(value, unit);
  if (typeof value === 'boolean') return t(value ? 'forms.true' : 'forms.false');
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/** The engine's value of the field left out, as a number when the editor can figure it. */
function figured(d: FieldDescriptor, at: string, ctx: FormContext): number | undefined {
  if (d.engineDefault === undefined) return undefined;
  return engineDefault(ctx.kind, at, ctx.root);
}

/** What the engine takes when the field is left out, in words; undefined when the schema says nothing. */
function defaultLine(d: FieldDescriptor, at: string, ctx: FormContext): string | undefined {
  const unit = unitOf(d);
  const formula = d.engineDefault && pairText(d.engineDefault, lang.value);
  const number = figured(d, at, ctx);
  if (number !== undefined) return t('forms.default.engine', { value: formatQuantity(number, unit), formula: formula ?? '' });
  if (formula !== undefined) return t('forms.default.formula', { formula });
  if (d.hasDefault) return t('forms.default.constant', { value: defaultValueText(d.default, unit) });
  return undefined;
}

/** The placeholder of an empty number field: the engine's number. */
function placeholderOf(d: FieldDescriptor, at: string, ctx: FormContext): string {
  const number = figured(d, at, ctx);
  if (number !== undefined) return formatNumber(number);
  return d.hasDefault && typeof d.default === 'number' ? formatNumber(d.default) : '';
}

/** A note of the schema as a sentence: its first letter capitalised (`x-status-note` starts in lower case). */
function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The field's status (its meaning is the badge's tooltip, its note is under the field), deprecation and frame. */
function Badges({ d, ctx }: { d: FieldDescriptor; ctx: FormContext }) {
  return (
    <>
      {d.status && (
        <span class="field-badge badge-status" data-status={d.status.id} title={pairText(d.status.meaning, lang.value)}>
          {pairText(d.status.label, lang.value)}
        </span>
      )}
      {d.deprecated && <span class="field-badge badge-deprecated">{t('forms.deprecated')}</span>}
      {d.frame !== undefined && <span class="field-badge badge-frame">{t('forms.frame', { frame: ctx.frameName(d.frame) })}</span>}
    </>
  );
}

function ProblemList({ list, ctx }: { list: readonly Problem[]; ctx: FormContext }) {
  if (list.length === 0) return null;
  return (
    <ul class="field-problems">
      {list.map((problem, i) => (
        <li key={`${problem.code}:${i}`} class={`field-problem field-problem-${problem.severity}`} data-code={problem.code}>
          <strong>{t(`checks.severity.${problem.severity}`)}:</strong> {problemMessage(problem, ctx.messages)}
        </li>
      ))}
    </ul>
  );
}

interface ShellProps extends FieldProps {
  id: string;
  children: ComponentChildren;
  /** A fieldset with a legend (objects, lists, choices) rather than a label for one control. */
  group?: boolean;
  /** Show the findings inside the field too (a field drawn as a summary). */
  problemsInside?: boolean;
  /** A note under the control (a wrong type, the spatial summary). */
  note?: ComponentChildren;
  /** Buttons next to the label (add or remove a section). */
  actions?: ComponentChildren;
}

/** The frame of a field: its name and badges, the control, then the default, the status, the findings and the description. */
function FieldShell(props: ShellProps) {
  const { d, at, ctx, label, id } = props;
  if (props.bare === true) return <>{props.children}</>;
  const problems = problemsOf(ctx, at, props.problemsInside === true);
  const severity = problems.some((p) => p.severity === 'error') ? 'error' : problems.some((p) => p.severity === 'warning') ? 'warning' : null;
  const help = pairText(d.description, lang.value);
  const fallback = defaultLine(d, at, ctx);
  const head = (
    <>
      <span class="field-name">{label}</span>
      {d.required && (
        <abbr class="field-required" title={t('forms.required')}>
          *
        </abbr>
      )}
      <Badges d={d} ctx={ctx} />
    </>
  );
  const notes = (
    <div class="field-notes" id={`${id}-notes`}>
      {props.note}
      {fallback !== undefined && <p class="field-default">{fallback}</p>}
      {d.status && (
        <p class="field-status-note">{sentence(pairText(d.status.note, lang.value) || pairText(d.status.meaning, lang.value) || '')}</p>
      )}
      {d.deprecated && <p class="field-status-note">{t('forms.deprecated.hint')}</p>}
      <ProblemList list={problems} ctx={ctx} />
      {help !== undefined && <p class="field-help">{help}</p>}
    </div>
  );
  const classes = `field field-${d.shape}${severity ? ` field-has-${severity}` : ''}`;
  if (props.group === true) {
    return (
      <fieldset class={`${classes} field-group`} data-pointer={at} aria-describedby={`${id}-notes`}>
        <legend class="field-head">
          {head}
          {props.actions}
        </legend>
        {notes}
        <div class="field-body">{props.children}</div>
      </fieldset>
    );
  }
  return (
    <div class={classes} data-pointer={at}>
      <div class="field-head">
        <label for={id}>{head}</label>
        {props.actions}
      </div>
      <div class="field-control">{props.children}</div>
      {notes}
    </div>
  );
}

interface TextInputProps {
  id: string;
  value: string;
  ctx: FormContext;
  /** Commits the typed text; returns the i18n key of why it was refused, or null. */
  onCommit: (text: string) => string | null;
  placeholder?: string;
  label?: string;
  invalid?: boolean;
  describedBy?: string;
  required?: boolean;
  numeric?: boolean;
  class?: string;
}

/**
 * A text box that commits on change (Enter or leaving it), not on every key, so one edit
 * is one command of the journal. What is typed stays until it is committed or Escape drops it.
 */
function TextInput(props: TextInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commit = (text: string): void => {
    const refused = props.onCommit(text);
    setError(refused);
    if (refused === null) setDraft(null);
  };
  return (
    <span class={`field-input-wrap ${props.class ?? ''}`}>
      <input
        id={props.id}
        type="text"
        class="field-input"
        value={draft ?? props.value}
        placeholder={props.placeholder}
        aria-label={props.label}
        aria-invalid={props.invalid === true || error !== null ? 'true' : undefined}
        aria-describedby={[props.describedBy, error === null ? undefined : `${props.id}-error`].filter(Boolean).join(' ') || undefined}
        aria-required={props.required === true ? 'true' : undefined}
        inputMode={props.numeric === true ? 'decimal' : undefined}
        spellcheck={false}
        autoComplete="off"
        disabled={props.ctx.readOnly}
        onInput={(event) => setDraft(event.currentTarget.value)}
        onChange={(event) => commit(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && draft !== null) {
            setDraft(null);
            setError(null);
            event.preventDefault();
          }
        }}
      />
      {error !== null && (
        <span class="field-input-error" id={`${props.id}-error`} role="alert">
          {t(error, { pattern: '' })}
        </span>
      )}
    </span>
  );
}

function hasErrors(ctx: FormContext, at: string): boolean {
  return (ctx.problems.get(at) ?? []).some((p) => p.severity === 'error');
}

function NumberField(props: FieldProps) {
  const { d, at, ctx, label } = props;
  const id = fieldId(ctx.file, at);
  const value = getAt(ctx.root, at);
  const unit = unitOf(d);
  return (
    <FieldShell {...props} id={id}>
      <TextInput
        id={id}
        ctx={ctx}
        numeric
        value={typeof value === 'number' ? numberText(value) : value === undefined ? '' : JSON.stringify(value)}
        placeholder={placeholderOf(d, at, ctx)}
        label={props.bare === true ? label : undefined}
        invalid={hasErrors(ctx, at)}
        describedBy={`${id}-notes`}
        required={d.required}
        onCommit={(text) => {
          if (text.trim() === '') {
            clear(ctx, at);
            return null;
          }
          const parsed = parseNumber(text, d.shape === 'integer');
          if ('error' in parsed) return `forms.error.${parsed.error}`;
          if (parsed.value !== value) set(ctx, at, parsed.value);
          return null;
        }}
      />
      {unit !== '' && <span class="field-unit">{unit}</span>}
    </FieldShell>
  );
}

function StringField(props: FieldProps) {
  const { d, at, ctx, label } = props;
  const id = fieldId(ctx.file, at);
  const value = getAt(ctx.root, at);
  return (
    <FieldShell {...props} id={id}>
      <TextInput
        id={id}
        ctx={ctx}
        class="field-input-wide"
        value={typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value)}
        placeholder={d.hasDefault && typeof d.default === 'string' ? d.default : undefined}
        label={props.bare === true ? label : undefined}
        invalid={hasErrors(ctx, at)}
        describedBy={`${id}-notes`}
        required={d.required}
        onCommit={(text) => {
          if (text === '') clear(ctx, at);
          else if (text !== value) set(ctx, at, text);
          return null;
        }}
      />
    </FieldShell>
  );
}

function EnumField(props: FieldProps) {
  const { d, at, ctx, label } = props;
  const id = fieldId(ctx.file, at);
  const value = getAt(ctx.root, at);
  const options = d.enum ?? [];
  const index = value === undefined ? -1 : options.findIndex((option) => JSON.stringify(option) === JSON.stringify(value));
  const selected = value === undefined ? '' : index < 0 ? 'other' : String(index);
  const unset = d.hasDefault ? t('forms.unsetDefault', { value: defaultValueText(d.default, unitOf(d)) }) : t('forms.unset');
  return (
    <FieldShell {...props} id={id}>
      <select
        id={id}
        class="field-select"
        value={selected}
        aria-label={props.bare === true ? label : undefined}
        aria-describedby={`${id}-notes`}
        aria-invalid={hasErrors(ctx, at) ? 'true' : undefined}
        disabled={ctx.readOnly}
        onChange={(event) => {
          const choice = event.currentTarget.value;
          if (choice === '') clear(ctx, at);
          else if (choice !== 'other') set(ctx, at, options[Number(choice)]);
        }}
      >
        <option value="">{unset}</option>
        {options.map((option, i) => (
          <option key={i} value={String(i)}>
            {typeof option === 'string' ? option : JSON.stringify(option)}
          </option>
        ))}
        {selected === 'other' && <option value="other">{JSON.stringify(value)}</option>}
      </select>
    </FieldShell>
  );
}

function BooleanField(props: FieldProps) {
  const { d, at, ctx, label } = props;
  const id = fieldId(ctx.file, at);
  const value = getAt(ctx.root, at);
  const effective = typeof value === 'boolean' ? value : d.hasDefault && d.default === true;
  const reset =
    value !== undefined && !ctx.readOnly ? (
      <button type="button" class="field-action" aria-label={t('forms.reset.label', { field: label })} onClick={() => clear(ctx, at)}>
        {t('forms.reset')}
      </button>
    ) : null;
  return (
    <FieldShell {...props} id={id} actions={props.bare === true ? undefined : reset}>
      <input
        id={id}
        type="checkbox"
        class="field-check"
        checked={effective}
        data-set={value !== undefined ? 'true' : 'false'}
        aria-label={props.bare === true ? label : undefined}
        aria-describedby={`${id}-notes`}
        disabled={ctx.readOnly}
        onChange={(event) => set(ctx, at, event.currentTarget.checked)}
      />
    </FieldShell>
  );
}

/** The scalar a list or tuple element's text means, or why it means none. */
function parseScalar(d: FieldDescriptor, text: string): { value: unknown } | { error: string } {
  if (d.shape === 'number' || d.shape === 'integer') {
    const parsed = parseNumber(text, d.shape === 'integer');
    return 'error' in parsed ? { error: `forms.error.${parsed.error}` } : parsed;
  }
  if (d.shape === 'boolean') return { value: text.trim() === 'true' };
  if (d.shape === 'string') return { value: text };
  return { value: parseLoose(text) };
}

function scalarText(value: unknown): string {
  if (typeof value === 'number') return numberText(value);
  if (typeof value === 'string') return value;
  return value === undefined ? '' : JSON.stringify(value);
}

/** An array of a fixed number of scalars (`vec3`, a range `[a, b]`): one box per element. */
function TupleField(props: FieldProps & { size: number }) {
  const { d, at, ctx, label, size } = props;
  const id = fieldId(ctx.file, at);
  const value = getAt(ctx.root, at);
  const items = d.items as FieldDescriptor;
  const list: readonly unknown[] | null = Array.isArray(value) ? value : null;
  const whole = list !== null && list.length === size;
  const unit = unitOf(d) || unitOf(items);
  const clearButton =
    value !== undefined && !ctx.readOnly && props.bare !== true ? (
      <button type="button" class="field-action" aria-label={t('forms.reset.label', { field: label })} onClick={() => clear(ctx, at)}>
        {t('forms.reset')}
      </button>
    ) : null;
  return (
    <FieldShell {...props} id={id} group actions={clearButton}>
      <div class="field-tuple">
        {Array.from({ length: size }, (_, i) => (
          <TextInput
            key={i}
            id={i === 0 ? id : `${id}-${i}`}
            ctx={ctx}
            numeric={items.shape === 'number' || items.shape === 'integer'}
            class="field-input-short"
            value={list === null ? '' : scalarText(list[i])}
            label={t('forms.list.item', { field: label, index: i })}
            describedBy={`${id}-notes`}
            invalid={hasErrors(ctx, at) || hasErrors(ctx, childPointer(at, i))}
            onCommit={(text) => {
              if (text.trim() === '') return null; // an element of a tuple cannot be left out: Reset clears the whole field
              const parsed = parseScalar(items, text);
              if ('error' in parsed) return parsed.error;
              if (whole) {
                if (list[i] !== parsed.value) set(ctx, childPointer(at, i), parsed.value);
              } else {
                const blank = blankOf(items.types);
                set(ctx, at, Array.from({ length: size }, (_, j) => (j === i ? parsed.value : (list?.[j] ?? blank))));
              }
              return null;
            }}
          />
        ))}
        {unit !== '' && <span class="field-unit">{unit}</span>}
      </div>
    </FieldShell>
  );
}

/** A list of scalars of any length (`bogies`, `aliases`, `authors`): a box per element and one more to add. */
function ScalarListField(props: FieldProps) {
  const { d, at, ctx, label } = props;
  const id = fieldId(ctx.file, at);
  const value = getAt(ctx.root, at);
  const items = d.items as FieldDescriptor;
  const list = Array.isArray(value) ? value : [];
  const numeric = items.shape === 'number' || items.shape === 'integer';
  const unit = unitOf(d) || unitOf(items);
  return (
    <FieldShell {...props} id={id} group>
      <ol class="field-list">
        {list.map((item, i) => {
          const itemAt = childPointer(at, i);
          return (
            <li key={i} class="field-list-item" data-pointer={itemAt}>
              <TextInput
                id={i === 0 ? id : `${id}-${i}`}
                ctx={ctx}
                numeric={numeric}
                class={numeric ? 'field-input-short' : undefined}
                value={scalarText(item)}
                label={t('forms.list.item', { field: label, index: i })}
                describedBy={`${id}-notes`}
                invalid={hasErrors(ctx, itemAt)}
                onCommit={(text) => {
                  if (text.trim() === '') {
                    clear(ctx, itemAt);
                    return null;
                  }
                  const parsed = parseScalar(items, text);
                  if ('error' in parsed) return parsed.error;
                  if (parsed.value !== item) set(ctx, itemAt, parsed.value);
                  return null;
                }}
              />
              {!ctx.readOnly && (
                <button type="button" class="field-remove" aria-label={t('forms.list.remove', { field: label, index: i })} onClick={() => clear(ctx, itemAt)}>
                  ×
                </button>
              )}
            </li>
          );
        })}
        {!ctx.readOnly && (
          <li class="field-list-item field-list-new">
            <TextInput
              id={list.length === 0 ? id : `${id}-new`}
              ctx={ctx}
              numeric={numeric}
              class={numeric ? 'field-input-short' : undefined}
              value=""
              placeholder={t('forms.list.newPlaceholder')}
              label={t('forms.list.new', { field: label })}
              describedBy={`${id}-notes`}
              onCommit={(text) => {
                if (text.trim() === '') return null;
                const parsed = parseScalar(items, text);
                if ('error' in parsed) return parsed.error;
                if (Array.isArray(value)) commitOps(ctx, [{ op: 'insert', file: ctx.file, at: childPointer(at, '-'), value: parsed.value }], 'forms.command.add', at);
                else set(ctx, at, [parsed.value]);
                return null;
              }}
            />
          </li>
        )}
      </ol>
      {unit !== '' && <span class="field-unit">{unit}</span>}
    </FieldShell>
  );
}

/** A list of objects: each element a group of its fields, with a button to remove it and one to add another. */
function ObjectListField(props: FieldProps) {
  const { d, at, ctx, label } = props;
  const id = fieldId(ctx.file, at);
  const value = getAt(ctx.root, at);
  const items = d.items as FieldDescriptor;
  const list = Array.isArray(value) ? value : [];
  return (
    <FieldShell {...props} id={id} group>
      {list.map((_item, i) => (
        <div key={i} class="field-entry">
          <Field d={items} at={childPointer(at, i)} ctx={ctx} label={t('forms.list.item', { field: label, index: i })} />
          {!ctx.readOnly && (
            <button type="button" class="field-remove" aria-label={t('forms.list.remove', { field: label, index: i })} onClick={() => clear(ctx, childPointer(at, i))}>
              ×
            </button>
          )}
        </div>
      ))}
      {!ctx.readOnly && (
        <button
          type="button"
          class="field-action"
          onClick={() => {
            const blank = blankOf(items.types);
            if (Array.isArray(value)) commitOps(ctx, [{ op: 'insert', file: ctx.file, at: childPointer(at, '-'), value: blank }], 'forms.command.add', at);
            else set(ctx, at, [blank]);
          }}
        >
          {t('forms.list.addItem', { field: label })}
        </button>
      )}
    </FieldShell>
  );
}

/** A dictionary (`liveries`, `animations`, `sounds.doors`, `sounds.controls`): a field per key, and a row to add a key. */
function DictField(props: FieldProps) {
  const { d, at, ctx, label } = props;
  const id = fieldId(ctx.file, at);
  const value = getAt(ctx.root, at);
  const values = d.values as FieldDescriptor;
  const keys = isJsonObject(value) ? Object.keys(value) : [];
  const scalar = ['string', 'number', 'integer'].includes(values.shape);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [error, setError] = useState<{ key: string; pattern?: string } | null>(null);
  const add = (): void => {
    const key = newKey.trim();
    if (key === '') return setError({ key: 'forms.error.key-empty' });
    if (keys.includes(key)) return setError({ key: 'forms.error.key-exists' });
    if (d.keyPattern !== undefined && !new RegExp(d.keyPattern, 'u').test(key)) return setError({ key: 'forms.error.key-pattern', pattern: d.keyPattern });
    let item = blankOf(values.types);
    if (scalar && newValue.trim() !== '') {
      const parsed = parseScalar(values, newValue);
      if ('error' in parsed) return setError({ key: parsed.error });
      item = parsed.value;
    }
    setError(null);
    setNewKey('');
    setNewValue('');
    commitOps(ctx, setOps(ctx.file, ctx.root, childPointer(at, key), item), 'forms.command.add', at);
  };
  return (
    <FieldShell {...props} id={id} group>
      {keys.map((key) => (
        <div key={key} class="field-entry">
          <Field d={values} at={childPointer(at, key)} ctx={ctx} label={key} />
          {!ctx.readOnly && (
            <button type="button" class="field-remove" aria-label={t('forms.dict.remove', { key })} onClick={() => clear(ctx, childPointer(at, key))}>
              ×
            </button>
          )}
        </div>
      ))}
      {!ctx.readOnly && (
        <div class="field-dict-add">
          <input
            id={id}
            type="text"
            class="field-input"
            value={newKey}
            aria-label={t('forms.dict.newKey', { field: label })}
            spellcheck={false}
            autoComplete="off"
            onInput={(event) => setNewKey(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') add();
            }}
          />
          {scalar && (
            <input
              type="text"
              class="field-input"
              value={newValue}
              aria-label={t('forms.dict.newValue', { field: label })}
              spellcheck={false}
              autoComplete="off"
              onInput={(event) => setNewValue(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') add();
              }}
            />
          )}
          <button type="button" class="field-action" onClick={add}>
            {t('forms.dict.add')}
          </button>
          {error !== null && (
            <span class="field-input-error" role="alert">
              {t(error.key, { pattern: error.pattern ?? '' })}
            </span>
          )}
        </div>
      )}
    </FieldShell>
  );
}

/** Keys of an object that its schema does not know, with the nearest known one as a quick rename (§3.7). */
function UnknownKeys({ d, at, ctx, value }: { d: FieldDescriptor; at: string; ctx: FormContext; value: Record<string, unknown> }) {
  const known = new Set((d.properties ?? []).map((p) => p.key));
  const unknown = Object.keys(value).filter((key) => !known.has(key) && !(d.comments && key.startsWith('_')));
  if (unknown.length === 0 || d.values !== undefined) return null;
  return (
    <div class="field-unknown" role="group" aria-label={t('forms.unknown.title')}>
      <p class="field-unknown-title">{t('forms.unknown.title')}</p>
      <ul>
        {unknown.map((key) => {
          const place = childPointer(at, key);
          const findings = ctx.problems.get(place) ?? [];
          const nearest = findings.map((p) => p.params.nearest).find((n): n is string => typeof n === 'string' && n !== '');
          return (
            <li key={key} data-pointer={place}>
              <code>{key}</code>
              <ProblemList list={findings} ctx={ctx} />
              {!ctx.readOnly && nearest !== undefined && !Object.hasOwn(value, nearest) && (
                <button type="button" class="field-action" onClick={() => commitOps(ctx, renameKeyOps(ctx.file, ctx.root, at, key, nearest), 'forms.command.rename', place)}>
                  {t('forms.unknown.rename', { key, nearest })}
                </button>
              )}
              {!ctx.readOnly && (
                <button type="button" class="field-action" onClick={() => clear(ctx, place)}>
                  {t('forms.unknown.remove', { key })}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** An object: its fields in the schema's order; a section that is not there can be added, one that is there removed. */
function ObjectField(props: FieldProps) {
  const { d, at, ctx, label } = props;
  const id = fieldId(ctx.file, at);
  const value = getAt(ctx.root, at);
  const object = isJsonObject(value) ? value : undefined;
  const fields = (
    <>
      {(d.properties ?? []).map((p) => (
        <Field key={p.key} d={p} at={childPointer(at, p.key as string)} ctx={ctx} label={p.key as string} />
      ))}
      {object && <UnknownKeys d={d} at={at} ctx={ctx} value={object} />}
    </>
  );
  if (at === '' || props.bare === true) return <div class="field-object-body">{fields}</div>;
  const actions = ctx.readOnly ? null : value === undefined ? (
    <button type="button" class="field-action" onClick={() => set(ctx, at, {})}>
      {t('forms.section.add', { field: label })}
    </button>
  ) : d.required ? null : (
    <button type="button" class="field-action" onClick={() => clear(ctx, at)}>
      {t('forms.section.remove', { field: label })}
    </button>
  );
  return (
    <FieldShell {...props} id={id} group actions={actions}>
      <div class="field-object-body" data-present={value !== undefined ? 'true' : 'false'}>
        {fields}
      </div>
    </FieldShell>
  );
}

function variantLabel(v: FieldDescriptor): string {
  if (v.shape === 'object') return t('forms.variant.object', { keys: (v.properties ?? []).map((p) => p.key).join(', ') });
  return ['string', 'number', 'integer', 'boolean', 'array'].includes(v.shape) ? t(`forms.variant.${v.shape}`) : v.shape;
}

/** The value carried into another form of a choice: a string into the object's first property that takes it (`main`), and back. */
function convert(value: unknown, to: FieldDescriptor): unknown {
  if (value === undefined) return undefined;
  if (to.shape === 'object') {
    if (isJsonObject(value)) return value;
    const required = (to.properties ?? []).filter((p) => p.required);
    const slot = [...required, ...(to.properties ?? [])].find((p) => fitsType(p, value));
    return slot ? { [slot.key as string]: value } : {};
  }
  if (isJsonObject(value)) return Object.values(value).find((v) => fitsType(to, v));
  return fitsType(to, value) ? value : undefined;
}

/** A `oneOf`: the form of the value (radio buttons), then the field of that form. */
function ChoiceField(props: FieldProps) {
  const { d, at, ctx, label } = props;
  const id = fieldId(ctx.file, at);
  const value = getAt(ctx.root, at);
  const variants = d.variants ?? [];
  const current = variantOf(d, value);
  const [picked, setPicked] = useState<number | null>(null);
  const index = current !== undefined ? variants.indexOf(current) : picked;
  const chosen = index === null ? undefined : variants[index];
  return (
    <FieldShell {...props} id={id} group>
      <div class="field-variants" role="radiogroup" aria-label={t('forms.variant.label', { field: label })}>
        {variants.map((v, i) => (
          <label key={i} class="field-variant">
            <input
              type="radio"
              id={`${id}-v${i}`}
              name={`${id}-variant`}
              checked={i === index}
              disabled={ctx.readOnly}
              onChange={() => {
                setPicked(i);
                if (value === undefined || i === index) return;
                const next = convert(value, v);
                if (next === undefined || next === '') clear(ctx, at);
                else set(ctx, at, next);
              }}
            />
            {variantLabel(v)}
          </label>
        ))}
      </div>
      {chosen !== undefined && <Field d={chosen} at={at} ctx={ctx} label={label} bare />}
    </FieldShell>
  );
}

/** A value of no fixed type (`pack.description`: a string or a text component): JSON, or plain text as a string. */
function LooseField(props: FieldProps & { note?: ComponentChildren }) {
  const { d, at, ctx, label } = props;
  const id = fieldId(ctx.file, at);
  const value = getAt(ctx.root, at);
  return (
    <FieldShell {...props} id={id} note={props.note}>
      <TextInput
        id={id}
        ctx={ctx}
        class="field-input-wide"
        value={looseText(value)}
        placeholder={t('forms.loose')}
        label={props.bare === true ? label : undefined}
        invalid={hasErrors(ctx, at)}
        describedBy={`${id}-notes`}
        required={d.required}
        onCommit={(text) => {
          if (text.trim() === '') clear(ctx, at);
          else if (JSON.stringify(parseLoose(text)) !== JSON.stringify(value)) set(ctx, at, parseLoose(text));
          return null;
        }}
      />
    </FieldShell>
  );
}

/** Spatial markup (zones, doors, chairs): shown as a summary with its findings; it is edited in the 3D view (M4). */
function SpatialField(props: FieldProps) {
  const { at, ctx } = props;
  const id = fieldId(ctx.file, at);
  const value = getAt(ctx.root, at);
  const summary = Array.isArray(value) ? t('forms.spatial.count', { count: value.length }) : value === undefined ? t('forms.spatial.unset') : t('forms.spatial.set');
  return (
    <FieldShell {...props} id={id} group problemsInside note={<p class="field-spatial">{t('forms.spatial', { summary })}</p>}>
      {null}
    </FieldShell>
  );
}

const SCALARS = new Set(['number', 'integer', 'string', 'boolean']);

/** The widget of a field by its descriptor. */
export function Field(props: FieldProps) {
  const { d, at, ctx } = props;
  const value = getAt(ctx.root, at);
  if (d.deprecated && value === undefined) return null; // an old form is shown only where a file still has it
  if (d.shape === 'null') return null;
  if (ctx.spatialNote && isSpatial(d)) return <SpatialField {...props} />;
  if (value !== undefined && !fitsType(d, value) && d.shape !== 'any') {
    return <LooseField {...props} note={<p class="field-wrong-type">{t('forms.wrongType')}</p>} />;
  }
  if (d.enum !== undefined) return <EnumField {...props} />;
  switch (d.shape) {
    case 'number':
    case 'integer':
      return <NumberField {...props} />;
    case 'string':
      return <StringField {...props} />;
    case 'boolean':
      return <BooleanField {...props} />;
    case 'object':
      return d.values !== undefined && (d.properties ?? []).length === 0 ? <DictField {...props} /> : <ObjectField {...props} />;
    case 'array': {
      const items = d.items;
      if (items === undefined) return <LooseField {...props} />;
      if (SCALARS.has(items.shape) && items.enum === undefined) {
        const { minItems, maxItems } = d.limits;
        return minItems !== undefined && minItems === maxItems ? <TupleField {...props} size={minItems} /> : <ScalarListField {...props} />;
      }
      return <ObjectListField {...props} />;
    }
    case 'oneOf':
    case 'anyOf':
      return <ChoiceField {...props} />;
    case 'const':
      return (
        <FieldShell {...props} id={fieldId(ctx.file, at)}>
          <code id={fieldId(ctx.file, at)}>{JSON.stringify(d.const)}</code>
        </FieldShell>
      );
    default:
      return <LooseField {...props} />;
  }
}
