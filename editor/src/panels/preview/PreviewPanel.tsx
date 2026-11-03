import { useState } from 'preact/hooks';
import conventions from '../../../../schema/obj-conventions.json';
import { formatNumber, lang, t } from '../../i18n';
import { controlValue, controlVisible } from '../../ports/controlPose';
import type { Control } from '../../ports/objectRole';
import { controlInput, NOTCHES } from '../../preview/inputs';
import { shines } from '../../ports/lights';
import { inputIn, litIn, positionIn, type PreviewState, type Rig } from '../../preview/scene';
import { preview } from '../../preview/store';
import './preview.css';

type Section = 'doors' | 'controls' | 'lights' | 'liveries' | 'couplers';

const SECTIONS: readonly Section[] = ['doors', 'controls', 'lights', 'liveries', 'couplers'];

/** What the control kind does in the game, from schema/obj-conventions.json, in the interface language. */
function kindEffect(control: Control): string | undefined {
  const entry = conventions.control_kinds.find((kind) => kind.kind === control.kind);
  if (entry === undefined) return undefined;
  return lang.value === 'ru' ? entry['x-description-ru'] : entry.effect;
}

/** The i18n key of a control kind's name (keys take no '_': `preview.kind.GAUGE-SPEED`). */
function kindKey(control: Control): string {
  return `preview.kind.${control.kind.replaceAll('_', '-')}`;
}

/** The door's flags as a short line: inner, gangway, its group. */
function doorFlags(door: { inner: boolean; connecting: boolean; group: string | null }): string {
  const flags: string[] = [];
  if (door.inner) flags.push(t('preview.doors.flag.inner'));
  if (door.connecting) flags.push(t('preview.doors.flag.connecting'));
  if (door.group !== null) flags.push(t('preview.doors.flag.group', { group: door.group }));
  return flags.join(', ');
}

function Doors({ r, state }: { r: Rig; state: PreviewState }) {
  const type = r.type;
  if (type === null) return <p class="preview-note">{t('preview.doors.noType')}</p>;
  const rows = state.doors.map((progress, index) => ({ index, progress, door: type.doors[index]! })).filter((row) => !row.door.fixed);
  const orphanLeaves = r.leaves.filter((leaf) => leaf.door < 0).map((leaf) => leaf.part.role.key);
  const orphanAnims = r.doors.filter((door) => door.door < 0).map((door) => door.id);
  return (
    <>
      {rows.length === 0 ? (
        <p class="preview-note">{t('preview.doors.none')}</p>
      ) : (
        <table class="preview-table">
          <thead>
            <tr>
              <th scope="col">{t('preview.doors.door')}</th>
              <th scope="col">{t('preview.doors.moves')}</th>
              <th scope="col">{t('preview.doors.progress')}</th>
              <th scope="col">
                <span class="preview-offscreen">{t('preview.doors.open')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ index, progress, door }) => {
              const anims = r.doors.filter((d) => d.door === index).map((d) => t('preview.doors.anim', { id: d.id }));
              const leaves = r.leaves.filter((leaf) => leaf.door === index).map((leaf) => leaf.part.role.key);
              const moves = [...anims, ...(leaves.length > 0 ? [t('preview.doors.leaves', { keys: leaves.join(', ') })] : [])];
              const flags = doorFlags(door);
              return (
                <tr key={door.id} data-door={door.id}>
                  <th scope="row" class="preview-key">
                    {door.id}
                    {flags !== '' && <span class="preview-sub">{flags}</span>}
                  </th>
                  <td class={moves.length === 0 ? 'preview-muted' : undefined}>{moves.length === 0 ? t('preview.doors.nothing') : moves.join('; ')}</td>
                  <td class="preview-slider-cell">
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={progress}
                      aria-label={t('preview.doors.slider', { id: door.id })}
                      aria-valuetext={`${formatNumber(progress * 100, 0)} %`}
                      onInput={(e) => preview.setDoor(index, Number(e.currentTarget.value))}
                    />
                    <output class="preview-value">{formatNumber(progress * 100, 0)} %</output>
                  </td>
                  <td>
                    <button type="button" title={t('preview.doors.toggleHint')} onClick={() => preview.toggleDoor(index)}>
                      {preview.isOpening(index) ? t('preview.doors.close') : t('preview.doors.open')}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {orphanLeaves.length > 0 && <p class="preview-note preview-warning">{t('preview.doors.orphanLeaves', { keys: orphanLeaves.join(', ') })}</p>}
      {orphanAnims.length > 0 && <p class="preview-note preview-warning">{t('preview.doors.orphanAnims', { ids: orphanAnims.join(', ') })}</p>}
    </>
  );
}

/** What a control's slider stands at, in words: a notch, a reverser step, a reading, a number. */
function inputText(role: Control, input: number): string {
  const slider = controlInput(role);
  switch (slider.kind) {
    case 'notches':
      return t('preview.controls.notch', { notch: input, notches: NOTCHES });
    case 'reverser':
      return t(input < 0 ? 'preview.controls.reverser.back' : input > 0 ? 'preview.controls.reverser.forward' : 'preview.controls.reverser.neutral');
    case 'reading':
      return t('preview.controls.reading', { reading: formatNumber(input, 2) });
    default:
      return formatNumber(input, 2);
  }
}

function Controls({ r, state }: { r: Rig; state: PreviewState }) {
  if (r.controls.length === 0) return <p class="preview-note">{t('preview.controls.none')}</p>;
  return (
    <table class="preview-table">
      <thead>
        <tr>
          <th scope="col">{t('preview.controls.control')}</th>
          <th scope="col">{t('preview.controls.kind')}</th>
          <th scope="col">{t('preview.controls.value')}</th>
        </tr>
      </thead>
      <tbody>
        {r.controls.map(({ part }) => {
          const role = part.role;
          const slider = controlInput(role);
          const input = inputIn(state, role);
          const position = positionIn(state, role);
          const value = controlValue(role, position);
          const motion: string[] = [];
          if (part.pivot !== null && part.degrees !== 0) motion.push(t('preview.controls.turn', { degrees: formatNumber(value * part.degrees, 1) }));
          const travel = Math.hypot(...part.slide) * value;
          if (travel !== 0) motion.push(t('preview.controls.slide', { distance: formatNumber(travel, 3) }));
          if (!controlVisible(role, position)) motion.push(t('preview.controls.hidden'));
          return (
            <tr key={role.key} data-control={role.key}>
              <th scope="row" class="preview-key">
                {role.key}
                {role.label !== null && <span class="preview-sub">{role.label}</span>}
              </th>
              <td title={kindEffect(role)}>
                {t(kindKey(role))}
                {slider.kind === 'group' && <span class="preview-sub">{t('preview.controls.group', { group: role.group })}</span>}
              </td>
              <td class="preview-slider-cell">
                <input
                  type="range"
                  min={slider.min}
                  max={slider.max}
                  step={slider.step}
                  value={input}
                  aria-label={t('preview.controls.slider', { key: role.key })}
                  aria-valuetext={inputText(role, input)}
                  onInput={(e) => preview.setInput(role.key, Number(e.currentTarget.value))}
                />
                <output class="preview-value">
                  {inputText(role, input)}
                  {motion.length > 0 && <span class="preview-sub">{motion.join(', ')}</span>}
                </output>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Lights({ r, state }: { r: Rig; state: PreviewState }) {
  const groups = r.lightGroups;
  const mask = litIn(r, state);
  const lamps = r.lamps.filter((lamp) => shines(lamp, mask)).length;
  const headlights = r.headlights.filter((h) => shines(h, mask)).length;
  return (
    <>
      {groups.length === 0 ? (
        <p class="preview-note">{t('preview.lights.none')}</p>
      ) : (
        <ul class="preview-list">
          {groups.map((group, i) => (
            <li key={group}>
              <label data-group={group}>
                <input type="checkbox" checked={((mask >> BigInt(i)) & 1n) !== 0n} onChange={(e) => preview.setGroup(group, e.currentTarget.checked ? 1 : 0)} />
                {t('preview.lights.group', { group })}
              </label>
            </li>
          ))}
        </ul>
      )}
      <p class="preview-note" data-testid="preview-lit">
        {t('preview.lights.summary', { lamps, lampsAll: r.lamps.length, headlights, headlightsAll: r.headlights.length })}
      </p>
      <button type="button" onClick={() => preview.showLight()}>
        {t('preview.lights.showLit')}
      </button>
    </>
  );
}

function Liveries({ state }: { state: PreviewState }) {
  const liveries = Object.entries(preview.subject.value?.model.liveries ?? {});
  if (liveries.length === 0) return <p class="preview-note">{t('preview.liveries.none')}</p>;
  return (
    <fieldset class="preview-fieldset">
      <legend>{t('preview.liveries.choice')}</legend>
      <label data-livery="">
        <input type="radio" name="preview-livery" checked={state.livery === null} onChange={() => preview.setLivery(null)} />
        {t('preview.liveries.base')}
      </label>
      {liveries.map(([id, swaps]) => (
        <label key={id} data-livery={id}>
          <input type="radio" name="preview-livery" checked={state.livery === id} onChange={() => preview.setLivery(id)} />
          {Object.keys(swaps).length === 0 ? t('preview.liveries.empty', { id }) : t('preview.liveries.swaps', { id, count: Object.keys(swaps).length })}
        </label>
      ))}
    </fieldset>
  );
}

function Couplers({ r, state }: { r: Rig; state: PreviewState }) {
  if (r.couplers.length === 0) return <p class="preview-note">{t('preview.couplers.none')}</p>;
  const ends = [true, false].filter((front) => r.couplers.some((c) => c.head.front === front));
  return (
    <ul class="preview-list">
      {ends.map((front) => {
        const count = r.couplers.filter((c) => c.head.front === front).length;
        return (
          <li key={String(front)}>
            <label data-end={front ? 'front' : 'rear'}>
              <input
                type="checkbox"
                checked={front ? state.coupled.front : state.coupled.rear}
                onChange={(e) => preview.setCoupled(front, e.currentTarget.checked)}
              />
              {t(front ? 'preview.couplers.front' : 'preview.couplers.rear', { count })}
            </label>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The "Preview" tab (editor.md §2.3–2.4, §6.1): the open model's doors (a slider each and
 * an "open/close" that swings it as the game does), its cab controls (a slider each, by
 * kind: notches, reverser steps, a gauge's reading, a switch's group value), its light
 * groups, its liveries and its coupled ends. It drives the 3D view through the preview
 * (preview/controller.ts) and writes nothing to the pack.
 */
export function PreviewPanel() {
  const [section, setSection] = useState<Section>('doors');
  const r = preview.rig.value;
  const state = preview.state.value;
  if (r === null || state === null) {
    return (
      <div class="preview" data-testid="preview">
        <p class="slot-empty">{t('preview.noModel')}</p>
      </div>
    );
  }
  const counts: Record<Section, number> = {
    doors: state.doors.filter((_, i) => r.type?.doors[i]?.fixed === false).length,
    controls: r.controls.length,
    lights: r.lightGroups.length,
    liveries: Object.keys(preview.subject.value?.model.liveries ?? {}).length,
    couplers: r.couplers.length,
  };
  return (
    <div class="preview" data-testid="preview" data-section={section}>
      <div class="preview-bar">
        <div class="toggle" role="group" aria-label={t('preview.sections')}>
          {SECTIONS.map((s) => (
            <button key={s} type="button" class="toggle-button" aria-pressed={section === s} data-section={s} onClick={() => setSection(s)}>
              {t(`preview.section.${s}`, { count: counts[s] })}
            </button>
          ))}
        </div>
        <button type="button" title={t('preview.resetHint')} onClick={() => preview.reset()}>
          {t('preview.reset')}
        </button>
        <span class="preview-muted">{t('preview.note')}</span>
      </div>
      <div class="preview-body">
        {section === 'doors' && <Doors r={r} state={state} />}
        {section === 'controls' && <Controls r={r} state={state} />}
        {section === 'lights' && <Lights r={r} state={state} />}
        {section === 'liveries' && <Liveries state={state} />}
        {section === 'couplers' && <Couplers r={r} state={state} />}
      </div>
    </div>
  );
}
