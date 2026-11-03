import { pack, problems, schema, schemaError, selection } from '../../app/store';
import type { Link } from '../../core/contracts';
import { t } from '../../i18n';

/** Where a finding points, as one line: `file` or `file /pointer`. */
function whereText(at: readonly Link[]): string {
  const first = at[0];
  if (first === undefined) return '';
  if (first.kind === 'file') return first.file;
  if (first.kind === 'field') return first.at === '' ? first.file : `${first.file} ${first.at}`;
  return '';
}

/**
 * The "Checks" tab (editor.md §6.1): the findings of the open pack, one line each with
 * its severity, text and place; clicking one selects the places it points at. The texts
 * are the engine's and the tools' own English words; their translations by code come
 * with the forms (M2).
 */
export function ChecksPanel() {
  const open = pack.value;
  const list = problems.value;
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
  return (
    <div class="checks" data-testid="checks" data-count={list.length} data-schema={schemaState}>
      {notes}
      <p class="checks-summary" role="status" data-testid="checks-summary">
        {list.length === 0 ? t('checks.none') : t('checks.summary', { errors: counts.error, warnings: counts.warning, infos: counts.info })}
      </p>
      <ul class="checks-list">
        {list.map((problem, index) => (
          <li key={`${problem.code}:${whereText(problem.at)}:${index}`}>
            <button
              type="button"
              class={`finding finding-${problem.severity}`}
              data-code={problem.code}
              disabled={problem.at.length === 0}
              onClick={() => {
                selection.value = problem.at;
              }}
            >
              <span class="finding-severity">{t(`checks.severity.${problem.severity}`)}</span>
              <span class="finding-text">{problem.text}</span>
              <span class="finding-where">{whereText(problem.at)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
