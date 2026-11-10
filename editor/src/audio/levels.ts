/**
 * How loud and how high the engine plays each kind of train sound (docs/proposals/editor.md
 * §2.4 item 4; docs/proposals/pack-capabilities.md §8): the numbers and the interpolation
 * of `client/sound/TrainSounds.java` and `SoundLevels.java`, so that the editor's slider
 * "at rest ↔ at full" drives `pitch` and `volume` of a loop as the game does. Pure: no
 * DOM, no signals.
 *
 * This is a port, checked against the Java source text by ./levels.test.ts (the constants
 * and the lines of each formula are read from the sources, so a change there fails the
 * test here). It is kept in `audio/` for now; moving it to `ports/` with a golden case in
 * `fixtures/golden/` is a proposal in the report, outside this module's zone.
 *
 * What the editor does not repeat: the category sliders of the game, the stereo fade, the
 * hearing-distance stretch. The `trainVolume` setting is taken as its default, 1.
 */

/** A `[from, to]` range as a pack declares it: `from` at rest, `to` at full. */
export type Range = readonly [number, number];

/** A looping sound as the pack declares it, reduced to what the levels read. */
export interface LoopLevels {
  pitch?: Range | null;
  volume?: Range | null;
}

/** The pitch and volume (before `trainVolume` and the category slider) a sound is started with. */
export interface Levels {
  pitch: number;
  volume: number;
}

/** Java `float`: the engine reckons in single precision. */
const f = Math.fround;

/** How far each kind of sound carries, blocks (`TrainSounds.*_DISTANCE`). */
export const DISTANCES = {
  wheels: 48,
  clack: 40,
  idle: 64,
  horn: 192,
  bell: 128,
  doors: 24,
  controls: 16,
} as const;

/** Defaults when a declaration gives no range: wheels by speed, engine by throttle (`TrainSounds`). */
export const WHEELS_PITCH: Range = [f(0.7), f(1.3)];
export const WHEELS_VOLUME: Range = [f(0.15), f(0.6)];
export const ENGINE_PITCH: Range = [f(1.0), f(1.3)];
export const ENGINE_VOLUME: Range = [f(0.6), f(1.0)];

/** What a stock without a wheel sound of its own rolls like (`TrainSounds.FALLBACK_WHEELS`). */
export const FALLBACK_WHEELS = {
  main: 'minecraft:entity.minecart.riding',
  pitch: [f(0.6), f(1.1)] as Range,
  volume: [f(0.2), f(0.7)] as Range,
} as const;

/** The doors' sounds when the pack gives none (`TrainSounds.DOOR_OPEN`, `DOOR_CLOSE`). */
export const DOOR_OPEN = 'minecraft:block.iron_door.open';
export const DOOR_CLOSE = 'minecraft:block.iron_door.close';

/** Speed at the top of the wheels' range, km/h (`WHEELS_FULL_KMH`); the pitch carries on to 1.2 of it. */
export const WHEELS_FULL_KMH = 100;
export const WHEELS_BEYOND = 1.2;
/** Below this the wheels fade out, km/h (`WHEELS_FADE_KMH`). */
export const WHEELS_FADE_KMH = 6;
/** A rail joint knocks at this level at walking pace and at full level from `CLACK_FULL_KMH`. */
export const CLACK_LEVEL = 0.35;
export const CLACK_FULL_KMH = 40;
/** Handles run 0…NOTCHES (`Consist.NOTCHES`). */
export const NOTCHES = 8;
/** The game limits a sound's pitch to this range whatever the pack says. */
export const GAME_PITCH: Range = [0.5, 2.0];

/** The value of a range at `t`: 0 at rest, 1 at full; beyond 1 it carries on (`SoundLevels.at`). */
export function at(declared: Range | null | undefined, byDefault: Range, t: number): number {
  const range = declared ?? byDefault;
  return f(range[0] + f(f(range[1] - range[0]) * f(t)));
}

/** The pitch a held horn or whistle sounds at: the second number of its range, else unchanged (`SoundLevels.signalPitch`). */
export function signalPitch(loop: LoopLevels): number {
  return loop.pitch ? f(loop.pitch[1]) : 1;
}

/** The volume a held horn or whistle sounds at, before the `trainVolume` setting (`SoundLevels.signalVolume`). */
export function signalVolume(loop: LoopLevels): number {
  return loop.volume ? f(loop.volume[1]) : 1;
}

/** The engine's loop at a throttle 0…1 (`TrainSounds.engine`). */
export function engineLevels(loop: LoopLevels, throttle: number): Levels {
  return { volume: at(loop.volume, ENGINE_VOLUME, throttle), pitch: at(loop.pitch, ENGINE_PITCH, throttle) };
}

/** The throttle (0…1) of a notch 0…{@link NOTCHES}. */
export function throttleOfNotch(notch: number): number {
  return f(notch / NOTCHES);
}

/** The rolling loop at a speed in km/h (`TrainSounds.wheels`): the volume stops at the top of the range, the pitch goes on, the volume fades below a walking pace. */
export function wheelsLevels(loop: LoopLevels, kmh: number): Levels {
  const share = f(Math.min(kmh / WHEELS_FULL_KMH, WHEELS_BEYOND));
  const fade = f(Math.min(kmh / WHEELS_FADE_KMH, 1));
  const level = at(loop.volume, WHEELS_VOLUME, Math.min(share, 1));
  return { volume: f(level * fade), pitch: at(loop.pitch, WHEELS_PITCH, share) };
}

/** A rail joint under a bogie at a speed in km/h (`TrainSounds.clacks`): level and pitch by speed. */
export function clackLevels(kmh: number): Levels {
  return {
    volume: f(Math.min(CLACK_LEVEL + ((1 - CLACK_LEVEL) * kmh) / CLACK_FULL_KMH, 1)),
    pitch: f(0.9 + 0.25 * Math.min(kmh / 120, 1)),
  };
}

/** The gain the game's sound engine plays a source at: the volume times the slider, limited to 0…1. */
export function gameGain(volume: number, slider = 1): number {
  const gain = volume * slider;
  return Number.isFinite(gain) ? Math.min(1, Math.max(0, gain)) : 0;
}

/** The pitch the game's sound engine plays at: limited to {@link GAME_PITCH}. */
export function gamePitch(pitch: number): number {
  return Number.isFinite(pitch) ? Math.min(GAME_PITCH[1], Math.max(GAME_PITCH[0], pitch)) : 1;
}
