/**
 * «Предложить пол» in the zones tool's section of the inspector (docs/proposals/editor.md
 * §2.3, §3.9, M6): the floor levels — a click on the model's floor or a number, several for a
 * car with steps —, the generator's options folded away under «Дополнительно», the call with
 * its progress and its stop, and the draft: how many zones, what the floor check finds of
 * the type with them, «Принять» and «Отклонить». Everything by keyboard as by mouse.
 */

import { Fragment } from 'preact';
import { problemMessage } from '../../checks/messages';
import { formatNumber, t } from '../../i18n';
import { numberText, parseNumber } from '../../forms/values';
import { TextInput } from '../common/inputs';
import type { ToolSubject } from '../registry';
import { FLOOR_DEFAULTS, type FloorSuggest } from './floor';
import { PythonProgress } from './PythonProgress';
import { objSource } from './subject';
import '../common/section.css';
import './suggest.css';

/** A number typed in, or nothing (the generator's own value): the field of an option. */
function OptionNumber(props: { id: string; label: string; value: number | null; disabled: boolean; min?: number; onChange: (value: number | null) => void }) {
  return (
    <TextInput
      id={props.id}
      label={props.label}
      text={props.value === null ? '' : numberText(props.value)}
      disabled={props.disabled}
      short
      numeric
      parse={(text) => {
        if (text.trim() === '') return { ok: true };
        const parsed = parseNumber(text);
        if ('error' in parsed) return { error: t('tools.notNumber') };
        return props.min !== undefined && parsed.value < props.min ? { error: t('tools.suggest.floor.atLeast', { min: formatNumber(props.min) }) } : { ok: true };
      }}
      onCommit={(text) => {
        const parsed = text.trim() === '' ? null : parseNumber(text);
        props.onChange(parsed === null ? null : 'value' in parsed ? parsed.value : null);
      }}
    />
  );
}

function Levels({ suggest, readOnly }: { suggest: FloorSuggest; readOnly: boolean }) {
  const levels = suggest.levels.value;
  const picking = suggest.picking.value;
  return (
    <div class="tool-items" data-testid="suggest-levels" data-levels={levels.join(' ')}>
      <span class="tool-label" id="suggest-levels-label">
        {t('tools.suggest.floor.levels')}
      </span>
      {levels.length === 0 ? (
        <p class="tool-note">{t('tools.suggest.floor.levels.auto')}</p>
      ) : (
        <ul class="suggest-chips" aria-labelledby="suggest-levels-label">
          {levels.map((level, i) => (
            <li key={level} class="suggest-chip" data-level={level}>
              <span>{formatNumber(level)}</span>
              <button type="button" aria-label={t('tools.suggest.floor.level.remove', { level: formatNumber(level) })} disabled={readOnly} onClick={() => suggest.removeLevel(i)}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div class="tool-row">
        <label class="tool-label" for="suggest-level">
          {t('tools.suggest.floor.level.add')}
        </label>
        <TextInput
          id="suggest-level"
          label={t('tools.suggest.floor.level.add.label')}
          text=""
          disabled={readOnly}
          short
          numeric
          parse={(text) => (text.trim() === '' || !('error' in parseNumber(text)) ? { ok: true } : { error: t('tools.notNumber') })}
          onCommit={(text) => {
            const parsed = parseNumber(text);
            if ('value' in parsed) suggest.addLevel(parsed.value);
          }}
        />
        <button
          type="button"
          class="tool-button"
          data-action="suggest-pick-level"
          aria-pressed={picking}
          disabled={readOnly}
          onClick={() => {
            suggest.picking.value = !picking;
          }}
        >
          {t(picking ? 'tools.suggest.floor.pick.waiting' : 'tools.suggest.floor.pick')}
        </button>
      </div>
      <p class="tool-note">{t('tools.suggest.floor.levels.note')}</p>
    </div>
  );
}

function Options({ suggest, readOnly }: { suggest: FloorSuggest; readOnly: boolean }) {
  return (
    <details class="suggest-details" data-testid="suggest-options">
      <summary>{t('tools.suggest.floor.more')}</summary>
      <div class="tool-row">
        <label class="tool-label" for="suggest-clearance">
          {t('tools.suggest.floor.clearance', { value: formatNumber(FLOOR_DEFAULTS.clearance) })}
        </label>
        <OptionNumber id="suggest-clearance" label={t('tools.suggest.floor.clearance.label')} value={suggest.clearance.value} disabled={readOnly} min={0} onChange={(value) => (suggest.clearance.value = value)} />
      </div>
      <p class="tool-note">{t('tools.suggest.floor.clearance.note')}</p>
      <div class="tool-row">
        <label class="tool-label" for="suggest-step-down">
          {t('tools.suggest.floor.stepDown', { value: formatNumber(FLOOR_DEFAULTS.stepDown) })}
        </label>
        <OptionNumber id="suggest-step-down" label={t('tools.suggest.floor.stepDown.label')} value={suggest.stepDown.value} disabled={readOnly} min={0} onChange={(value) => (suggest.stepDown.value = value)} />
      </div>
      <p class="tool-note">{t('tools.suggest.floor.stepDown.note')}</p>
    </details>
  );
}

function Draft({ suggest, readOnly }: { suggest: FloorSuggest; readOnly: boolean }) {
  const outcome = suggest.outcome.value;
  if (outcome.phase !== 'draft') return null;
  const { draft } = outcome;
  const problems = suggest.problems.value;
  const stale = suggest.stale.value;
  return (
    <div class="suggest-draft" data-testid="suggest-draft" data-zones={draft.zones.length} data-findings={problems.length} data-stale={stale}>
      <h4 class="tool-heading">{t('tools.suggest.floor.draft', { count: draft.zones.length })}</h4>
      <p class="tool-note" data-testid="suggest-draft-summary">
        {t('tools.suggest.floor.draft.summary', { levels: draft.levels.map((level) => formatNumber(level)).join(', '), area: formatNumber(draft.regionArea, 1) })}
        {draft.droppedArea > 0.05 && <Fragment> {t('tools.suggest.floor.draft.dropped', { area: formatNumber(draft.droppedArea, 1) })}</Fragment>}
      </p>
      {draft.notes.length > 0 && (
        <ul data-testid="suggest-draft-notes">
          {draft.notes.map((note, i) => (
            <li key={i} class="tool-note">
              {note}
            </li>
          ))}
        </ul>
      )}
      <section data-testid="suggest-draft-findings" data-count={problems.length} data-codes={problems.map((p) => p.code).join(' ')} aria-live="polite">
        <h5 class="tool-heading">{t('tools.suggest.floor.draft.findings', { count: problems.length })}</h5>
        {problems.length > 0 && (
          <ul>
            {problems.map((problem, i) => (
              <li key={i} class="tool-note" data-code={problem.code} title={problem.text}>
                {problemMessage(problem)}
              </li>
            ))}
          </ul>
        )}
      </section>
      {stale && (
        <p class="tool-note tool-warning" role="alert">
          {t('tools.suggest.floor.draft.stale')}
        </p>
      )}
      <div class="tool-row">
        <button type="button" class="tool-button" data-action="suggest-floor-accept" disabled={readOnly || stale} onClick={() => suggest.accept()}>
          {t('tools.suggest.accept')}
        </button>
        <button type="button" class="tool-button" data-action="suggest-floor-reject" onClick={() => suggest.reject()}>
          {t('tools.suggest.reject')}
        </button>
      </div>
    </div>
  );
}

function Failed({ suggest }: { suggest: FloorSuggest }) {
  const outcome = suggest.outcome.value;
  if (outcome.phase !== 'failed') return null;
  const { said } = outcome;
  return (
    <div class="suggest-error" role="alert" data-testid="suggest-error">
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

/** The floor suggestion's part of the zones tool's section: see the file's head. */
export function SuggestFloorSection({ suggest, subject }: { suggest: FloorSuggest; subject: ToolSubject }) {
  const running = suggest.running.value;
  const outcome = suggest.outcome.value;
  const readOnly = subject.readOnly;
  const noModel = objSource(subject) === null;
  return (
    <fieldset class="tool-box" data-testid="suggest-floor" data-phase={running !== null ? 'running' : outcome.phase}>
      <legend>{t('tools.suggest.floor.title')}</legend>
      <p class="tool-note">{t('tools.suggest.floor.howto')}</p>
      <Levels suggest={suggest} readOnly={readOnly} />
      <Options suggest={suggest} readOnly={readOnly} />
      <div class="tool-row">
        <button type="button" class="tool-button" data-action="suggest-floor-run" disabled={readOnly || noModel || running !== null} onClick={() => void suggest.request()}>
          {t('tools.suggest.floor.run')}
        </button>
        {noModel && <span class="tool-note">{t('tools.suggest.err.noModel')}</span>}
      </div>
      {running !== null && <PythonProgress running={running} />}
      <Failed suggest={suggest} />
      <Draft suggest={suggest} readOnly={readOnly} />
    </fieldset>
  );
}
