/**
 * The chairs tool's section of the inspector (docs/proposals/editor.md §2.3, §6.3): all the
 * view's gestures by keyboard — each kind's places in their order (the first manned chair
 * drives) to select, move up and down, remove and add; the selected place's point and yaw
 * typed, with a turn forward or back at a press, which way it drives and what the engine
 * makes of it (its cab, where one stands to sit down, the cushion's height); what the
 * floor check says of the chairs, each finding selecting its chair; what a moved place
 * snaps to; the legend of the layers.
 */

import type { FloorFinding, Link } from '../../core/contracts';
import { floorProblem } from '../../checks/floor/problems';
import { problemMessage } from '../../checks/messages';
import { formatNumber, t } from '../../i18n';
import { MAX_SEAT_HEIGHT, MIN_SEAT_HEIGHT } from '../../ports/floorCheck';
import { SEAT_REACH } from '../../ports/riderWalk';
import { overlayStyle } from '../../view3d/overlays';
import { BACK_STYLE, discStyle, FORWARD_STYLE, type PlaceView } from './analysis';
import { chairsForm } from './chairs';
import type { SeatSnapping } from './gesture';
import { NumberInput } from './NumberInput';
import { samePlace, type PlaceKind, type PlaceRef } from './places';
import type { SeatsTool } from './session';
import './seats.css';

const AXES = ['x', 'y', 'z'] as const;

/** A length for the eye: to a hundredth of a block. */
function short(value: number): string {
  return Number.isFinite(value) ? formatNumber(Math.round(value * 100) / 100) : '∞';
}

function summary(view: PlaceView): string {
  const place = view.place;
  if (place === null) return t('tools.seats.broken');
  return t('tools.seats.summary', { x: formatNumber(place.at[0]), y: formatNumber(place.at[1]), z: formatNumber(place.at[2]), yaw: formatNumber(place.yaw) });
}

function Flags({ view }: { view: PlaceView }) {
  const { facts, place } = view;
  return (
    <>
      {place !== null && view.ref.kind.drives && (
        <span class="seats-flag" data-flag={view.backward ? 'back' : 'forward'} style={{ color: overlayStyle(view.backward ? BACK_STYLE : FORWARD_STYLE).color }}>
          {t(view.backward ? 'tools.seats.back' : 'tools.seats.forward')}
        </span>
      )}
      {facts !== null && view.ref.kind.drives && (
        <span class="seats-flag" data-flag="cab">
          <span class="seats-swatch" style={{ background: overlayStyle(discStyle(facts)).color }} aria-hidden="true" />
          {facts.cab >= 0 ? t('tools.seats.cab', { cab: facts.cab }) : t('tools.seats.noCab')}
        </span>
      )}
      {facts !== null && !facts.sittable && (
        <span class="seats-flag seats-flag-warning" data-flag="not-sittable">
          {t('tools.seats.notSittable')}
        </span>
      )}
    </>
  );
}

function PlaceList({ tool, kind, views, chosen, readOnly }: { tool: SeatsTool; kind: PlaceKind; views: readonly PlaceView[]; chosen: readonly PlaceRef[]; readOnly: boolean }) {
  const full = views.length >= kind.limit;
  return (
    <div class="seats-kind" data-kind={kind.id}>
      <h3 class="seats-heading">
        {t(kind.title)} <span class="seats-count">{t('tools.seats.count', { count: views.length, limit: kind.limit })}</span>
      </h3>
      {views.length === 0 ? (
        <p class="seats-note">{t('tools.seats.none')}</p>
      ) : (
        <ol class="seats-list" data-testid={`seats-${kind.id}`} start={0}>
          {views.map((view) => {
            const i = view.ref.index;
            const on = chosen.some((ref) => samePlace(ref, view.ref));
            return (
              <li key={i} class="seats-item" data-seat={i} data-selected={on ? 'true' : undefined} data-backward={view.backward ? 'true' : undefined}>
                <button
                  type="button"
                  class="seats-name"
                  aria-pressed={on}
                  onClick={(event) => tool.select(view.ref, event.shiftKey)}
                  onKeyDown={(event) => {
                    if ((event.key === 'Delete' || event.key === 'Backspace') && !readOnly) {
                      event.preventDefault();
                      tool.remove(view.ref);
                    }
                  }}
                >
                  <span class="seats-index">{t('tools.seats.seat', { index: i })}</span>
                  <span class="seats-summary">{summary(view)}</span>
                  <Flags view={view} />
                </button>
                <span class="seats-actions">
                  <button type="button" class="seats-icon" aria-label={t('tools.seats.up', { index: i })} title={t('tools.seats.up', { index: i })} disabled={readOnly || i === 0} onClick={() => tool.reorder(view.ref, i - 1)}>
                    ↑
                  </button>
                  <button
                    type="button"
                    class="seats-icon"
                    aria-label={t('tools.seats.down', { index: i })}
                    title={t('tools.seats.down', { index: i })}
                    disabled={readOnly || i === views.length - 1}
                    onClick={() => tool.reorder(view.ref, i + 1)}
                  >
                    ↓
                  </button>
                  <button type="button" class="seats-icon" aria-label={t('tools.seats.remove', { index: i })} title={t('tools.seats.remove', { index: i })} disabled={readOnly} onClick={() => tool.remove(view.ref)}>
                    ✕
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {full && <p class="seats-note">{t('tools.seats.full', { limit: kind.limit })}</p>}
      <button type="button" class="seats-button" data-action="seats-add" data-kind={kind.id} disabled={readOnly || full} onClick={() => tool.add(kind)}>
        {t('tools.seats.add')}
      </button>
    </div>
  );
}

function Numbers({ tool, view, readOnly }: { tool: SeatsTool; view: PlaceView; readOnly: boolean }) {
  const { place, facts, ref } = view;
  if (place === null) return null;
  const index = ref.index;
  return (
    <fieldset class="seats-numbers" data-testid="seats-numbers" data-seat={index}>
      <legend>{t('tools.seats.seat', { index })}</legend>
      <div class="seats-grid">
        <span class="seats-axis-label">{t('tools.seats.at')}</span>
        {AXES.map((axis, a) => (
          <NumberInput
            key={axis}
            id={`seats-at-${axis}`}
            label={t('tools.seats.number', { axis, index })}
            value={place.at[a] as number}
            disabled={readOnly}
            onCommit={(value) => tool.setAt(ref, a as 0 | 1 | 2, value)}
          />
        ))}
        <span class="seats-axis-label">{t('tools.seats.yaw')}</span>
        <NumberInput id="seats-yaw" label={t('tools.seats.yaw.label', { index })} value={place.yaw} disabled={readOnly} onCommit={(value) => tool.setYaw(ref, value)} />
        {ref.kind.drives && (
          <span class="seats-turns">
            <button type="button" class="seats-button" data-action="seats-forward" aria-pressed={!view.backward} disabled={readOnly} onClick={() => tool.setYaw(ref, 0)}>
              {t('tools.seats.yaw.forward')}
            </button>
            <button type="button" class="seats-button" data-action="seats-back" aria-pressed={view.backward} disabled={readOnly} onClick={() => tool.setYaw(ref, 180)}>
              {t('tools.seats.yaw.back')}
            </button>
          </span>
        )}
      </div>
      <p class="seats-note">{t('tools.seats.numbers.note')}</p>
      {ref.kind.drives && <p class="seats-note">{t('tools.seats.yaw.note')}</p>}
      {facts !== null && (
        <p class="seats-note" data-testid="seats-facts">
          {facts.stand === null
            ? t('tools.seats.facts.noFloor')
            : t('tools.seats.facts', {
                reach: short(facts.reach),
                sit_reach: formatNumber(SEAT_REACH),
                height: short(facts.height),
                min_height: formatNumber(MIN_SEAT_HEIGHT),
                max_height: formatNumber(MAX_SEAT_HEIGHT),
              })}
        </p>
      )}
    </fieldset>
  );
}

/** What the floor check says of the chairs, in the interface's words (as the checks tab has them); a click selects the chair. */
function Findings({ tool, found }: { tool: SeatsTool; found: readonly FloorFinding[] }) {
  const subject = tool.subject.value;
  if (subject === null) return null;
  return (
    <section class="seats-findings" data-testid="seats-findings" data-count={found.length} data-codes={found.map((f) => f.code).join(' ')} aria-live="polite">
      <h3 class="seats-heading">{t('tools.seats.findings', { count: found.length })}</h3>
      {found.length > 0 && (
        <ul class="seats-finding-list">
          {found.map((finding, i) => {
            const problem = floorProblem(finding, subject.wagon, subject.typeFile, subject.typeJson);
            const links: Link[] = problem.at;
            return (
              <li key={i} data-code={finding.code} data-index={finding.index}>
                <button type="button" class="seats-finding" title={finding.text} onClick={() => tool.show(links)}>
                  {problemMessage(problem)}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p class="seats-note">{t('tools.seats.findings.note')}</p>
    </section>
  );
}

function SnapChoice({ tool }: { tool: SeatsTool }) {
  const snapping = tool.snapping.value;
  const keys: (keyof SeatSnapping)[] = ['cushions', 'vertices', 'grid'];
  return (
    <fieldset class="seats-snap">
      <legend>{t('tools.seats.snap')}</legend>
      {keys.map((key) => (
        <label key={key} class="seats-check" data-snap={key}>
          <input
            type="checkbox"
            checked={snapping[key]}
            onChange={(event) => {
              tool.snapping.value = { ...tool.snapping.peek(), [key]: event.currentTarget.checked };
            }}
          />
          {t(`tools.seats.snap.${key}`)}
        </label>
      ))}
      <p class="seats-note">{t('tools.seats.snap.alt')}</p>
    </fieldset>
  );
}

function Legend() {
  const entries: [string, string][] = [
    ['cab', 'tools.seats.legend.cab'],
    ['seat', 'tools.seats.legend.seat'],
    ['warning', 'tools.seats.legend.warning'],
    [FORWARD_STYLE, 'tools.seats.legend.forward'],
    [BACK_STYLE, 'tools.seats.legend.back'],
    ['piece', 'tools.seats.legend.stand'],
    ['reach', 'tools.seats.legend.reach'],
  ];
  return (
    <ul class="seats-legend" aria-label={t('tools.seats.legend')}>
      {entries.map(([style, key]) => (
        <li key={key}>
          <span class="seats-swatch" style={{ background: overlayStyle(style).color }} aria-hidden="true" />
          {t(key)}
        </li>
      ))}
    </ul>
  );
}

/** The chairs tool's section: see the file's head. */
export function SeatsInspector({ tool }: { tool: SeatsTool }) {
  const subject = tool.subject.value;
  const picture = tool.picture.value;
  if (subject === null || picture === null) return null;
  const chosen = tool.chosen();
  void tool.selection.value;
  const last = chosen.at(-1) ?? null;
  const selectedView = last === null ? undefined : picture.places.find((view) => samePlace(view.ref, last));
  const form = chairsForm(subject.typeJson);
  const forward = picture.places.filter((view) => view.ref.kind.drives && view.place !== null && !view.backward).length;
  const back = picture.places.filter((view) => view.backward).length;
  return (
    <div class="seats-tool" data-testid="seats-tool" data-places={picture.places.length} data-forward={forward} data-back={back} data-selected={last === null ? undefined : `${last.kind.link}:${last.index}`}>
      <p class="seats-note">{t('tools.seats.howto')}</p>
      {subject.type === null && <p class="seats-note seats-warning">{t('tools.seats.noType')}</p>}
      {form !== 'list' && form !== 'none' && <p class="seats-note seats-warning" data-form={form}>{t(`tools.seats.form.${form}`)}</p>}
      {tool.kinds.map((kind) => (
        <div key={kind.id}>
          <PlaceList tool={tool} kind={kind} views={picture.places.filter((view) => view.ref.kind === kind)} chosen={chosen} readOnly={subject.readOnly} />
          {selectedView !== undefined && selectedView.ref.kind === kind && <Numbers tool={tool} view={selectedView} readOnly={subject.readOnly} />}
        </div>
      ))}
      {forward + back > 0 && (
        <p class="seats-note" data-testid="seats-directions">
          {t('tools.seats.directions', { forward, back })}
        </p>
      )}
      <Findings tool={tool} found={picture.findings} />
      <SnapChoice tool={tool} />
      <Legend />
    </div>
  );
}
