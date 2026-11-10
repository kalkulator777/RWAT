import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../testing/repo.node';
import {
  CLACK_FULL_KMH,
  CLACK_LEVEL,
  DISTANCES,
  DOOR_CLOSE,
  DOOR_OPEN,
  ENGINE_PITCH,
  ENGINE_VOLUME,
  FALLBACK_WHEELS,
  NOTCHES,
  WHEELS_FADE_KMH,
  WHEELS_FULL_KMH,
  WHEELS_PITCH,
  WHEELS_VOLUME,
  at,
  clackLevels,
  engineLevels,
  gameGain,
  gamePitch,
  signalPitch,
  signalVolume,
  throttleOfNotch,
  wheelsLevels,
} from './levels';

const SOUND = `${REPO_ROOT}src/main/java/com/muzhik17/trainsmod/client/sound/`;
const trainSounds = readFileSync(`${SOUND}TrainSounds.java`, 'utf8');
const soundLevels = readFileSync(`${SOUND}SoundLevels.java`, 'utf8');
const consist = readFileSync(`${REPO_ROOT}src/main/java/com/muzhik17/trainsmod/consist/Consist.java`, 'utf8');

/** A line of the Java source with its spaces squeezed, as the test looks for it. */
function squeeze(text: string): string {
  return text.replace(/\s+/g, ' ');
}

const TRAIN = squeeze(trainSounds);
const LEVELS = squeeze(soundLevels);

/** The number of `private static final int NAME = n;` in TrainSounds. */
function intOf(name: string): number {
  const match = new RegExp(`${name} = (\\d+);`).exec(trainSounds);
  if (match === null) throw new Error(`no ${name} in TrainSounds.java`);
  return Number(match[1]);
}

function doubleOf(name: string): number {
  const match = new RegExp(`${name} = ([0-9.]+);`).exec(trainSounds);
  if (match === null) throw new Error(`no ${name} in TrainSounds.java`);
  return Number(match[1]);
}

/** `NAME = {a F, b F}` as the pair of numbers. */
function floatsOf(name: string): [number, number] {
  const match = new RegExp(`${name} = \\{([0-9.]+)F, ([0-9.]+)F\\}`).exec(trainSounds);
  if (match === null) throw new Error(`no ${name} in TrainSounds.java`);
  return [Math.fround(Number(match[1])), Math.fround(Number(match[2]))];
}

describe('the numbers of the engine, read from the Java source', () => {
  it('are the hearing distances', () => {
    expect(DISTANCES).toEqual({
      wheels: intOf('WHEELS_DISTANCE'),
      clack: intOf('CLACK_DISTANCE'),
      idle: intOf('ENGINE_DISTANCE'),
      horn: intOf('HORN_DISTANCE'),
      bell: intOf('BELL_DISTANCE'),
      doors: intOf('DOOR_DISTANCE'),
      controls: intOf('CONTROL_DISTANCE'),
    });
  });

  it('are the default ranges of the wheels and the engine', () => {
    expect(WHEELS_PITCH).toEqual(floatsOf('WHEELS_PITCH'));
    expect(WHEELS_VOLUME).toEqual(floatsOf('WHEELS_VOLUME'));
    expect(ENGINE_PITCH).toEqual(floatsOf('ENGINE_PITCH'));
    expect(ENGINE_VOLUME).toEqual(floatsOf('ENGINE_VOLUME'));
  });

  it('are the rolling stock’s fallback, the doors’ sounds and the speeds', () => {
    const fallback = /FALLBACK_WHEELS =\s*new SoundSet\.Loop\(null, "([^"]+)", null, new float\[\] \{([0-9.]+)F, ([0-9.]+)F\},\s*new float\[\] \{([0-9.]+)F, ([0-9.]+)F\}\)/.exec(trainSounds);
    expect(fallback).not.toBeNull();
    const [, main, p0, p1, v0, v1] = fallback as RegExpExecArray;
    expect(FALLBACK_WHEELS.main).toBe(main);
    expect(FALLBACK_WHEELS.pitch).toEqual([Math.fround(Number(p0)), Math.fround(Number(p1))]);
    expect(FALLBACK_WHEELS.volume).toEqual([Math.fround(Number(v0)), Math.fround(Number(v1))]);
    expect(trainSounds).toContain(`DOOR_OPEN = "${DOOR_OPEN}"`);
    expect(trainSounds).toContain(`DOOR_CLOSE = "${DOOR_CLOSE}"`);
    expect(WHEELS_FULL_KMH).toBe(doubleOf('WHEELS_FULL_KMH'));
    expect(WHEELS_FADE_KMH).toBe(doubleOf('WHEELS_FADE_KMH'));
    expect(CLACK_LEVEL).toBe(doubleOf('CLACK_LEVEL'));
    expect(CLACK_FULL_KMH).toBe(doubleOf('CLACK_FULL_KMH'));
    expect(consist).toContain(`public static final int NOTCHES = ${NOTCHES};`);
  });

  it('are worked out by the lines this port repeats', () => {
    // each line of Java the port follows; a change there fails here, and the port is looked at again
    for (const line of [
      'return range[0] + (range[1] - range[0]) * t;',
      'return signal.pitch() != null ? signal.pitch()[1] : UNCHANGED;',
      'return signal.volume() != null ? signal.volume()[1] : UNCHANGED;',
      'static final float UNCHANGED = 1.0F;',
    ]) {
      expect(LEVELS, line).toContain(line);
    }
    for (const line of [
      'float f = (float) Math.min(kmh / WHEELS_FULL_KMH, 1.2);',
      'float fade = (float) Math.min(kmh / WHEELS_FADE_KMH, 1.0);',
      'float level = SoundLevels.at(loop.volume(), WHEELS_VOLUME, Math.min(f, 1.0F));',
      '(float) (level * fade * volume), SoundLevels.at(loop.pitch(), WHEELS_PITCH, f));',
      '(float) (SoundLevels.at(loop.volume(), ENGINE_VOLUME, audio.throttle) * volume),',
      'SoundLevels.at(loop.pitch(), ENGINE_PITCH, audio.throttle));',
      'float target = alive ? handles.throttle() / (float) Consist.NOTCHES : 0.0F;',
      'float level = (float) (Math.min(CLACK_LEVEL + (1.0 - CLACK_LEVEL) * kmh / CLACK_FULL_KMH, 1.0) * volume);',
      'float pitch = (float) (0.9 + 0.25 * Math.min(kmh / 120.0, 1.0));',
      'oneShot(ref, DOOR_DISTANCE, centre, (float) volume, 1.0F);',
      'oneShot(control.move(), CONTROL_DISTANCE, at, (float) volume, 1.0F);',
      'ref = open ? DOOR_OPEN : DOOR_CLOSE;',
    ]) {
      expect(TRAIN, line).toContain(line);
    }
  });
});

describe('the levels a sound is played at', () => {
  it('run from the first number of a range at rest to the second at full', () => {
    expect(at([0.5, 1.5], ENGINE_PITCH, 0)).toBe(0.5);
    expect(at([0.5, 1.5], ENGINE_PITCH, 1)).toBe(1.5);
    expect(at([0.5, 1.5], ENGINE_PITCH, 0.25)).toBe(0.75);
    expect(at(null, ENGINE_PITCH, 1)).toBeCloseTo(1.3, 6);
    expect(at(undefined, [2, 4], 0.5)).toBe(3);
    expect(at([1, 0], ENGINE_PITCH, 0.5)).toBe(0.5); // a range backwards runs backwards
  });

  it('follow the throttle for the engine, with its default ranges when the pack gives none', () => {
    expect(engineLevels({}, 0)).toEqual({ pitch: 1, volume: Math.fround(0.6) });
    expect(engineLevels({}, 1)).toEqual({ pitch: Math.fround(1.3), volume: 1 });
    expect(engineLevels({ pitch: [0.6, 1.1], volume: [0.5, 1] }, throttleOfNotch(4))).toEqual({ pitch: Math.fround(0.85), volume: Math.fround(0.75) });
    expect(throttleOfNotch(NOTCHES)).toBe(1);
    expect(throttleOfNotch(2)).toBe(0.25);
  });

  it('follow the speed for the wheels: volume stops at 100 km/h, pitch goes on to 120, volume fades under a walking pace', () => {
    const loop = { pitch: [0.8, 1.2] as const, volume: [0.2, 0.7] as const };
    expect(wheelsLevels(loop, 0).volume).toBe(0);
    expect(wheelsLevels(loop, 3).volume).toBeCloseTo(0.5 * (0.2 + 0.5 * 0.03), 6);
    expect(wheelsLevels(loop, 6)).toEqual({ pitch: at(loop.pitch, WHEELS_PITCH, Math.fround(0.06)), volume: at(loop.volume, WHEELS_VOLUME, Math.fround(0.06)) });
    expect(wheelsLevels(loop, 100)).toEqual({ pitch: Math.fround(1.2), volume: Math.fround(0.7) });
    const beyond = wheelsLevels(loop, 120);
    expect(beyond.volume).toBe(Math.fround(0.7));
    expect(beyond.pitch).toBeCloseTo(0.8 + 0.4 * 1.2, 6);
    expect(wheelsLevels(loop, 500).pitch).toBe(beyond.pitch); // capped at 1.2 of full speed
    expect(wheelsLevels({}, 100)).toEqual({ pitch: Math.fround(1.3), volume: Math.fround(0.6) });
  });

  it('take the second number of a range for a held horn or whistle, the file as it is without one', () => {
    expect(signalPitch({ pitch: [0.5, 0.9] })).toBe(Math.fround(0.9));
    expect(signalVolume({ volume: [0.1, 0.8] })).toBe(Math.fround(0.8));
    expect(signalPitch({})).toBe(1);
    expect(signalVolume({ pitch: [0.5, 0.9] })).toBe(1);
  });

  it('rise with the speed for a rail joint', () => {
    expect(clackLevels(0)).toEqual({ volume: Math.fround(0.35), pitch: Math.fround(0.9) });
    expect(clackLevels(40).volume).toBe(1);
    expect(clackLevels(200).volume).toBe(1);
    expect(clackLevels(120).pitch).toBeCloseTo(1.15, 6);
    expect(clackLevels(20).volume).toBeCloseTo(0.675, 6);
  });

  it('are bent by the game: gain 0…1, pitch 0.5…2', () => {
    expect(gameGain(1.7)).toBe(1);
    expect(gameGain(-1)).toBe(0);
    expect(gameGain(0.5, 0.5)).toBe(0.25);
    expect(gameGain(Number.NaN)).toBe(0);
    expect(gamePitch(3)).toBe(2);
    expect(gamePitch(0.1)).toBe(0.5);
    expect(gamePitch(1.2)).toBe(1.2);
    expect(gamePitch(Number.NaN)).toBe(1);
  });
});
