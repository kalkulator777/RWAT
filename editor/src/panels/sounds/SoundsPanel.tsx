import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { dispatch } from '../../app/session';
import { findings, openModel, openWagon, pack, revision, schema } from '../../app/store';
import { audition } from '../../audio/audition';
import { BEHAVIOUR, type SoundKey } from '../../audio/kinds';
import { DOOR_CLOSE, DOOR_OPEN, gameGain, gamePitch, type Levels } from '../../audio/levels';
import { isFile } from '../../audio/ref';
import { problemMessage } from '../../checks/messages';
import { descriptorAt } from '../../checks/fields';
import type { LoadedModel, Op, Problem } from '../../core/contracts';
import { childPointer } from '../../core/json';
import type { Pack } from '../../core/pack';
import type { Schema } from '../../core/schema';
import { Field, formContext, type FormContext } from '../../forms';
import { formatNumber, lang, t } from '../../i18n';
import { listenError, playLoopOf, playRef, stopListening } from './listen';
import {
  SLIDERS,
  addControl,
  clackAt,
  controlRows,
  doorRows,
  effectiveRanges,
  loopDecl,
  loopLevels,
  refState,
  refText,
  removeAt,
  setRef,
  subjectOf,
  suggestedControls,
  toObject,
  type ControlRow,
  type LoopDecl,
  type LoopKey,
  type SoundsSubject,
} from './model';
import './sounds.css';

/** What every part of the tab needs. */
interface Env {
  open: Pack;
  subject: SoundsSubject;
  schema: Schema;
  ctx: FormContext;
  readOnly: boolean;
  problems: readonly Problem[];
  model: LoadedModel | null;
  edit(ops: Op[], label: string, field: string): void;
}

const num = (value: number): string => formatNumber(value, 3);

// ------------------------------------------------------------------------- findings

/** The findings of the model's file at a pointer or inside it. */
function problemsAt(env: Env, pointer: string): Problem[] {
  return env.problems.filter((problem) =>
    problem.at.some((link) => link.kind === 'field' && link.file === env.subject.modelFile && (link.at === pointer || link.at.startsWith(`${pointer}/`))),
  );
}

function Findings({ env, pointer, id }: { env: Env; pointer: string; id: string }) {
  const list = problemsAt(env, pointer);
  if (list.length === 0) return null;
  const context = { pack: env.open, schema: env.schema };
  return (
    <ul class="sounds-problems" data-testid={`sounds-problems-${id}`} data-codes={list.map((p) => p.code).join(' ')} aria-label={t('sounds.problems')}>
      {list.map((problem, index) => (
        <li key={`${problem.code}:${index}`} class={`sounds-problem sounds-problem-${problem.severity}`} data-code={problem.code}>
          <strong>{t(`checks.severity.${problem.severity}`)}:</strong> {problemMessage(problem, context)}
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------------ references

interface RefRowProps {
  env: Env;
  /** Where the reference is, or would be written. */
  pointer: string;
  /** The row's name for the eye and for a screen reader. */
  label: string;
  value: string | null;
  /** The pointer removed by "Remove" (the whole loop for its required `main`); none: not removable. */
  removePointer?: string;
  /** What "play" plays it at; none: the file as it is. */
  levels?: () => Levels;
  /** Shown when the row has no sound. */
  fallback?: string;
}

/** One sound reference: its text, a picker of the pack's .ogg files, "play as it is", "remove". */
function RefRow(props: RefRowProps) {
  const { env, pointer, label } = props;
  const ref = props.value;
  const [draft, setDraft] = useState<string | null>(null);
  const state = ref === null ? null : refState(ref, env.subject);
  const field = pointer.slice(1);
  const commit = (text: string): void => {
    setDraft(null);
    const value = text.trim();
    if (value === (ref ?? '')) return;
    if (value === '') {
      if (props.removePointer !== undefined && ref !== null) env.edit(removeAt(env.subject, props.removePointer), 'sounds.command.remove', props.removePointer.slice(1));
      return;
    }
    env.edit(setRef(env.subject, pointer, value), 'sounds.command.set', field);
  };
  const chosen = state?.present === true ? (state.ref.file as string) : '';
  const playable = state?.present === true;
  return (
    <div class="sounds-ref" data-ref={pointer} data-kind={state === null ? 'none' : state.ref.kind} data-present={state === null ? undefined : String(state.present)}>
      <span class="sounds-ref-label">{label}</span>
      <input
        type="text"
        class="sounds-ref-input"
        value={draft ?? ref ?? ''}
        placeholder={props.fallback ?? t('sounds.ref.none')}
        aria-label={t('sounds.ref.value', { label })}
        spellcheck={false}
        autoComplete="off"
        disabled={env.readOnly}
        onInput={(event) => setDraft(event.currentTarget.value)}
        onChange={(event) => commit(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setDraft(null);
        }}
      />
      <select
        class="sounds-ref-file"
        value={chosen}
        aria-label={t('sounds.ref.pickLabel', { label })}
        disabled={env.readOnly || env.subject.files.length === 0}
        onChange={(event) => {
          const file = event.currentTarget.value;
          if (file !== '') env.edit(setRef(env.subject, pointer, refText(file, env.subject)), 'sounds.command.set', field);
        }}
      >
        <option value="">{state?.ref.kind === 'file' && !state.present ? t('sounds.ref.custom') : t('sounds.ref.pickFile')}</option>
        {env.subject.files.map((file) => (
          <option key={file} value={file}>
            {file.replace(/^assets\//, '')}
          </option>
        ))}
      </select>
      <button
        type="button"
        class="sounds-play"
        disabled={!playable}
        title={t('sounds.ref.play')}
        aria-label={t('sounds.ref.playLabel', { label })}
        onClick={() => void playRef(env.open, ref as string, env.subject.declaring, props.levels?.() ?? { volume: 1, pitch: 1 })}
      >
        ▶
      </button>
      {ref === null || props.removePointer === undefined ? (
        <span />
      ) : (
        <button
          type="button"
          class="sounds-remove"
          disabled={env.readOnly}
          aria-label={t('sounds.ref.removeLabel', { label })}
          onClick={() => env.edit(removeAt(env.subject, props.removePointer as string), 'sounds.command.remove', (props.removePointer as string).slice(1))}
        >
          {t('sounds.ref.remove')}
        </button>
      )}
      <span class="sounds-ref-note" data-testid="sounds-ref-note">
        {state === null
          ? ''
          : state.ref.kind === 'event'
            ? t('sounds.ref.event', { id: state.ref.id })
            : state.present
              ? t('sounds.ref.file')
              : t('sounds.ref.missing', { file: state.ref.file as string })}
      </span>
    </div>
  );
}

// -------------------------------------------------------------------------- sections

interface SectionProps {
  env: Env;
  id: SoundKey;
  state: 'set' | 'unset';
  children: ComponentChildren;
}

/** A key of `sounds`: its name, what the engine does with it, how far it carries, then its fields and findings. */
function Section({ env, id, state, children }: SectionProps) {
  const pointer = childPointer('/sounds', id);
  return (
    <section class="sounds-section" data-testid={`sounds-section-${id}`} data-sound={id} data-state={state} aria-label={t(`sounds.section.${id}`)}>
      <h3 class="sounds-heading">
        {t(`sounds.section.${id}`)} <code>{id}</code> <span class="sounds-state">{t(`sounds.state.${state}`)}</span>
      </h3>
      <p class="sounds-what">{t(`sounds.what.${id}`)}</p>
      <p class="sounds-carry">{t('sounds.carry', { distance: BEHAVIOUR[id].distance })}</p>
      {children}
      <Findings env={env} pointer={pointer} id={id} />
    </section>
  );
}

/** What the engine plays now, in words: the ranges (the pack's, else the defaults) or the signal's level. */
function Effective({ id, decl }: { id: LoopKey; decl: LoopDecl }) {
  if (id === 'horn' || id === 'bell') {
    if (decl.form === 'absent') return <p class="sounds-absent">{t(`sounds.absent.${id}`)}</p>;
    const [pitch, volume] = [loopLevels(id, decl, 0).pitch, loopLevels(id, decl, 0).volume];
    const unused = (decl.pitch !== null && decl.pitch[0] !== decl.pitch[1]) || (decl.volume !== null && decl.volume[0] !== decl.volume[1]);
    const text = (value: number, declared: boolean): string => (declared ? num(value) : t('sounds.effective.fileAsIs'));
    return (
      <p class="sounds-effective" data-testid={`sounds-effective-${id}`}>
        {t('sounds.effective.signal', {
          pitch: text(pitch, decl.pitch !== null),
          volume: text(volume, decl.volume !== null),
          unused: unused ? t('sounds.effective.signalUnused') : '',
        })}
      </p>
    );
  }
  if (id === 'idle' && decl.form === 'absent') return <p class="sounds-absent">{t('sounds.absent.idle')}</p>;
  const ranges = effectiveRanges(id, decl);
  return (
    <>
      {id === 'wheels' && decl.form === 'absent' && <p class="sounds-absent">{t('sounds.absent.wheels')}</p>}
      <ul class="sounds-effective" data-testid={`sounds-effective-${id}`}>
        <li data-name="pitch">
          {t('sounds.effective.range', {
            name: t('sounds.effective.pitch'),
            from: num(ranges.pitch[0]),
            to: num(ranges.pitch[1]),
            by: ranges.pitchDeclared ? '' : t('sounds.effective.byDefault'),
          })}
        </li>
        <li data-name="volume">
          {t('sounds.effective.range', {
            name: t('sounds.effective.volume'),
            from: num(ranges.volume[0]),
            to: num(ranges.volume[1]),
            by: ranges.volumeDeclared ? '' : t('sounds.effective.byDefault'),
          })}
        </li>
      </ul>
    </>
  );
}

/** The slider and the play button of a sound that follows a quantity, or the play button of a signal. */
function Listen({ env, id, decl }: { env: Env; id: LoopKey; decl: LoopDecl }) {
  const slider = id === 'idle' || id === 'wheels' ? SLIDERS[id] : null;
  const [position, setPosition] = useState(slider?.start ?? 0);
  const playing = audition.current.value === id;
  if (decl.main === undefined) return null;
  const playable = refState(decl.main, env.subject).present;
  const levels = (at: number): Levels => loopLevels(id, decl, at);
  const played = levels(position);
  const startOrStop = (): void => {
    if (playing) audition.release();
    else void playLoopOf(env.open, id, decl, env.subject.declaring, levels(position), id === 'horn' || id === 'bell');
  };
  return (
    <div class="sounds-listen" data-testid={`sounds-listen-${id}`} data-playing={String(playing)}>
      {slider !== null && (
        <label class="sounds-slider">
          <span>{t(slider.unit === 'notch' ? 'sounds.listen.engine' : 'sounds.listen.speed', { value: position })}</span>
          <input
            type="range"
            min={slider.min}
            max={slider.max}
            step={slider.step}
            value={position}
            aria-label={t('sounds.listen.slider')}
            onInput={(event) => {
              const next = Number(event.currentTarget.value);
              setPosition(next);
              if (audition.current.value === id) audition.setLevels(levels(next));
            }}
          />
        </label>
      )}
      <button type="button" class="sounds-loop-button" disabled={!playable && !playing} onClick={startOrStop}>
        {t(playing ? 'sounds.listen.stop' : 'sounds.listen.play')}
      </button>
      <span class="sounds-readout" data-testid={`sounds-readout-${id}`}>
        {t('sounds.listen.readout', { pitch: num(gamePitch(played.pitch)), volume: num(gameGain(played.volume)) })}
      </span>
      <span class="sounds-note">{t('sounds.listen.note')}</span>
    </div>
  );
}

/** A loop key: `idle`, `wheels`, `horn`, `bell`. */
function LoopSection({ env, id }: { env: Env; id: LoopKey }) {
  const pointer = childPointer('/sounds', id);
  const decl = loopDecl(env.subject.sounds?.[id]);
  const object = decl.form === 'object';
  const part = (name: 'start' | 'main' | 'stop', ref: string | undefined) => (
    <RefRow
      key={name}
      env={env}
      pointer={childPointer(pointer, name)}
      label={t(`sounds.part.${name}`)}
      value={ref ?? null}
      removePointer={name === 'main' ? pointer : childPointer(pointer, name)}
    />
  );
  const ranges = ['pitch', 'volume'].map((name) => {
    const at = childPointer(pointer, name);
    const d = descriptorAt(env.schema.fields.root('wagon_model'), env.subject.declaration, at);
    return d === undefined ? null : <Field key={name} d={d} at={at} ctx={env.ctx} label={name} />;
  });
  return (
    <Section env={env} id={id} state={decl.form === 'absent' ? 'unset' : 'set'}>
      <Effective id={id} decl={decl} />
      <div class="sounds-refs">
        {object ? (
          <>
            {part('start', decl.start)}
            {part('main', decl.main)}
            {part('stop', decl.stop)}
          </>
        ) : (
          <RefRow env={env} pointer={pointer} label={t('sounds.part.sound')} value={decl.main ?? null} removePointer={pointer} />
        )}
      </div>
      {decl.form === 'string' && (
        <button type="button" class="sounds-to-object" disabled={env.readOnly} onClick={() => env.edit(toObject(env.subject, id), 'sounds.command.object', pointer.slice(1))}>
          {t('sounds.toObject')}
        </button>
      )}
      {object && (
        <div class="sounds-ranges" data-testid={`sounds-ranges-${id}`}>
          {ranges}
        </div>
      )}
      <Listen env={env} id={id} decl={decl} />
      {decl.main !== undefined && !isFile(decl.main) && <p class="sounds-note">{t('sounds.listen.cantEvent')}</p>}
    </Section>
  );
}

/** `clack`: one reference, a joint at a speed. */
function ClackSection({ env }: { env: Env }) {
  const ref = typeof env.subject.sounds?.clack === 'string' ? env.subject.sounds.clack : null;
  const slider = SLIDERS.clack;
  const [kmh, setKmh] = useState(slider.start);
  const levels = clackAt(kmh);
  return (
    <Section env={env} id="clack" state={ref === null ? 'unset' : 'set'}>
      {ref === null && <p class="sounds-absent">{t('sounds.absent.clack')}</p>}
      <RefRow env={env} pointer="/sounds/clack" label={t('sounds.part.sound')} value={ref} removePointer="/sounds/clack" levels={() => clackAt(kmh)} />
      {ref !== null && (
        <div class="sounds-listen" data-testid="sounds-listen-clack">
          <label class="sounds-slider">
            <span>{t('sounds.listen.speed', { value: kmh })}</span>
            <input type="range" min={slider.min} max={slider.max} step={slider.step} value={kmh} aria-label={t('sounds.listen.slider')} onInput={(event) => setKmh(Number(event.currentTarget.value))} />
          </label>
          <span class="sounds-readout" data-testid="sounds-readout-clack">
            {t('sounds.listen.readout', { pitch: num(gamePitch(levels.pitch)), volume: num(gameGain(levels.volume)) })}
          </span>
        </div>
      )}
    </Section>
  );
}

/** `doors`: a sound for each door of the type; the keys that name none are marked. */
function DoorsSection({ env }: { env: Env }) {
  const rows = doorRows(env.subject);
  const any = rows.some((row) => row.ref !== null);
  return (
    <Section env={env} id="doors" state={any ? 'set' : 'unset'}>
      {rows.length === 0 && <p class="sounds-absent">{t('sounds.doors.none')}</p>}
      {rows.map((row) => (
        <div key={row.pointer} class="sounds-door" data-door={row.id ?? row.key ?? ''}>
          <RefRow
            env={env}
            pointer={row.pointer}
            label={row.id ?? (row.key as string)}
            value={row.ref}
            removePointer={row.key === null ? undefined : row.pointer}
            fallback={t('sounds.doors.default')}
            levels={() => ({ volume: 1, pitch: 1 })}
          />
          {row.id === null && <p class="sounds-note sounds-note-warning">{t('sounds.doors.noDoor')}</p>}
        </div>
      ))}
      <p class="sounds-note">
        <code>{DOOR_OPEN}</code>, <code>{DOOR_CLOSE}</code>
      </p>
    </Section>
  );
}

/** A handle's name in the interface language. */
function handleName(handle: string): string {
  return t(`sounds.handle.${handle.toLowerCase().replaceAll('_', '-')}`);
}

/** What the engine does with a control key, in words. */
function verdictText(row: ControlRow): string {
  const { verdict } = row;
  switch (verdict.verdict) {
    case 'plays':
      return t('sounds.controls.verdict.plays', { handle: handleName(verdict.handle) });
    case 'silent':
      return t('sounds.controls.verdict.silent', { kind: verdict.kind });
    case 'shadowed':
      return t('sounds.controls.verdict.shadowed', { first: verdict.first, handle: handleName(verdict.handle) });
    default:
      return t('sounds.controls.verdict.unknown');
  }
}

function AddControl({ env, keys }: { env: Env; keys: string[] }) {
  const [typed, setTyped] = useState('');
  const [picked, setPicked] = useState('');
  const key = (typed.trim() || picked || keys[0]) ?? '';
  const add = (): void => {
    if (key === '') return;
    setTyped('');
    env.edit(addControl(env.subject, key), 'sounds.command.add', key);
  };
  return (
    <div class="sounds-add" data-testid="sounds-add-control">
      {keys.length > 0 && (
        <select aria-label={t('sounds.controls.addLabel')} value={picked || keys[0]} disabled={env.readOnly} onChange={(event) => setPicked(event.currentTarget.value)}>
          {keys.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      )}
      <input
        type="text"
        value={typed}
        placeholder={t('sounds.controls.addKey')}
        aria-label={t('sounds.controls.addKey')}
        spellcheck={false}
        disabled={env.readOnly}
        onInput={(event) => setTyped(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') add();
        }}
      />
      <button type="button" disabled={env.readOnly || key === ''} onClick={add}>
        {t('sounds.controls.add')}
      </button>
    </div>
  );
}

/** `controls`: a row for each key with the verdict of the engine, a move and an engage sound. */
function ControlsSection({ env }: { env: Env }) {
  const rows = controlRows(env.subject, env.model);
  const suggestions = suggestedControls(env.subject, env.model);
  return (
    <Section env={env} id="controls" state={rows.length > 0 ? 'set' : 'unset'}>
      {rows.length === 0 && <p class="sounds-absent">{t('sounds.absent.controls')}</p>}
      {rows.map((row) => {
        const pointer = childPointer('/sounds/controls', row.key);
        return (
          <fieldset key={row.key} class="sounds-control" data-testid={`sounds-control-${row.key}`} data-verdict={row.verdict.verdict}>
            <legend>
              <code>{row.key}</code>
            </legend>
            <p class={`sounds-verdict sounds-verdict-${row.verdict.verdict}`}>
              {verdictText(row)}
              {row.organ !== null && <span class="sounds-organ"> · {t(row.organ ? 'sounds.controls.organ.yes' : 'sounds.controls.organ.no')}</span>}
            </p>
            <RefRow env={env} pointer={childPointer(pointer, 'move')} label={t('sounds.part.move')} value={row.move} removePointer={childPointer(pointer, 'move')} />
            <RefRow env={env} pointer={childPointer(pointer, 'engage')} label={t('sounds.part.engage')} value={row.engage} removePointer={childPointer(pointer, 'engage')} />
            <button
              type="button"
              class="sounds-remove"
              disabled={env.readOnly}
              aria-label={t('sounds.controls.removeKeyLabel', { key: row.key })}
              onClick={() => env.edit(removeAt(env.subject, pointer), 'sounds.command.remove', pointer.slice(1))}
            >
              {t('sounds.controls.removeKey')}
            </button>
          </fieldset>
        );
      })}
      <AddControl env={env} keys={suggestions} />
    </Section>
  );
}

// ---------------------------------------------------------------------------- the tab

/**
 * The "Sounds" tab (editor.md §2.4 item 4): the sounds of the open wagon's model by role —
 * engine, wheels, horn, whistle, rail joints, doors by id, cab controls by key — with what
 * the engine does with each, the fields to change it (the forms' own for the numbers, a
 * picker of the pack's .ogg files for the references), and listening. Every edit is a
 * command of the journal. Listening stops when the pack closes or another wagon opens.
 */
export function SoundsPanel() {
  void revision.value;
  void lang.value;
  const open = pack.value;
  const wagon = openWagon.value;
  useEffect(() => {
    stopListening();
  }, [open, wagon]);
  useEffect(() => stopListening, []);
  const loaded = schema.value;
  if (open === null) return <p class="slot-empty">{t('sounds.noPack')}</p>;
  const subject = subjectOf(open, wagon);
  if (subject === null) return <p class="slot-empty">{t(wagon === null ? 'sounds.pick' : 'sounds.noModel')}</p>;
  if (subject.declaration === undefined) return <p class="slot-empty">{t('sounds.brokenJson')}</p>;
  if (loaded === null) return <p class="slot-empty">{t('sounds.schemaLoading')}</p>;
  const readOnly = open.readOnly;
  const edit = (ops: Op[], label: string, field: string): void => {
    if (ops.length > 0) void dispatch({ label, labelParams: { field }, ops });
  };
  const model = openModel.value?.id === subject.wagon ? openModel.value : null;
  const ctx = formContext({
    file: subject.modelFile,
    kind: 'wagon_model',
    value: open.json(subject.modelFile),
    schema: loaded,
    problems: findings.value,
    pack: open,
    readOnly,
    onCommand: (command) => void dispatch(command),
  });
  const env: Env = { open, subject, schema: loaded, ctx, readOnly, problems: findings.value, model, edit };
  const error = listenError.value;
  return (
    <div class="sounds" data-testid="sounds" data-wagon={subject.wagon} data-file={subject.modelFile}>
      <p class="sounds-intro">{t('sounds.intro', { wagon: subject.wagon })}</p>
      {readOnly && <p class="sounds-note">{t('sounds.readOnly')}</p>}
      {error !== null && (
        <p class="sounds-error" role="alert" data-testid="sounds-error">
          {t(error.key, error.params)}
        </p>
      )}
      {(['idle', 'wheels', 'horn', 'bell'] as const).map((id) => (
        <LoopSection key={id} env={env} id={id} />
      ))}
      <ClackSection env={env} />
      <DoorsSection env={env} />
      <ControlsSection env={env} />
    </div>
  );
}
