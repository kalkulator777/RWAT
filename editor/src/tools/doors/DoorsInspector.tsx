/**
 * The doors tool's section of the inspector (docs/proposals/editor.md §2.3, §6.3): all the
 * view's gestures by keyboard — a door made of the objects selected, the doors the converter
 * finds by the model's object names (tools/suggest: «Двери по именам», a draft to accept or
 * reject); the doors in their order (the order is the door's index) to select, move up and
 * down, remove and add; the selected door's id, flags, group and six numbers; what the
 * engine makes of it (its wall and way out, its size, an inner door's bridge, the leaves it
 * moves) and what the floor check finds of it, in the interface's words; what edges snap
 * to; the legend of the layers.
 *
 * The section has the tools' common look (../common/section.css) and fields
 * (../common/inputs.tsx), as the zones tool's has.
 */

import { Fragment } from 'preact';
import type { Problem } from '../../core/contracts';
import { typeFloorProblems } from '../../checks/floor/problems';
import { problemMessage } from '../../checks/messages';
import { formatNumber, t } from '../../i18n';
import { overlayStyle } from '../../view3d/overlays';
import { NumberInput, TextInput } from '../common/inputs';
import type { Snapping } from '../common/snap';
import { SuggestDoorsSection } from '../suggest/SuggestDoors';
import { moversOfDoor, type DoorInfo, type DoorMover, type DoorsPicture } from './analysis';
import { DOOR_FLAGS, idTaken, selectedDoors, type DoorBox, type DoorEntry } from './doors';
import type { DoorsTool } from './session';
import '../common/section.css';

const AXES = ['x', 'y', 'z'] as const;
const CORNERS = ['min', 'max'] as const;
const KEYS = { min: ['minX', 'minY', 'minZ'], max: ['maxX', 'maxY', 'maxZ'] } as const;

function FromSelection({ tool, readOnly }: { tool: DoorsTool; readOnly: boolean }) {
  void tool.selection.value;
  const count = tool.objects().length;
  return (
    <div class="tool-row">
      <button type="button" class="tool-button" data-action="doors-from-selection" disabled={readOnly || count === 0} onClick={() => tool.fromSelection()}>
        {t('tools.doors.fromSelection')}
      </button>
      <span class="tool-note" data-testid="doors-objects" data-count={count}>
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
    <div class="tool-items">
      <h3 class="tool-heading">{t('tools.doors.list', { count: doors.length })}</h3>
      {doors.length === 0 ? (
        <p class="tool-note">{t('tools.doors.none')}</p>
      ) : (
        <ol class="tool-list" data-testid="doors-list" start={0}>
          {doors.map(({ index: i, entry }) => {
            const found = findings.get(i)?.length ?? 0;
            return (
              <li key={i} class="tool-item" data-door={i} data-selected={chosen.includes(i) ? 'true' : undefined}>
                <button
                  type="button"
                  class="tool-item-name"
                  aria-pressed={chosen.includes(i)}
                  onClick={(event) => tool.select(i, event.shiftKey)}
                  onKeyDown={(event) => {
                    if ((event.key === 'Delete' || event.key === 'Backspace') && !readOnly) {
                      event.preventDefault();
                      tool.remove(i);
                    }
                  }}
                >
                  <span class="tool-item-index">{t('tools.doors.door', { index: i })}</span>
                  <code class="tool-item-summary">{entry.id ?? t('tools.doors.noId')}</code>
                  <span class="tool-item-summary">{doorSummary(entry)}</span>
                  {found > 0 && <span class="tool-item-flag">{t('tools.doors.findingsOf', { count: found })}</span>}
                </button>
                <span class="tool-item-actions">
                  <button type="button" class="tool-icon" aria-label={t('tools.doors.up', { index: i })} title={t('tools.doors.up', { index: i })} disabled={readOnly || i === 0} onClick={() => tool.reorder(i, i - 1)}>
                    ↑
                  </button>
                  <button
                    type="button"
                    class="tool-icon"
                    aria-label={t('tools.doors.down', { index: i })}
                    title={t('tools.doors.down', { index: i })}
                    disabled={readOnly || i === doors.length - 1}
                    onClick={() => tool.reorder(i, i + 1)}
                  >
                    ↓
                  </button>
                  <button type="button" class="tool-icon" aria-label={t('tools.doors.remove', { index: i })} title={t('tools.doors.remove', { index: i })} disabled={readOnly} onClick={() => tool.remove(i)}>
                    ✕
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <p class="tool-note">{t('tools.doors.order')}</p>
      <button type="button" class="tool-button" data-action="doors-add" disabled={readOnly} onClick={() => tool.add()}>
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
    <div class="tool-note" data-testid="doors-facts" data-wall={info.wall} data-out={info.out} data-bridge={info.bridge ?? undefined}>
      <p class="tool-note">
        {t(`tools.doors.wall.${info.wall}`)}, {t(`tools.doors.out.${info.out}`)}; {t('tools.doors.size', { thickness: formatNumber(round(info.thickness)), width: formatNumber(round(info.width)) })}
      </p>
      {info.bridge !== null && <p class={info.bridge === 'both' ? 'tool-note' : 'tool-note tool-warning'}>{t(`tools.doors.bridge.${info.bridge}`)}</p>}
      {typeLoads && (
        <p class="tool-note" data-testid="doors-movers" data-movers={movers.map((m) => m.name).join(' ')}>
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
    <fieldset class="tool-box" data-testid="doors-door" data-door={index}>
      <legend>{t('tools.doors.door', { index })}</legend>
      <div class="tool-row">
        <label class="tool-label" for="doors-id">
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
      {taken && <p class="tool-note tool-warning">{t('tools.doors.id.taken')}</p>}
      <p class="tool-note">{t('tools.doors.id.note')}</p>
      <fieldset class="tool-box">
        <legend>{t('tools.doors.flags')}</legend>
        {DOOR_FLAGS.map((flag) => (
          <label key={flag} class="tool-check" data-flag={flag}>
            <input type="checkbox" checked={entry[flag]} disabled={readOnly} onChange={(event) => tool.setFlag(index, flag, event.currentTarget.checked)} />
            {t(`tools.doors.flag.${flag}`)}
          </label>
        ))}
      </fieldset>
      <div class="tool-row">
        <label class="tool-label" for="doors-group">
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
      <p class="tool-note">{t('tools.doors.group.note')}</p>
      {box !== null && (
        <div class="tool-grid">
          <span />
          {AXES.map((axis) => (
            <span key={axis} class="tool-axis">
              {axis}
            </span>
          ))}
          {CORNERS.map((corner) => (
            <Fragment key={corner}>
              <span class="tool-axis">{t(`tools.doors.${corner}`)}</span>
              {AXES.map((axis, a) => (
                <NumberInput
                  key={`${index}-${corner}-${axis}`}
                  id={`doors-${corner}-${axis}`}
                  label={t('tools.doors.number', { corner, axis, index })}
                  value={box[KEYS[corner][a] as keyof DoorBox]}
                  disabled={readOnly}
                  onCommit={(value) => tool.setNumber(index, corner, a as 0 | 1 | 2, value)}
                />
              ))}
            </Fragment>
          ))}
        </div>
      )}
      <p class="tool-note">{t('tools.doors.numbers.note')}</p>
      <DoorFacts info={info} picture={picture} typeLoads={props.typeLoads} />
      <section class="tool-findings" data-testid="doors-findings" data-count={findings.length} data-codes={findings.map((f) => f.code).join(' ')} aria-live="polite">
        <h4 class="tool-heading">{t('tools.doors.findings', { count: findings.length })}</h4>
        {findings.length > 0 && (
          <ul class="tool-finding-list">
            {findings.map((problem, i) => (
              <li key={i} class="tool-note" data-code={problem.code}>
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
    <fieldset class="tool-box">
      <legend>{t('tools.doors.snap')}</legend>
      {keys.map((key) => (
        <label key={key} class="tool-check" data-snap={key}>
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
      <p class="tool-note">{t('tools.doors.snap.alt')}</p>
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
    <ul class="tool-legend" aria-label={t('tools.doors.legend')}>
      {entries.map(([style, key]) => (
        <li key={style}>
          <span class="tool-swatch" style={{ background: overlayStyle(style).color }} aria-hidden="true" />
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
    <div class="tool-body" data-testid="doors-tool" data-doors={picture.doors.length}>
      <p class="tool-note">{t('tools.doors.howto')}</p>
      {subject.type === null && <p class="tool-note tool-warning">{t('tools.doors.noType')}</p>}
      {subject.model === null && <p class="tool-note">{t('tools.doors.noModel')}</p>}
      <FromSelection tool={tool} readOnly={subject.readOnly} />
      <SuggestDoorsSection by={tool.byNames} subject={subject} />
      <DoorList tool={tool} picture={picture} chosen={chosen} readOnly={subject.readOnly} findings={findings} />
      {info !== undefined && (
        <DoorEditor tool={tool} info={info} picture={picture} readOnly={subject.readOnly} findings={findings.get(info.index) ?? []} typeLoads={subject.type !== null} />
      )}
      {loose.length > 0 && (
        <p class="tool-note tool-warning" data-testid="doors-loose">
          {t('tools.doors.loose', { list: loose.map(moverText).join(', ') })}
        </p>
      )}
      <SnapChoice tool={tool} />
      <Legend />
    </div>
  );
}
