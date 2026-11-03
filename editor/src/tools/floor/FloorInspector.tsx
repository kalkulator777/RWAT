/**
 * The floor tool's section of the inspector (docs/proposals/editor.md §2.3, §6.3): all the
 * view's gestures by keyboard — the zones in their order (zone 0 is where the floor check's
 * walk starts) to select, move up and down, remove and add; the selected zone's six numbers
 * and its height from a click on the model; which doors stand open in the drawing; what
 * edges snap to; what the floor check finds now, in the interface's words, each finding
 * selecting what it is about and turning on its tool, as the checks tab does (a door's
 * finding: the doors tool; a chair's: the chairs tool); the legend of the layers.
 */

import { Fragment } from 'preact';
import { useState } from 'preact/hooks';
import { floorProblem } from '../../checks/floor/problems';
import { problemMessage } from '../../checks/messages';
import { numberText, parseNumber } from '../../forms/values';
import { formatNumber, t } from '../../i18n';
import { overlayStyle } from '../../view3d/overlays';
import { CAB_STYLES, DOOR_STATES } from './analysis';
import type { ToolSubject } from '../registry';
import type { FloorTool } from './session';
import type { Snapping } from './snap';
import { selectedZones, type ZoneBox } from './zones';
import './floor.css';

const AXES = ['x', 'y', 'z'] as const;
const CORNERS = ['min', 'max'] as const;
const KEYS = { min: ['minX', 'minY', 'minZ'], max: ['maxX', 'maxY', 'maxZ'] } as const;

/** A number typed in, applied on Enter or leaving the field; a text that is no number is said and kept. */
function NumberInput(props: { id: string; label: string; value: number; disabled: boolean; onCommit: (value: number) => void }) {
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
          {t('tools.floor.notNumber')}
        </span>
      )}
    </span>
  );
}

function DoorsChoice({ tool }: { tool: FloorTool }) {
  const current = tool.doorState.value;
  return (
    <div class="floor-row">
      <span class="floor-label" id="floor-doors-label">
        {t('tools.floor.doors')}
      </span>
      <div class="toggle" role="group" aria-labelledby="floor-doors-label" data-toggle="floor-doors">
        {DOOR_STATES.map((state) => (
          <button
            key={state}
            type="button"
            class="toggle-button"
            aria-pressed={state === current}
            title={t(`tools.floor.doors.${state}.hint`)}
            data-value={state}
            onClick={() => {
              tool.doorState.value = state;
            }}
          >
            {t(`tools.floor.doors.${state}`)}
          </button>
        ))}
      </div>
    </div>
  );
}

function SnapChoice({ tool }: { tool: FloorTool }) {
  const snapping = tool.snapping.value;
  const keys: (keyof Snapping)[] = ['zones', 'vertices', 'grid'];
  return (
    <fieldset class="floor-snap">
      <legend>{t('tools.floor.snap')}</legend>
      {keys.map((key) => (
        <label key={key} class="floor-check" data-snap={key}>
          <input
            type="checkbox"
            checked={snapping[key]}
            onChange={(event) => {
              tool.snapping.value = { ...tool.snapping.peek(), [key]: event.currentTarget.checked };
            }}
          />
          {t(`tools.floor.snap.${key}`)}
        </label>
      ))}
      <p class="floor-note">{t('tools.floor.snap.alt')}</p>
    </fieldset>
  );
}

function zoneSummary(zone: ZoneBox | null): string {
  if (zone === null) return t('tools.floor.zone.broken');
  return t('tools.floor.zone.summary', {
    x0: formatNumber(zone.minX),
    x1: formatNumber(zone.maxX),
    z0: formatNumber(zone.minZ),
    z1: formatNumber(zone.maxZ),
    y: formatNumber(zone.minY),
  });
}

function ZoneList({ tool, zones, chosen, readOnly }: { tool: FloorTool; zones: readonly (ZoneBox | null)[]; chosen: readonly number[]; readOnly: boolean }) {
  const narrow = new Set(tool.picture.value?.findings.filter((f) => f.code === 'ZONE_TOO_NARROW').map((f) => f.index) ?? []);
  const unreachable = new Set(tool.picture.value?.unreachable ?? []);
  return (
    <div class="floor-zones">
      <h3 class="floor-heading">{t('tools.floor.zones', { count: zones.length })}</h3>
      {zones.length === 0 ? (
        <p class="floor-note">{t('tools.floor.zones.none')}</p>
      ) : (
        <ol class="floor-zone-list" data-testid="floor-zones" start={0}>
          {zones.map((zone, i) => (
            <li key={i} class="floor-zone" data-zone={i} data-selected={chosen.includes(i) ? 'true' : undefined}>
              <button
                type="button"
                class="floor-zone-name"
                aria-pressed={chosen.includes(i)}
                onClick={(event) => tool.select(i, event.shiftKey)}
                onKeyDown={(event) => {
                  if ((event.key === 'Delete' || event.key === 'Backspace') && !readOnly) {
                    event.preventDefault();
                    tool.remove(i);
                  }
                }}
              >
                <span class="floor-zone-index">{t('tools.floor.zone', { index: i })}</span>
                <span class="floor-zone-summary">{zoneSummary(zone)}</span>
                {narrow.has(i) && <span class="floor-zone-flag">{t('tools.floor.zone.narrow')}</span>}
                {unreachable.has(i) && <span class="floor-zone-flag">{t('tools.floor.zone.unreachable')}</span>}
              </button>
              <span class="floor-zone-actions">
                <button type="button" class="floor-icon" aria-label={t('tools.floor.up', { index: i })} title={t('tools.floor.up', { index: i })} disabled={readOnly || i === 0} onClick={() => tool.reorder(i, i - 1)}>
                  ↑
                </button>
                <button
                  type="button"
                  class="floor-icon"
                  aria-label={t('tools.floor.down', { index: i })}
                  title={t('tools.floor.down', { index: i })}
                  disabled={readOnly || i === zones.length - 1}
                  onClick={() => tool.reorder(i, i + 1)}
                >
                  ↓
                </button>
                <button type="button" class="floor-icon" aria-label={t('tools.floor.remove', { index: i })} title={t('tools.floor.remove', { index: i })} disabled={readOnly} onClick={() => tool.remove(i)}>
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
      <p class="floor-note">{t('tools.floor.zone0')}</p>
      <button type="button" class="floor-add" data-action="floor-add" disabled={readOnly} onClick={() => tool.add()}>
        {t('tools.floor.add')}
      </button>
    </div>
  );
}

function ZoneNumbers({ tool, index, zone, readOnly }: { tool: FloorTool; index: number; zone: ZoneBox; readOnly: boolean }) {
  const picking = tool.pickingHeight.value === index;
  return (
    <fieldset class="floor-numbers" data-testid="floor-numbers" data-zone={index}>
      <legend>{t('tools.floor.zone', { index })}</legend>
      <div class="floor-grid">
        <span />
        {AXES.map((axis) => (
          <span key={axis} class="floor-axis">
            {axis}
          </span>
        ))}
        {CORNERS.map((corner) => (
          <Fragment key={corner}>
            <span class="floor-corner">{t(`tools.floor.${corner}`)}</span>
            {AXES.map((axis, a) => (
              <NumberInput
                key={`${corner}-${axis}`}
                id={`floor-${corner}-${axis}`}
                label={t('tools.floor.number', { corner, axis, index })}
                value={zone[KEYS[corner][a] as keyof ZoneBox]}
                disabled={readOnly}
                onCommit={(value) => tool.setNumber(index, corner, a as 0 | 1 | 2, value)}
              />
            ))}
          </Fragment>
        ))}
      </div>
      <p class="floor-note">{t('tools.floor.numbers.note')}</p>
      <button
        type="button"
        class="floor-pick"
        data-action="floor-pick-height"
        aria-pressed={picking}
        disabled={readOnly}
        onClick={() => {
          tool.pickingHeight.value = picking ? null : index;
        }}
      >
        {t(picking ? 'tools.floor.pick.waiting' : 'tools.floor.pick')}
      </button>
    </fieldset>
  );
}

/**
 * What the floor check finds now, in the interface's words as the checks tab has them (the
 * finding of checks/floor, translated by its code), the engine's line as the tooltip; a
 * click selects what it is about and turns on the tool that edits it (`ToolContext.reveal`).
 */
function Findings({ tool, subject }: { tool: FloorTool; subject: ToolSubject }) {
  const found = tool.picture.value?.findings ?? [];
  return (
    <section class="floor-findings" data-testid="floor-findings" data-count={found.length} data-codes={found.map((f) => f.code).join(' ')} aria-live="polite">
      <h3 class="floor-heading">{t('tools.floor.findings', { count: found.length })}</h3>
      {found.length > 0 && (
        <ul class="floor-finding-list">
          {found.map((finding, i) => {
            const problem = floorProblem(finding, subject.wagon, subject.typeFile, subject.typeJson);
            return (
              <li key={i} data-code={finding.code} data-index={finding.index}>
                <button type="button" class="floor-finding" title={finding.text} disabled={problem.at.length === 0} onClick={() => tool.show(problem.at)}>
                  {problemMessage(problem)}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p class="floor-note">{t('tools.floor.findings.note')}</p>
    </section>
  );
}

function Legend() {
  const entries: [string, string][] = [
    ['zone', 'tools.floor.legend.zone'],
    ['warning', 'tools.floor.legend.narrow'],
    ['piece', 'tools.floor.legend.piece'],
    ['cut', 'tools.floor.legend.cut'],
    ['bridge', 'tools.floor.legend.bridge'],
    ['exit', 'tools.floor.legend.exit'],
    [CAB_STYLES[0], 'tools.floor.legend.cab'],
    ['unreachable', 'tools.floor.legend.unreachable'],
  ];
  return (
    <ul class="floor-legend" aria-label={t('tools.floor.legend')}>
      {entries.map(([style, key]) => (
        <li key={style}>
          <span class="floor-swatch" style={{ background: overlayStyle(style).color }} aria-hidden="true" />
          {t(key)}
        </li>
      ))}
    </ul>
  );
}

/** The floor tool's section: see the file's head. */
export function FloorInspector({ tool }: { tool: FloorTool }) {
  const subject = tool.subject.value;
  const picture = tool.picture.value;
  if (subject === null || picture === null) return null;
  const chosen = selectedZones(tool.selection.value, subject.wagon);
  const index = chosen.at(-1);
  const zone = index === undefined ? null : (picture.zones[index] ?? null);
  return (
    <div class="floor-tool" data-testid="floor-tool" data-zones={picture.zones.length} data-pieces={picture.pieces} data-cabs={picture.cabs}>
      <p class="floor-note">{t('tools.floor.howto')}</p>
      {subject.type === null && <p class="floor-note floor-warning">{t('tools.floor.noType')}</p>}
      <DoorsChoice tool={tool} />
      <ZoneList tool={tool} zones={picture.zones} chosen={chosen} readOnly={subject.readOnly} />
      {index !== undefined && zone !== null && <ZoneNumbers tool={tool} index={index} zone={zone} readOnly={subject.readOnly} />}
      <Findings tool={tool} subject={subject} />
      <p class="floor-note" data-testid="floor-stats">
        {t('tools.floor.stats', { pieces: picture.pieces, cabs: picture.cabs })}
      </p>
      <SnapChoice tool={tool} />
      <Legend />
    </div>
  );
}
