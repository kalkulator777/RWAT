import { useState } from 'preact/hooks';
import { run } from '../../app/session';
import { pack } from '../../app/store';
import { t } from '../../i18n';
import { nameOps } from './model';

interface NameInputProps {
  /** The lang key. */
  nameKey: string;
  /** The namespace whose lang file a new name goes into. */
  namespace: string;
  /** Minecraft's language code: `en_us`, `ru_ru`. */
  lang: string;
  /** The name as it stands, or undefined. */
  value: string | undefined;
  /** What the game shows without the name. */
  fallback: string;
  /** The box's name for a screen reader. */
  label: string;
}

/**
 * A name in one language: committed on change (Enter or leaving the box) as one command of
 * the journal, an emptied box removes the key (the game shows the fallback, which is the
 * placeholder).
 */
export function NameInput(props: NameInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const open = pack.value;
  return (
    <input
      type="text"
      class="name-input"
      lang={props.lang.slice(0, 2)}
      value={draft ?? props.value ?? ''}
      placeholder={props.fallback}
      aria-label={props.label}
      data-lang={props.lang}
      disabled={open === null || open.readOnly}
      spellcheck={false}
      onInput={(event) => setDraft(event.currentTarget.value)}
      onChange={(event) => {
        const text = event.currentTarget.value;
        setDraft(null);
        if (open === null) return;
        const ops = nameOps(open, props.nameKey, props.namespace, props.lang, text);
        if (ops.length > 0) void run({ label: 'names.command.set', labelParams: { key: props.nameKey, lang: props.lang }, ops });
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setDraft(null);
      }}
    />
  );
}

/** The name of a wagon type or rail style in each language, as the inspector shows it above the form. */
export function NameFields(props: { nameKey: string; namespace: string; fallback: string; values: Record<string, string | undefined>; langs: readonly string[] }) {
  return (
    <fieldset class="name-fields" data-name-key={props.nameKey}>
      <legend>
        {t('names.inspector.legend')} <code>{props.nameKey}</code>
      </legend>
      {props.langs.map((code) => (
        <label key={code} class="name-field">
          <span class="name-lang">{code}</span>
          <NameInput
            nameKey={props.nameKey}
            namespace={props.namespace}
            lang={code}
            value={props.values[code]}
            fallback={props.fallback}
            label={t('names.input', { key: props.nameKey, lang: code })}
          />
        </label>
      ))}
    </fieldset>
  );
}
