import { useState } from 'preact/hooks';
import { run } from '../../app/session';
import { pack, revision } from '../../app/store';
import type { Op } from '../../core/contracts';
import { lightNameKey } from '../../core/pack';
import { t } from '../../i18n';
import { nameLangs, nameOps, nameRows } from './model';
import { NameInput } from './NameInput';

/** Adds the name of a light group of a type by hand (the groups of the OBJ are listed once the model is parsed, M3). */
function AddLight({ langs }: { langs: readonly string[] }) {
  const open = pack.value;
  const types = (open?.stock() ?? []).filter((entry) => entry.type !== null).map((entry) => entry.id);
  const [type, setType] = useState('');
  const [group, setGroup] = useState('');
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  if (open === null || open.readOnly || types.length === 0) return null;
  const chosen = types.includes(type) ? type : (types[0] as string);
  const add = (): void => {
    const name = group.trim();
    if (!/^[A-Za-z0-9_]+$/.test(name)) return setError('names.light.badGroup');
    const key = lightNameKey(chosen, name);
    const namespace = chosen.slice(0, chosen.indexOf(':'));
    const ops: Op[] = langs.flatMap((code) => nameOps(open, key, namespace, code, (texts[code] ?? '').trim()));
    if (ops.length === 0) return setError('names.light.noText');
    setError(null);
    setGroup('');
    setTexts({});
    void run({ label: 'names.command.set', labelParams: { key, lang: langs.join(', ') }, ops });
  };
  return (
    <fieldset class="names-add" data-testid="names-add-light">
      <legend>{t('names.light.legend')}</legend>
      <label>
        {t('names.light.type')}
        <select value={chosen} onChange={(event) => setType(event.currentTarget.value)}>
          {types.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('names.light.group')}
        <input type="text" value={group} spellcheck={false} onInput={(event) => setGroup(event.currentTarget.value)} />
      </label>
      {langs.map((code) => (
        <label key={code}>
          {code}
          <input type="text" lang={code.slice(0, 2)} value={texts[code] ?? ''} onInput={(event) => setTexts({ ...texts, [code]: event.currentTarget.value })} />
        </label>
      ))}
      <button type="button" onClick={add}>
        {t('names.light.add')}
      </button>
      {error !== null && (
        <span class="field-input-error" role="alert">
          {t(error)}
        </span>
      )}
    </fieldset>
  );
}

/**
 * The "Names" tab (editor.md §2.1 step 5, §6.1): every lang key of the pack's wagons,
 * rail styles and light groups, and the other keys its lang files have, with the name in
 * English and Russian (and any other language the pack has), each edited in place.
 */
export function NamesPanel() {
  void revision.value;
  const open = pack.value;
  if (open === null) return <p class="slot-empty">{t('names.noPack')}</p>;
  const langs = nameLangs(open);
  const rows = nameRows(open, langs);
  return (
    <div class="names" data-testid="names">
      <table class="names-table">
        <caption>{t('names.caption')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('names.key')}</th>
            {langs.map((code) => (
              <th key={code} scope="col">
                {code}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} data-key={row.key} data-kind={row.kind}>
              <th scope="row">
                <code class="names-key">{row.key}</code> <span class="names-kind">{t(`names.kind.${row.kind}`)}</span>
              </th>
              {langs.map((code) => (
                <td key={code}>
                  <NameInput
                    nameKey={row.key}
                    namespace={row.namespace}
                    lang={code}
                    value={row.values[code]?.value}
                    fallback={row.kind === 'light' ? t('names.fallback.light', { group: row.fallback }) : row.fallback}
                    label={t('names.input', { key: row.key, lang: code })}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p class="slot-empty">{t('names.empty')}</p>}
      <AddLight langs={langs} />
    </div>
  );
}
