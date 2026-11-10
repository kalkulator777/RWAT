/**
 * The "Sounds" tab as data (docs/proposals/editor.md §2.4 item 4): what a wagon's `sounds`
 * say, read as the engine reads them (`client/sound/SoundSet.java`), and the commands that
 * edit them. Pure, no DOM; the tab (./SoundsPanel.tsx) draws it.
 *
 * The keys of `sounds` come from the schema (the tab asks it for the fields); what the
 * engine does with each is audio/kinds.ts. Edits are ops of the journal on the model's
 * declaration, built with the forms' own (`setOps`, `removeOps`), so a file is written
 * the way a form writes it.
 */

import { controlVerdicts, type ControlVerdict } from '../../checks/sounds/problems';
import { doorIds } from '../../checks/loader';
import { childPointer, getAt, isJsonObject } from '../../core/json';
import type { LoadedModel, Op } from '../../core/contracts';
import type { Pack } from '../../core/pack';
import { classify } from '../../core/pack';
import { SOUNDING_HANDLES, type SoundingHandle } from '../../audio/kinds';
import {
  CLACK_FULL_KMH,
  ENGINE_PITCH,
  ENGINE_VOLUME,
  FALLBACK_WHEELS,
  NOTCHES,
  WHEELS_PITCH,
  WHEELS_VOLUME,
  clackLevels,
  engineLevels,
  signalPitch,
  signalVolume,
  throttleOfNotch,
  wheelsLevels,
  type Levels,
  type Range,
} from '../../audio/levels';
import { oggFiles, parseRef, refOfFile, type SoundRef } from '../../audio/ref';
import { removeOps, setOps } from '../../forms';

/** The wagon whose sounds the tab shows: its declaration and what goes with it. */
export interface SoundsSubject {
  /** `namespace:id`. */
  wagon: string;
  /** The model declaration's pack path. */
  modelFile: string;
  /** The type's pack path, or null for a model without a type. */
  typeFile: string | null;
  /** The namespace the declaration reads an unqualified reference in. */
  declaring: string;
  /** The declaration's value (an object), or undefined when the file is not JSON. */
  declaration: Record<string, unknown> | undefined;
  /** The `sounds` object; undefined when the declaration has none. */
  sounds: Record<string, unknown> | undefined;
  /** The door ids of the type, as it writes them. */
  doors: string[];
  /** Every `.ogg` of the pack under `assets/`. */
  files: string[];
}

/** The open wagon's subject, or null when none is open or it has no model declaration. */
export function subjectOf(pack: Pack, wagon: string | null): SoundsSubject | null {
  if (wagon === null) return null;
  const entry = pack.stock().find((candidate) => candidate.id === wagon);
  if (entry?.model == null) return null;
  const declaration = pack.json(entry.model);
  const object = isJsonObject(declaration) ? declaration : undefined;
  const type = entry.type === null ? undefined : pack.json(entry.type);
  return {
    wagon,
    modelFile: entry.model,
    typeFile: entry.type,
    declaring: classify(entry.model)?.namespace ?? wagon.split(':')[0] ?? '',
    declaration: object,
    sounds: object !== undefined && isJsonObject(object.sounds) ? object.sounds : undefined,
    doors: doorIds(type) ?? [],
    files: oggFiles(pack.paths()),
  };
}

// ----------------------------------------------------------------------------- loops

/** A loop (`idle`, `wheels`, `horn`, `bell`) as the declaration gives it. */
export interface LoopDecl {
  /** `absent`: no key; `string`: one sound; `object`: `{start, main, stop, pitch, volume}`. */
  form: 'absent' | 'string' | 'object';
  start?: string;
  main?: string;
  stop?: string;
  pitch: Range | null;
  volume: Range | null;
}

function rangeOf(value: unknown): Range | null {
  return Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === 'number' && Number.isFinite(n)) ? [value[0] as number, value[1] as number] : null;
}

function refOf(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** The loop a `sounds.<key>` value declares. */
export function loopDecl(value: unknown): LoopDecl {
  if (typeof value === 'string') return { form: 'string', main: refOf(value), pitch: null, volume: null };
  if (!isJsonObject(value)) return { form: 'absent', pitch: null, volume: null };
  return { form: 'object', start: refOf(value.start), main: refOf(value.main), stop: refOf(value.stop), pitch: rangeOf(value.pitch), volume: rangeOf(value.volume) };
}

export type LoopKey = 'idle' | 'wheels' | 'horn' | 'bell';

/** The ranges the engine reads for a loop that follows the throttle or the speed: the pack's, else its defaults (and a wheel-less stock rolls like a minecart). */
export function effectiveRanges(key: 'idle' | 'wheels', decl: LoopDecl): { pitch: Range; volume: Range; pitchDeclared: boolean; volumeDeclared: boolean } {
  if (key === 'idle') return { pitch: decl.pitch ?? ENGINE_PITCH, volume: decl.volume ?? ENGINE_VOLUME, pitchDeclared: decl.pitch !== null, volumeDeclared: decl.volume !== null };
  if (decl.form === 'absent') return { pitch: FALLBACK_WHEELS.pitch, volume: FALLBACK_WHEELS.volume, pitchDeclared: false, volumeDeclared: false };
  return { pitch: decl.pitch ?? WHEELS_PITCH, volume: decl.volume ?? WHEELS_VOLUME, pitchDeclared: decl.pitch !== null, volumeDeclared: decl.volume !== null };
}

/** The slider of a sound that follows a quantity: its range, step and unit. */
export interface Slider {
  min: number;
  max: number;
  step: number;
  unit: 'notch' | 'kmh';
  /** Where it starts: the full end of the engine's range (`idle`: the last notch, `wheels`: 100 km/h). */
  start: number;
}

export const SLIDERS: Readonly<Record<'idle' | 'wheels' | 'clack', Slider>> = {
  idle: { min: 0, max: NOTCHES, step: 1, unit: 'notch', start: NOTCHES },
  wheels: { min: 0, max: 120, step: 1, unit: 'kmh', start: 100 },
  clack: { min: 0, max: CLACK_FULL_KMH * 3, step: 1, unit: 'kmh', start: CLACK_FULL_KMH },
};

/**
 * The pitch and volume a loop is played at for the slider's position (a notch for `idle`,
 * km/h for `wheels`; a signal has no position): what the engine passes to the sound engine,
 * before the game's own limits (audio/levels `gameGain`, `gamePitch`).
 */
export function loopLevels(key: LoopKey, decl: LoopDecl, position: number): Levels {
  switch (key) {
    case 'idle':
      return engineLevels(decl, throttleOfNotch(position));
    case 'wheels':
      return wheelsLevels(decl.form === 'absent' ? FALLBACK_WHEELS : decl, position);
    default:
      return { pitch: signalPitch(decl), volume: signalVolume(decl) };
  }
}

/** A rail joint at a speed. */
export function clackAt(kmh: number): Levels {
  return clackLevels(kmh);
}

// ------------------------------------------------------------------------ references

/** What the tab says of one reference. */
export interface RefState {
  ref: SoundRef;
  /** A file: it is in the pack. An event: false. */
  present: boolean;
}

export function refState(ref: string, subject: SoundsSubject): RefState {
  const parsed = parseRef(ref, subject.declaring);
  return { ref: parsed, present: parsed.file !== null && subject.files.includes(parsed.file) };
}

/** A pack file written as a reference of the declaration. */
export function refText(file: string, subject: SoundsSubject): string {
  return refOfFile(file, subject.declaring) ?? file;
}

// ----------------------------------------------------------------------------- doors

/** One door of the type, or a key of `sounds.doors` that names none. */
export interface DoorRow {
  /** The type's door id; null for a key of the declaration that matches no door. */
  id: string | null;
  /** The key as the declaration writes it, or null when it has none for this door. */
  key: string | null;
  ref: string | null;
  /** Where the sound is (or would be written): `/sounds/doors/<key>`. */
  pointer: string;
}

/** Every door of the type, then the keys that name no door (they do nothing, the checks say so). The engine matches ids without case. */
export function doorRows(subject: SoundsSubject): DoorRow[] {
  const written = isJsonObject(subject.sounds?.doors) ? subject.sounds.doors : {};
  const used = new Set<string>();
  const rows: DoorRow[] = subject.doors.map((id) => {
    const key = Object.keys(written).find((name) => name.toLowerCase() === id.toLowerCase()) ?? null;
    if (key !== null) used.add(key);
    return { id, key, ref: refOf(written[key ?? '']) ?? null, pointer: childPointer('/sounds/doors', key ?? id) };
  });
  for (const key of Object.keys(written)) {
    if (!used.has(key)) rows.push({ id: null, key, ref: refOf(written[key]) ?? null, pointer: childPointer('/sounds/doors', key) });
  }
  return rows;
}

// --------------------------------------------------------------------------- controls

/** A key of `sounds.controls`. */
export interface ControlRow {
  key: string;
  verdict: ControlVerdict;
  move: string | null;
  engage: string | null;
  /** The open model has an organ of the kind the key sounds for; null when it is not known (no model, or the key sounds for none). */
  organ: boolean | null;
}

/** The handle a key sounds for, or null. */
export function handleOf(verdict: ControlVerdict): SoundingHandle | null {
  return verdict.verdict === 'plays' || verdict.verdict === 'shadowed' ? verdict.handle : null;
}

/** True when the model has a control object of the handle's kind. */
export function hasOrgan(model: LoadedModel | null, handle: SoundingHandle): boolean | null {
  return model === null ? null : model.objects.some((object) => object.control?.kind === handle);
}

/** The keys of `sounds.controls`, in the declaration's order, with what the engine does with each. */
export function controlRows(subject: SoundsSubject, model: LoadedModel | null): ControlRow[] {
  const controls = isJsonObject(subject.sounds?.controls) ? subject.sounds.controls : {};
  const verdicts = controlVerdicts(controls);
  return Object.entries(controls).map(([key, value]) => {
    const verdict = verdicts.get(key) ?? { verdict: 'unknown' as const };
    const handle = handleOf(verdict);
    const pair = isJsonObject(value) ? value : {};
    return { key, verdict, move: refOf(pair.move) ?? null, engage: refOf(pair.engage) ?? null, organ: handle === null ? null : hasOrgan(model, handle) };
  });
}

/** The keys offered for a control sound: the model's own organs of a handle that has no sounding key yet, else `<KIND>_1`. */
export function suggestedControls(subject: SoundsSubject, model: LoadedModel | null): string[] {
  const controls = isJsonObject(subject.sounds?.controls) ? subject.sounds.controls : {};
  const taken = new Set<string>();
  for (const verdict of controlVerdicts(controls).values()) {
    const handle = handleOf(verdict);
    if (handle !== null) taken.add(handle);
  }
  const fallback: Record<SoundingHandle, string> = { THROTTLE: 'THROTTLE_1', TRAIN_BRAKE: 'TRAIN_BRAKE_1', INDEPENDENT_BRAKE: 'INDEPENDENT_BRAKE_1', REVERSER: 'REVERSER_1' };
  return SOUNDING_HANDLES.filter((handle) => !taken.has(handle)).map((handle) => {
    const organ = model?.objects.find((object) => object.control?.kind === handle && !object.control.gauge);
    return organ?.control?.key ?? fallback[handle];
  });
}

// ------------------------------------------------------------------------------ edits

/** The ops that write a reference at a pointer of the declaration (the loop given as a sound becomes nothing else; parents are made). */
export function setRef(subject: SoundsSubject, pointer: string, ref: string): Op[] {
  return setOps(subject.modelFile, subject.declaration, pointer, ref);
}

/** The ops that remove the key at a pointer. */
export function removeAt(subject: SoundsSubject, pointer: string): Op[] {
  return removeOps(subject.modelFile, subject.declaration, pointer);
}

/** The ops that turn a loop given as one sound into `{main}`, which can take `start`, `stop`, `pitch` and `volume`. */
export function toObject(subject: SoundsSubject, key: LoopKey): Op[] {
  const at = childPointer('/sounds', key);
  const value = getAt(subject.declaration, at);
  return typeof value === 'string' ? [{ op: 'set', file: subject.modelFile, at, value: { main: value } }] : [];
}

/** The ops that add a control key with no sounds yet (`{}`; its `move` and `engage` follow). */
export function addControl(subject: SoundsSubject, key: string): Op[] {
  const at = childPointer('/sounds/controls', key);
  return getAt(subject.declaration, at) === undefined ? setOps(subject.modelFile, subject.declaration, at, {}) : [];
}
