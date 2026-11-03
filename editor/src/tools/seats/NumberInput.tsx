/**
 * A number typed into a tool's section of the inspector, applied on Enter or on leaving
 * the field; a text that is no number is said and kept, Escape takes the draft back.
 *
 * The floor tool's section has the same field of its own (tools/floor/FloorInspector.tsx,
 * not exported): one shared field in a `tools/common/` is the integrator's to make.
 */

import { useState } from 'preact/hooks';
import { numberText, parseNumber } from '../../forms/values';
import { t } from '../../i18n';

export function NumberInput(props: { id: string; label: string; value: number; disabled: boolean; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState(false);
  return (
    <span class="field-input-wrap field-input-short">
      <input
        id={props.id}
        type="text"
        class="field-input"
        inputMode="decimal"
        spellcheck={false}
        autoComplete="off"
        aria-label={props.label}
        aria-invalid={error ? 'true' : undefined}
        disabled={props.disabled}
        value={draft ?? numberText(props.value)}
        onInput={(event) => setDraft(event.currentTarget.value)}
        onChange={(event) => {
          const parsed = parseNumber(event.currentTarget.value);
          if ('error' in parsed) {
            setError(true);
            return;
          }
          setError(false);
          setDraft(null);
          if (parsed.value !== props.value) props.onCommit(parsed.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && draft !== null) {
            setDraft(null);
            setError(false);
            event.preventDefault();
          }
        }}
      />
      {error && (
        <span class="field-input-error" role="alert">
          {t('tools.seats.notNumber')}
        </span>
      )}
    </span>
  );
}
