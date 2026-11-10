/**
 * «Двери по именам» in the doors tool's section of the inspector (docs/proposals/editor.md
 * §3.9, M6): what the button does and which names it reads, the call with its progress and its
 * stop, and the draft: the doors found, each told from the ones the type has already (by id),
 * what the floor check would newly say with them, «Принять» and «Отклонить». Everything by
 * keyboard as by mouse.
 */

import { problemMessage } from '../../checks/messages';
import { formatNumber, t } from '../../i18n';
import type { ToolSubject } from '../registry';
import type { DoorsByNames } from './doors';
import { PythonProgress } from './PythonProgress';
import { objSource } from './subject';
import '../common/section.css';
import './suggest.css';

/** The kind of a door found, as the doors tool words its kinds. */
function kindOf(door: Record<string, unknown>): string {
  return t(`tools.doors.kind.${door.inner === true ? 'inner' : door.connecting === true ? 'connecting' : 'outer'}`);
}

function box(door: { min: readonly number[]; max: readonly number[] }): string {
  return `x ${formatNumber(door.min[0] as number)}…${formatNumber(door.max[0] as number)}, y ${formatNumber(door.min[1] as number)}…${formatNumber(door.max[1] as number)}, z ${formatNumber(door.min[2] as number)}…${formatNumber(door.max[2] as number)}`;
}

function Draft({ by, readOnly }: { by: DoorsByNames; readOnly: boolean }) {
  const outcome = by.outcome.value;
  if (outcome.phase !== 'draft') return null;
  const found = by.found.value;
  const fresh = found.filter((entry) => !entry.present).length;
  const stale = by.stale.value;
  const problems = by.problems.value;
  return (
    <div class="suggest-draft" data-testid="suggest-doors-draft" data-found={found.length} data-new={fresh} data-stale={stale}>
      <h4 class="tool-heading">{t('tools.suggest.doors.draft', { count: found.length, fresh })}</h4>
      {found.length === 0 ? (
        <p class="tool-note" data-testid="suggest-doors-none">
          {t('tools.suggest.doors.none')}
        </p>
      ) : (
        <ul data-testid="suggest-doors-found">
          {found.map(({ door, present }) => (
            <li key={door.id} class={present ? 'tool-note suggest-found-present' : 'tool-note'} data-door-id={door.id} data-present={present}>
              <code>{door.id}</code>, {kindOf(door)}
              {typeof door.group === 'string' && door.group !== '' ? `, ${t('tools.doors.groupOf', { group: door.group })}` : ''}; {box(door)}
              {present && ` — ${t('tools.suggest.doors.present')}`}
            </li>
          ))}
        </ul>
      )}
      {problems.length > 0 && (
        <section data-testid="suggest-doors-findings" data-count={problems.length} aria-live="polite">
          <h5 class="tool-heading">{t('tools.suggest.doors.findings', { count: problems.length })}</h5>
          <ul>
            {problems.map((problem, i) => (
              <li key={i} class="tool-note" data-code={problem.code} title={problem.text}>
                {problemMessage(problem)}
              </li>
            ))}
          </ul>
        </section>
      )}
      {stale && (
        <p class="tool-note tool-warning" role="alert">
          {t('tools.suggest.doors.stale')}
        </p>
      )}
      <div class="tool-row">
        <button type="button" class="tool-button" data-action="suggest-doors-accept" disabled={readOnly || stale || fresh === 0} onClick={() => by.accept()}>
          {t('tools.suggest.doors.accept', { count: fresh })}
        </button>
        <button type="button" class="tool-button" data-action="suggest-doors-reject" onClick={() => by.reject()}>
          {t('tools.suggest.reject')}
        </button>
      </div>
    </div>
  );
}

function Failed({ by }: { by: DoorsByNames }) {
  const outcome = by.outcome.value;
  if (outcome.phase !== 'failed') return null;
  const { said } = outcome;
  return (
    <div class="suggest-error" role="alert" data-testid="suggest-doors-error">
      <p class="tool-note tool-warning">{said.text}</p>
      {said.detail !== null && (
        <details>
          <summary class="tool-note">{t('tools.suggest.detail')}</summary>
          <pre>{said.detail}</pre>
        </details>
      )}
    </div>
  );
}

/** «Двери по именам» in the doors tool's section: see the file's head. */
export function SuggestDoorsSection({ by, subject }: { by: DoorsByNames; subject: ToolSubject }) {
  const running = by.running.value;
  const outcome = by.outcome.value;
  const readOnly = subject.readOnly;
  const noModel = objSource(subject) === null;
  return (
    <fieldset class="tool-box" data-testid="suggest-doors" data-phase={running !== null ? 'running' : outcome.phase}>
      <legend>{t('tools.suggest.doors.title')}</legend>
      <p class="tool-note">{t('tools.suggest.doors.howto')}</p>
      <div class="tool-row">
        <button type="button" class="tool-button" data-action="suggest-doors-run" disabled={readOnly || noModel || running !== null} onClick={() => void by.request()}>
          {t('tools.suggest.doors.run')}
        </button>
        {noModel && <span class="tool-note">{t('tools.suggest.err.noModel')}</span>}
      </div>
      {running !== null && <PythonProgress running={running} />}
      <Failed by={by} />
      <Draft by={by} readOnly={readOnly} />
    </fieldset>
  );
}
