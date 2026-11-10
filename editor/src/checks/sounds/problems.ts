/**
 * The findings about the `sounds` of a wagon model (docs/proposals/editor.md §2.4 item 4,
 * §3.10): what the mod's loader keeps quiet about but the engine then does not do as the
 * author meant — a range the game bends or that runs backwards, a signal's number that is
 * never used, a `controls` key that never sounds, a reference that is read as a sound
 * event no pack defines. Source `loader`, codes `sound.*` (translated in ./i18n.ts),
 * each pointing at the field.
 *
 * Not here, because another check already says it: a `sounds.doors` key that is no door of
 * the type (`loader.door-key`), an Ogg file the pack lacks (`loader.missing-file`), the
 * shape of the keys and values (the schema). A `controls` key with no such organ in the
 * model is *not* a finding: the engine plays a handle's sound whenever the consist's handle
 * moves (`TrainSounds.cab`), whatever the model draws, so the key sounds either way; the
 * "Sounds" tab only tells whether the open model has the organ.
 *
 * A `controls` key of a control whose handle makes no sound (`WIDGET_*`, `ENGINE_START_*`)
 * is not a finding either, though it never sounds: the engine accepts it and says so
 * (`controlVerdicts` tells it to the "Sounds" tab), and the example pack carries one.
 *
 * Reading follows `SoundSet.java`: a `controls` key is read as an object's name, upper-cased,
 * and matches the handle of exactly that kind; only the first declared key of a kind sounds.
 */

import type { Link, Problem } from '../../core/contracts';
import { childPointer, isJsonObject } from '../../core/json';
import type { Pack } from '../../core/pack';
import { SOUNDING_HANDLES, isLoopKey, type SoundingHandle } from '../../audio/kinds';
import { GAME_PITCH } from '../../audio/levels';
import { declaredRefs, isFile, parseRef } from '../../audio/ref';
import { parseRole } from '../../ports/objectRole';

function field(file: string, at: string): Link[] {
  return [{ kind: 'field', file, at }];
}

/** `[from, to]` of two finite numbers, else null (the schema says the rest). */
function rangeOf(value: unknown): [number, number] | null {
  return Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === 'number' && Number.isFinite(n)) ? [value[0] as number, value[1] as number] : null;
}

/** The extensions of sound files the engine does not read: a reference ending so is read as a sound event id. */
const OTHER_AUDIO = /\.(?:wav|mp3|flac|m4a|aac|opus|oga|wma|aiff?|ogg)$/i;

/** The ranges of the loops: the game bends pitch, a negative volume is silence, a range may run backwards, a signal reads one number. */
function ranges(file: string, sounds: Record<string, unknown>, out: Problem[]): void {
  for (const [key, loop] of Object.entries(sounds)) {
    if (!isLoopKey(key) || !isJsonObject(loop)) continue;
    const signal = key === 'horn' || key === 'bell';
    for (const name of ['pitch', 'volume'] as const) {
      const range = rangeOf(loop[name]);
      if (range === null) continue;
      const at = childPointer(childPointer('/sounds', key), name);
      const [from, to] = range;
      if (signal) {
        if (from !== to) {
          out.push({
            severity: 'info',
            source: 'loader',
            code: 'sound.signal-first-ignored',
            params: { key, name, from, to },
            text: `sounds.${key}.${name}: a held ${key} sounds at the second number (${to}); the first (${from}) is not used`,
            at: field(file, at),
          });
        }
      } else if (from > to) {
        out.push({
          severity: 'warning',
          source: 'loader',
          code: 'sound.range-reversed',
          params: { key, name, from, to },
          text: `sounds.${key}.${name} runs backwards: [${from}, ${to}] is ${from} at rest and ${to} at full`,
          at: field(file, at),
        });
      }
      const used = signal ? [to] : [from, to];
      if (name === 'pitch') {
        const bent = used.find((n) => n < GAME_PITCH[0] || n > GAME_PITCH[1]);
        if (bent !== undefined) {
          out.push({
            severity: 'warning',
            source: 'loader',
            code: 'sound.pitch-clamped',
            params: { key, value: bent, min: GAME_PITCH[0], max: GAME_PITCH[1] },
            text: `sounds.${key}.pitch ${bent}: the game limits pitch to ${GAME_PITCH[0]}–${GAME_PITCH[1]}`,
            at: field(file, at),
          });
        }
      } else {
        const negative = used.find((n) => n < 0);
        if (negative !== undefined) {
          out.push({
            severity: 'warning',
            source: 'loader',
            code: 'sound.volume-negative',
            params: { key, value: negative },
            text: `sounds.${key}.volume ${negative}: a negative volume is silence`,
            at: field(file, at),
          });
        }
      }
    }
  }
}

/** What the engine does with one key of `sounds.controls` (`SoundSet.control`). */
export type ControlVerdict =
  /** It sounds for the handle of this kind. */
  | { verdict: 'plays'; handle: SoundingHandle }
  /** It names a control of the convention whose handle makes no sound (`WIDGET_1`, `ENGINE_START_1`, `THROTTLE_BRAKE_1`, a gauge). */
  | { verdict: 'silent'; kind: string }
  /** It names no cab control at all (`MY_LEVER_1`, `THROTTLE`). */
  | { verdict: 'unknown' }
  /** An earlier key is the same kind of handle: only the first declared key of a kind sounds. */
  | { verdict: 'shadowed'; handle: SoundingHandle; first: string };

/**
 * The verdicts of the keys of a `controls` object, in the declaration's order. The engine
 * upper-cases a key and reads it as an object's name; two keys alike but for case are one,
 * the later one's sounds standing in the earlier one's place (so the key is the later's
 * spelling).
 */
export function controlVerdicts(controls: Record<string, unknown>): Map<string, ControlVerdict> {
  const keys = new Map<string, string>();
  for (const key of Object.keys(controls)) keys.set(key.toUpperCase(), key);
  const first = new Map<SoundingHandle, string>();
  const verdicts = new Map<string, ControlVerdict>();
  for (const [upper, key] of keys) {
    const control = parseRole(upper).control;
    if (control === null) {
      verdicts.set(key, { verdict: 'unknown' });
    } else if (!(SOUNDING_HANDLES as readonly string[]).includes(control.kind)) {
      verdicts.set(key, { verdict: 'silent', kind: control.kind });
    } else {
      const handle = control.kind as SoundingHandle;
      const earlier = first.get(handle);
      if (earlier === undefined) {
        first.set(handle, key);
        verdicts.set(key, { verdict: 'plays', handle });
      } else {
        verdicts.set(key, { verdict: 'shadowed', handle, first: earlier });
      }
    }
  }
  return verdicts;
}

/** `sounds.controls`: a key that names no cab control, or a second key of a kind of handle, never sounds. */
function controls(file: string, sounds: Record<string, unknown>, out: Problem[]): void {
  if (!isJsonObject(sounds.controls)) return;
  for (const [key, verdict] of controlVerdicts(sounds.controls)) {
    const at = childPointer('/sounds/controls', key);
    if (verdict.verdict === 'unknown') {
      out.push({
        severity: 'warning',
        source: 'loader',
        code: 'sound.control-unknown',
        params: { key },
        text: `sounds.controls key '${key}' names no cab control: it never sounds`,
        at: field(file, at),
      });
    } else if (verdict.verdict === 'shadowed') {
      out.push({
        severity: 'warning',
        source: 'loader',
        code: 'sound.control-shadowed',
        params: { key, kind: verdict.handle, first: verdict.first },
        text: `sounds.controls key '${key}' is a ${verdict.handle} like '${verdict.first}' before it: only the first declared key of a kind sounds`,
        at: field(file, at),
      });
    }
  }
}

/** The event ids a pack's `sounds.json` of a namespace defines; null when it has none. */
function definedEvents(pack: Pack, namespace: string): Set<string> | null {
  const events = pack.json(`assets/${namespace}/sounds.json`);
  return isJsonObject(events) ? new Set(Object.keys(events)) : null;
}

/**
 * References that are no Ogg file: one that ends like another audio format is read as an
 * event id and plays nothing; an event of a namespace this pack has, that its `sounds.json`
 * does not define, plays nothing either (a vanilla event wants the explicit `minecraft:`).
 */
function events(pack: Pack, file: string, declaring: string, sounds: Record<string, unknown>, namespaces: ReadonlySet<string>, out: Problem[]): void {
  for (const { pointer, ref } of declaredRefs(sounds)) {
    if (isFile(ref)) continue;
    if (OTHER_AUDIO.test(ref)) {
      out.push({
        severity: 'warning',
        source: 'loader',
        code: 'sound.not-ogg',
        params: { ref },
        text: `sound '${ref}' is not an .ogg file: the engine reads it as a sound event id and nothing plays`,
        at: field(file, pointer),
      });
      continue;
    }
    const { namespace, path, id } = parseRef(ref, declaring);
    if (namespace === 'minecraft' || !namespaces.has(namespace)) continue; // the game's, or another pack's
    if (definedEvents(pack, namespace)?.has(path)) continue;
    const eventsFile = `assets/${namespace}/sounds.json`;
    out.push({
      severity: 'warning',
      source: 'loader',
      code: 'sound.event-undefined',
      params: { ref, id, file: eventsFile },
      text: `sound event ${id} is not in ${eventsFile}: nothing plays (a game event is written with the explicit minecraft: prefix)`,
      at: field(file, pointer),
    });
  }
}

/** Every finding about the sounds of the pack's wagon models, in the order of the wagons and of each declaration. */
export function soundProblems(pack: Pack): Problem[] {
  const out: Problem[] = [];
  const paths = pack.paths();
  const namespaces = new Set(paths.flatMap((path) => (path.startsWith('assets/') ? [path.split('/')[1] ?? ''] : [])));
  for (const entry of pack.stock()) {
    if (entry.model === null) continue;
    const model = pack.json(entry.model);
    if (!isJsonObject(model) || !isJsonObject(model.sounds)) continue;
    const [declaring = ''] = entry.id.split(':');
    ranges(entry.model, model.sounds, out);
    controls(entry.model, model.sounds, out);
    events(pack, entry.model, declaring, model.sounds, namespaces, out);
  }
  return out;
}
