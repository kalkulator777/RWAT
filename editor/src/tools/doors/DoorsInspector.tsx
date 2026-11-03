/**
 * The doors tool's section of the inspector (docs/proposals/editor.md §2.3, §6.3): all the
 * view's gestures by keyboard — a door made of the objects selected; the doors in their
 * order (the order is the door's index) to select, move up and down, remove and add; the
 * selected door's id, flags, group and six numbers; what the engine makes of it (its wall
 * and way out, its size, an inner door's bridge, the leaves it moves) and what the floor
 * check finds of it, in the interface's words; what edges snap to; the legend of the
 * layers.
 *
 * The section borrows the floor tool's look (../floor/floor.css): one look for the tools'
 * sections until it moves to a common place.
 */

import { Fragment } from 'preact';
import { useState } from 'preact/hooks';
import type { Problem } from '../../core/contracts';
import { typeFloorProblems } from '../../checks/floor/problems';
import { problemMessage } from '../../checks/messages';
import { numberText, parseNumber } from '../../forms/values';
import { formatNumber, t } from '../../i18n';
import { overlayStyle } from '../../view3d/overlays';
import type { Snapping } from '../floor/snap';
import { moversOfDoor, type DoorInfo, type DoorMover, type DoorsPicture } from './analysis';
import { DOOR_FLAGS, idTaken, selectedDoors, type DoorBox, type DoorEntry } from './doors';
import type { DoorsTool } from './session';
import '../floor/floor.css';

const AXES = ['x', 'y', 'z'] as const;
const CORNERS = ['min', 'max'] as const;
const KEYS = { min: ['minX', 'minY', 'minZ'], max: ['maxX', 'maxY', 'maxZ'] } as const;

/**
 * A value typed in, applied on Enter or leaving the field: `parse` says what the text is,
 * or the error to say (the text is kept until it is fixed or Escape drops it).
 */
function TextInput(props: {
  id: string;
  label: string;
  text: string;
  disabled: boolean;
  short?: boolean;
  numeric?: boolean;
  parse: (text: string) => { error: string } | { ok: true };
  onCommit: (text: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <span class={props.short === true ? 'field-input-wrap field-input-short' : 'field-input-wrap'}>
      <input
        id={props.id}
        type="text"
        class="field-input"
        inputMode={props.numeric === true ? 'decimal' : 'text'}
        spellcheck={false}
        autoComplete="off"
        aria-label={props.label}
        aria-invalid={error !== null ? 'true' : undefined}
        disabled={props.disabled}
        value={draft ?? props.text}
        onInput={(event) => setDraft(event.currentTarget.value)}
        onChange={(event) => {
          const text = event.currentTarget.value;
          const parsed = props.parse(text);
          if ('error' in parsed) {
            setError(parsed.error);
            return;
          }
          setError(null);
          setDraft(null);
          if (text !== props.text) props.onCommit(text);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && draft !== null) {
            setDraft(null);
            setError(null);
            event.preventDefault();
          }
        }}
      />
      {error !== null && (
        <span class="field-input-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

function FromSelection({ tool, readOnly }: { tool: DoorsTool; readOnly: boolean }) {
  void tool.selection.value;
  const count = tool.objects().length;
  return (
    <div class="floor-row">
      <button type="button" class="floor-add" data-action="doors-from-selection" disabled={readOnly || count === 0} onClick={() => tool.fromSelection()}>
        {t('tools.doors.fromSelection')}
      </button>
      <span class="floor-note" data-testid="doors-objects" data-count={count}>
        {t('tools.doors.fromSelection.count', { count })}
      </span>
    </div>
  );
}

function kindsOf(entry: DoorEntry): string[] {
  const kinds = [entry.inner ? 'inner' : entry.connecting ? 'connecting' : 'outer'];
  if (entry.fixed) kinds.push('fixed');
  return kinds.map((kind) => t(`tools.doors.kind.${kind}`));
}

function doorSummary(entry: DoorEntry): string {
  if (entry.box === null) return t('tools.doors.broken');
  const parts = kindsOf(entry);
  if (entry.group !== null && entry.group !== '') parts.push(t('tools.doors.groupOf', { group: entry.group }));
  return parts.join(', ');
}

/** The floor check's findings of each door of the open type, in the interface's words, by index. */
function findingsByDoor(tool: DoorsTool): Map<number, Problem[]> {
  const subject = tool.subject.value;
  const out = new Map<number, Problem[]>();
  if (subject === null) return out;
  for (const problem of typeFloorProblems(subject.wagon, subject.typeFile, subject.typeJson)) {
    for (const link of problem.at) {
      if (link.kind === 'door' && link.type === subject.wagon) out.set(link.index, [...(out.get(link.index) ?? []), problem]);
    }
  }
  return out;
}

function DoorList(props: { tool: DoorsTool; picture: DoorsPicture; chosen: readonly number[]; readOnly: boolean; findings: Map<number, Problem[]> }) {
  const { tool, picture, chosen, readOnly, findings } = props;
  const doors = picture.doors;
  return (
    <div class="floor-zones">
      <h3 class="floor-heading">{t('tools.doors.list', { count: doors.length })}</h3>
      {doors.length === 0 ? (
        <p class="floor-note">{t('tools.doors.none')}</p>
      ) : (
        <ol class="floor-zone-list" data-testid="doors-list" start={0}>
          {doors.map(({ index: i, entry }) => {
            const found = findings.get(i)?.length ?? 0;
            return (
              <li key={i} class="floor-zone" data-door={i} data-selected={chosen.includes(i) ? 'true' : undefined}>
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
                  <span class="floor-zone-index">{t('tools.doors.door', { index: i })}</span>
                  <code class="floor-zone-summary">{entry.id ?? t('tools.doors.noId')}</code>
                  <span class="floor-zone-summary">{doorSummary(entry)}</span>
                  {found > 0 && <span class="floor-zone-flag">{t('tools.doors.findingsOf', { count: found })}</span>}
                </button>
                <span class="floor-zone-actions">
                  <button type="button" class="floor-icon" aria-label={t('tools.doors.up', { index: i })} title={t('tools.doors.up', { index: i })} disabled={readOnly || i === 0} onClick={() => tool.reorder(i, i - 1)}>
                    ↑
                  </button>
                  <button
                    type="button"
                    class="floor-icon"
                    aria-label={t('tools.doors.down', { index: i })}
                    title={t('tools.doors.down', { index: i })}
                    disabled={readOnly || i === doors.length - 1}
                    onClick={() => tool.reorder(i, i + 1)}
                  >
                    ↓
                  </button>
                  <button type="button" class="floor-icon" aria-label={t('tools.doors.remove', { index: i })} title={t('tools.doors.remove', { index: i })} disabled={readOnly} onClick={() => tool.remove(i)}>
                    ✕
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <p class="floor-note">{t('tools.doors.order')}</p>
      <button type="button" class="floor-add" data-action="doors-add" disabled={readOnly} onClick={() => tool.add()}>
        {t('tools.doors.add')}
      </button>
    </div>
  );
}

function moverText(mover: DoorMover): string {
  return t(`tools.doors.mover.${mover.kind}`, { name: mover.name, count: mover.objects.length });
}

/** What the engine makes of the door: its wall, way out and size; an inner door's bridge; what of the model it moves. */
function DoorFacts({ info, picture, typeLoads }: { info: DoorInfo; picture: DoorsPicture; typeLoads: boolean }) {
  if (info.door === null || info.wall === null || info.out === null) return null;
  const movers = moversOfDoor(picture, info.index);
  return (
    <div class="floor-note" data-testid="doors-facts" data-wall={info.wall} data-out={info.out} data-bridge={info.bridge ?? undefined}>
      <p class="floor-note">
        {t(`tools.doors.wall.${info.wall}`)}, {t(`tools.doors.out.${info.out}`)}; {t('tools.doors.size', { thickness: formatNumber(round(info.thickness)), width: formatNumber(round(info.width)) })}
      </p>
      {info.bridge !== null && <p class={info.bridge === 'both' ? 'floor-note' : 'floor-note floor-warning'}>{t(`tools.doors.bridge.${info.bridge}`)}</p>}
      {typeLoads && (
        <p class="floor-note" data-testid="doors-movers" data-movers={movers.map((m) => m.name).join(' ')}>
          {info.entry.fixed ? t('tools.doors.movers.fixed') : movers.length === 0 ? t('tools.doors.movers.none') : t('tools.doors.movers', { list: movers.map(moverText).join(', ') })}
        </p>
      )}
    </div>
  );
}

/** A length as the inspector says it: to a thousandth of a block. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function DoorEditor(props: { tool: DoorsTool; info: DoorInfo; picture: DoorsPicture; readOnly: boolean; findings: readonly Problem[]; typeLoads: boolean }) {
  const { tool, info, picture, readOnly, findings } = props;
  const index = info.index;
  const entry = info.entry;
  const box: DoorBox | null = entry.box;
  const subject = tool.subject.value;
  const taken = subject !== null && entry.id !== null && idTaken(subject.typeJson, entry.id, index);
  return (
    <fieldset class="floor-numbers" data-testid="doors-door" data-door={index}>
      <legend>{t('tools.doors.door', { index })}</legend>
      <div class="floor-row">
        <label class="floor-label" for="doors-id">
          {t('tools.doors.id')}
        </label>
        <TextInput
          key={`id-${index}`}
          id="doors-id"
          label={t('tools.doors.id.label', { index })}
          text={entry.id ?? ''}
          disabled={readOnly}
          parse={(text) => (text === '' ? { error: t('tools.doors.id.empty') } : { ok: true })}
          onCommit={(text) => tool.setId(index, text)}
        />
      </div>
      {taken && <p class="floor-note floor-warning">{t('tools.doors.id.taken')}</p>}
      <fieldset class="floor-snap">
        <legend>{t('tools.doors.flags')}</legend>
        {DOOR_FLAGS.map((flag) => (
          <label key={flag} class="floor-check" data-flag={flag}>
            <input type="checkbox" checked={entry[flag]} disabled={readOnly} onChange={(event) => tool.setFlag(index, flag, event.currentTarget.checked)} />
            {t(`tools.doors.flag.${flag}`)}
          </label>
        ))}
      </fieldset>
      <div class="floor-row">
        <label class="floor-label" for="doors-group">
          {t('tools.doors.group')}
        </label>
        <TextInput
          key={`group-${index}`}
          id="doors-group"
          label={t('tools.doors.group.label', { index })}
          text={entry.group ?? ''}
          disabled={readOnly}
          parse={() => ({ ok: true })}
          onCommit={(text) => tool.setGroup(index, text)}
        />
      </div>
      <p class="floor-note">{t('tools.doors.group.note')}</p>
      {box !== null && (
        <div class="floor-grid">
          <span />
          {AXES.map((axis) => (
            <span key={axis} class="floor-axis">
              {axis}
            </span>
          ))}
          {CORNERS.map((corner) => (
            <Fragment key={corner}>
              <span class="floor-corner">{t(`tools.doors.${corner}`)}</span>
              {AXES.map((axis, a) => (
                <TextInput
                  key={`${index}-${corner}-${axis}`}
                  id={`doors-${corner}-${axis}`}
                  label={t('tools.doors.number', { corner, axis, index })}
                  text={numberText(box[KEYS[corner][a] as keyof DoorBox])}
                  disabled={readOnly}
                  short
                  numeric
                  parse={(text) => ('error' in parseNumber(text) ? { error: t('tools.doors.notNumber') } : { ok: true })}
                  onCommit={(text) => {
                    const parsed = parseNumber(text);
                    if ('value' in parsed) tool.setNumber(index, corner, a as 0 | 1 | 2, parsed.value);
                  }}
                />
              ))}
            </Fragment>
          ))}
        </div>
      )}
      <p class="floor-note">{t('tools.doors.numbers.note')}</p>
      <DoorFacts info={info} picture={picture} typeLoads={props.typeLoads} />
      <section class="floor-findings" data-testid="doors-findings" data-count={findings.length} data-codes={findings.map((f) => f.code).join(' ')} aria-live="polite">
        <h4 class="floor-heading">{t('tools.doors.findings', { count: findings.length })}</h4>
        {findings.length > 0 && (
          <ul class="floor-finding-list">
            {findings.map((problem, i) => (
              <li key={i} class="floor-note" data-code={problem.code}>
                {problemMessage(problem)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </fieldset>
  );
}

function SnapChoice({ tool }: { tool: DoorsTool }) {
  const snapping = tool.snapping.value;
  const keys: (keyof Snapping)[] = ['zones', 'vertices', 'grid'];
  return (
    <fieldset class="floor-snap">
      <legend>{t('tools.doors.snap')}</legend>
      {keys.map((key) => (
        <label key={key} class="floor-check" data-snap={key}>
          <input
            type="checkbox"
            checked={snapping[key]}
            onChange={(event) => {
              tool.snapping.value = { ...tool.snapping.peek(), [key]: event.currentTarget.checked };
            }}
          />
          {t(`tools.doors.snap.${key}`)}
        </label>
      ))}
      <p class="floor-note">{t('tools.doors.snap.alt')}</p>
    </fieldset>
  );
}

function Legend() {
  const entries: [string, string][] = [
    ['door', 'tools.doors.legend.door'],
    ['door-inner', 'tools.doors.legend.inner'],
    ['doors.face', 'tools.doors.legend.face'],
    ['exit', 'tools.doors.legend.span'],
    ['bridge', 'tools.doors.legend.bridge'],
    ['warning', 'tools.doors.legend.warning'],
    ['doors.leaf', 'tools.doors.legend.leaf'],
    ['zone', 'tools.doors.legend.zone'],
  ];
  return (
    <ul class="floor-legend" aria-label={t('tools.doors.legend')}>
      {entries.map(([style, key]) => (
        <li key={style}>
          <span class="floor-swatch" style={{ background: overlayStyle(style).color }} aria-hidden="true" />
          {t(key)}
        </li>
      ))}
    </ul>
  );
}

/** The doors tool's section: see the file's head. */
export function DoorsInspector({ tool }: { tool: DoorsTool }) {
  const subject = tool.subject.value;
  const picture = tool.picture.value;
  if (subject === null || picture === null) return null;
  const chosen = selectedDoors(tool.selection.value, subject.wagon);
  const index = chosen.at(-1);
  const info = index === undefined ? undefined : picture.doors[index];
  const findings = findingsByDoor(tool);
  const loose = picture.movers.filter((mover) => mover.door < 0);
  return (
    <div class="floor-tool" data-testid="doors-tool" data-doors={picture.doors.length}>
      <p class="floor-note">{t('tools.doors.howto')}</p>
      {subject.type === null && <p class="floor-note floor-warning">{t('tools.doors.noType')}</p>}
      {subject.model === null && <p class="floor-note">{t('tools.doors.noModel')}</p>}
      <FromSelection tool={tool} readOnly={subject.readOnly} />
      <DoorList tool={tool} picture={picture} chosen={chosen} readOnly={subject.readOnly} findings={findings} />
      {info !== undefined && (
        <DoorEditor tool={tool} info={info} picture={picture} readOnly={subject.readOnly} findings={findings.get(info.index) ?? []} typeLoads={subject.type !== null} />
      )}
      {loose.length > 0 && (
        <p class="floor-note floor-warning" data-testid="doors-loose">
          {t('tools.doors.loose', { list: loose.map(moverText).join(', ') })}
        </p>
      )}
      <SnapChoice tool={tool} />
      <Legend />
    </div>
  );
}
