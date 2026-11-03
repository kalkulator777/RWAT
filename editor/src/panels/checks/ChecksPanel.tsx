import { useState } from 'preact/hooks';
import { findings, pack, schema, schemaError, selection } from '../../app/store';
import { problemMessage } from '../../checks/messages';
import type { Link, Severity } from '../../core/contracts';
import { t } from '../../i18n';

/** Where a finding points, as one line: `file` or `file /pointer`. */
function whereText(at: readonly Link[]): string {
  const first = at[0];
  if (first === undefined) return '';
  if (first.kind === 'file') return first.file;
  if (first.kind === 'field') return first.at === '' ? first.file : `${first.file} ${first.at}`;
  return '';
}

const SEVERITIES: readonly Severity[] = ['error', 'warning', 'info'];

/**
 * The "Checks" tab (editor.md §6.1, §2.5): the findings of the open pack, one line each
 * with its severity, its text in the interface language (translated by code,
 * checks/messages.ts; the engine's English line is the tooltip) and its place; the
 * severities can be hidden one by one; clicking a finding selects the places it points
 * at, which brings the inspector to that field. The findings are checked again a moment
 * after the last edit (app/store.ts `findings`).
 */
export function ChecksPanel() {
  const [hidden, setHidden] = useState<ReadonlySet<Severity>>(new Set());
  const open = pack.value;
  const list = findings.value;
  const schemaState = schemaError.value !== null ? 'failed' : schema.value === null ? 'loading' : 'loaded';
  const notes = (
    <>
      {schemaError.value !== null && (
        <p class="checks-note" role="status" data-testid="schema-error">
          {t('checks.schemaFailed', { detail: schemaError.value })}
        </p>
      )}
      {schemaError.value === null && schema.value === null && (
        <p class="checks-note" role="status">
          {t('checks.schemaLoading')}
        </p>
      )}
    </>
  );
  if (open === null) {
    return (
      <div class="checks" data-schema={schemaState}>
        {notes}
        <p class="slot-empty">{t('checks.noPack')}</p>
      </div>
    );
  }
  const counts = { error: 0, warning: 0, info: 0 };
  for (const problem of list) counts[problem.severity]++;
  const shown = list.filter((problem) => !hidden.has(problem.severity));
  const context = { pack: open, schema: schema.value };
  return (
    <div class="checks" data-testid="checks" data-count={list.length} data-schema={schemaState}>
      {notes}
      <div class="checks-bar">
        <p class="checks-summary" role="status" data-testid="checks-summary">
          {list.length === 0 ? t('checks.none') : t('checks.summary', { errors: counts.error, warnings: counts.warning, infos: counts.info })}
        </p>
        {list.length > 0 && (
          <div class="toggle" role="group" aria-label={t('checks.filter')}>
            {SEVERITIES.map((severity) => (
              <button
                key={severity}
                type="button"
                class="toggle-button"
                aria-pressed={!hidden.has(severity)}
                data-severity={severity}
                onClick={() => {
                  const next = new Set(hidden);
                  if (next.has(severity)) next.delete(severity);
                  else next.add(severity);
                  setHidden(next);
                }}
              >
                {t(`checks.filter.${severity}`, { count: counts[severity] })}
              </button>
            ))}
          </div>
        )}
      </div>
      <ul class="checks-list">
        {shown.map((problem, index) => (
          <li key={`${problem.code}:${whereText(problem.at)}:${index}`}>
            <button
              type="button"
              class={`finding finding-${problem.severity}`}
              data-code={problem.code}
              data-source={problem.source}
              title={problem.text}
              disabled={problem.at.length === 0}
              onClick={() => {
                selection.value = problem.at;
              }}
            >
              <span class="finding-severity">{t(`checks.severity.${problem.severity}`)}</span>
              <span class="finding-text">{problemMessage(problem, context)}</span>
              <span class="finding-where">{whereText(problem.at)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
