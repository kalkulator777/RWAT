import { useState } from 'preact/hooks';
import { pack, revision, schema, schemaError, selection } from '../../app/store';
import { problemMessage } from '../../checks/messages';
import { isStale, modelsOf, type SweepState } from '../../checks/model/all';
import type { Link, Problem, Severity } from '../../core/contracts';
import type { Pack } from '../../core/pack';
import { t } from '../../i18n';
import { modelSweep, shownFindings } from './findings';
import './checks.css';

/** Where a finding points, as one line: `file`, `file /pointer`, or the model's object. */
function whereText(at: readonly Link[]): string {
  const first = at[0];
  if (first === undefined) return '';
  if (first.kind === 'file') return first.file;
  if (first.kind === 'field') return first.at === '' ? first.file : `${first.file} ${first.at}`;
  if (first.kind === 'object') return `${first.model} ${first.name}`;
  return `${first.type} ${first.kind} ${first.index}`;
}

const SEVERITIES: readonly Severity[] = ['error', 'warning', 'info'];

function counts(list: readonly Problem[]): Record<Severity, number> {
  const out = { error: 0, warning: 0, info: 0 };
  for (const problem of list) out[problem.severity]++;
  return out;
}

/** The line of a run of "Check all models": its progress, how it ended, whether the pack changed since. */
function sweepLine(state: SweepState, open: Pack): string | null {
  if (state.status === 'running') return t('checks.models.progress', { done: state.done, total: state.total, model: state.current ?? '' });
  if (state.status === 'idle') return null;
  const found = counts([...state.results.values()].flat());
  const line =
    state.status === 'done'
      ? t('checks.models.done', { count: state.total, errors: found.error, warnings: found.warning })
      : t('checks.models.cancelled', { done: state.done, total: state.total });
  return isStale(state, open) ? `${line} ${t('checks.models.stale')}` : line;
}

/** "Check all models": the button, then the run's progress with a stop, or how it ended. */
function ModelsBar({ open }: { open: Pack }) {
  void revision.value; // the pack is mutable: its models and staleness follow its edits
  const state = modelSweep.state.value;
  const running = state.status === 'running';
  const models = modelsOf(open).length;
  const line = sweepLine(state, open);
  return (
    <div class="checks-models" data-testid="check-models-bar" data-status={state.status} data-stale={isStale(state, open)}>
      {running ? (
        <button type="button" data-testid="check-models-cancel" onClick={() => modelSweep.cancel()}>
          {t('checks.models.cancel')}
        </button>
      ) : (
        <button type="button" data-testid="check-models" disabled={models === 0} title={t('checks.models.hint')} onClick={() => void modelSweep.start(open)}>
          {t('checks.models.run')}
        </button>
      )}
      {running && <progress value={state.done} max={state.total} aria-label={t('checks.models.run')} />}
      {line !== null && (
        <span class="checks-models-status" role="status" data-testid="check-models-status">
          {line}
        </span>
      )}
    </div>
  );
}

/**
 * The "Checks" tab (editor.md §6.1, §2.5): the findings of the open pack, one line each
 * with its severity, its text in the interface language (translated by code,
 * checks/messages.ts; the engine's English line is the tooltip) and its place; the
 * severities can be hidden one by one; clicking a finding selects the places it points
 * at, which brings the inspector to that field and the markup tools to the zone, door or
 * chair. The findings are the pack's, the floor check's and the models' (./findings.ts),
 * checked again a moment after the last edit; "Check all models" reads every model of
 * the pack in the model worker and adds what the pack check says of each.
 */
export function ChecksPanel() {
  const [hidden, setHidden] = useState<ReadonlySet<Severity>>(new Set());
  const open = pack.value;
  const list = shownFindings.value;
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
  const found = counts(list);
  const shown = list.filter((problem) => !hidden.has(problem.severity));
  const context = { pack: open, schema: schema.value };
  return (
    <div class="checks" data-testid="checks" data-count={list.length} data-schema={schemaState}>
      {notes}
      <ModelsBar open={open} />
      <div class="checks-bar">
        <p class="checks-summary" role="status" data-testid="checks-summary">
          {list.length === 0 ? t('checks.none') : t('checks.summary', { errors: found.error, warnings: found.warning, infos: found.info })}
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
                {t(`checks.filter.${severity}`, { count: found[severity] })}
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
