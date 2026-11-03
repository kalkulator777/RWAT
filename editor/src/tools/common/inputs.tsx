/**
 * The fields a markup tool's section of the inspector types into (docs/proposals/editor.md
 * §6.3: all a gesture does, by keyboard): a value applied on Enter or on leaving the field;
 * a text that does not read is said and kept until it is fixed or Escape takes the draft
 * back. The zones, doors and chairs tools type their numbers into {@link NumberInput}, the
 * doors tool a door's id and group into {@link TextInput}.
 */

import { useState } from 'preact/hooks';
import { numberText, parseNumber } from '../../forms/values';
import { t } from '../../i18n';

export interface TextInputProps {
  id: string;
  label: string;
  text: string;
  disabled: boolean;
  /** A short field (a number of a grid). */
  short?: boolean;
  /** Numbers are typed: the keyboard of decimals. */
  numeric?: boolean;
  /** What the text is: fine, or the error to say. */
  parse: (text: string) => { error: string } | { ok: true };
  /** A text that reads and differs from {@link text}. */
  onCommit: (text: string) => void;
}

/** A value typed in, applied on Enter or leaving the field: `parse` says what the text is, or the error to say. */
export function TextInput(props: TextInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <span class={props.short === true ? 'field-input-wrap field-input-short' : 'field-input-wrap'}>
      <input
        id={props.id}
        type="text"
        class="field-input"
        inputMode={props.numeric === true ? 'decimal' : 'text'}
        spellcheck={false}
        autoComplete="off"
        aria-label={props.label}
        aria-invalid={error !== null ? 'true' : undefined}
        disabled={props.disabled}
        value={draft ?? props.text}
        onInput={(event) => setDraft(event.currentTarget.value)}
        onChange={(event) => {
          const text = event.currentTarget.value;
          const parsed = props.parse(text);
          if ('error' in parsed) {
            setError(parsed.error);
            return;
          }
          setError(null);
          setDraft(null);
          if (text !== props.text) props.onCommit(text);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && draft !== null) {
            setDraft(null);
            setError(null);
            event.preventDefault();
          }
        }}
      />
      {error !== null && (
        <span class="field-input-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

/** A number typed in, short, as the forms write numbers (forms/values); applied when it reads and differs from `value`. */
export function NumberInput(props: { id: string; label: string; value: number; disabled: boolean; onCommit: (value: number) => void }) {
  return (
    <TextInput
      id={props.id}
      label={props.label}
      text={numberText(props.value)}
      disabled={props.disabled}
      short
      numeric
      parse={(text) => ('error' in parseNumber(text) ? { error: t('tools.notNumber') } : { ok: true })}
      onCommit={(text) => {
        const parsed = parseNumber(text);
        if ('value' in parsed && parsed.value !== props.value) props.onCommit(parsed.value);
      }}
    />
  );
}
