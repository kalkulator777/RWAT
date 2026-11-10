/**
 * Listening to a pack's sounds in the editor (docs/proposals/editor.md §2.4 item 4):
 * WebAudio, one {@link AudioContext} for the page, made when the user first asks for a
 * sound (a click is the gesture browsers want) and kept after. A file is decoded by
 * `decodeAudioData` once per file and bytes; a sound is played as the game plays it —
 * volume as gain (limited to 0…1, ./levels.ts `gameGain`), pitch as the playback rate
 * (limited to 0.5…2, `gamePitch`).
 *
 * A loop is played as `client/sound/LoopPlayer.java` does: the lead-in (`start`) once,
 * then `main` looping while it is on, then the tail (`stop`) once. A signal given as one
 * file (most horns) is not looped by the engine but played whole again and again while
 * the key is held, and a short blast sounds out after the release; here the source loops
 * (the same sound, without the engine's one-tick gap) and a release lets a blast of at
 * most {@link SOUND_OUT_SECONDS} play to its end. One loop at a time; a sound that is
 * played once does not stop it.
 *
 * The context is reached through {@link AudioContextLike}, so tests drive a stand-in.
 * The page stops everything when the pack closes or another wagon opens
 * (panels/sounds `SoundsPanel`).
 */

import { signal, type ReadonlySignal } from '@preact/signals';
import { gameGain, gamePitch, type Levels } from './levels';

/** A released single-file signal no longer than this plays out (`LoopPlayer.SOUND_OUT_TICKS`, 80 ticks). */
export const SOUND_OUT_SECONDS = 4;

/** The part of WebAudio's `AudioBuffer` that is used. */
export interface BufferLike {
  readonly duration: number;
}

/** The part of a buffer source that is used. */
export interface SourceLike {
  buffer: BufferLike | null;
  loop: boolean;
  readonly playbackRate: { value: number };
  onended: (() => void) | null;
  connect(destination: unknown): unknown;
  start(): void;
  stop(): void;
  disconnect(): void;
}

/** The part of a gain node that is used. */
export interface GainLike {
  readonly gain: { value: number };
  connect(destination: unknown): unknown;
  disconnect(): void;
}

/** The part of `AudioContext` that is used. */
export interface AudioContextLike {
  readonly state: string;
  readonly destination: unknown;
  resume(): Promise<void>;
  close(): Promise<void>;
  decodeAudioData(data: ArrayBuffer): Promise<BufferLike>;
  createBufferSource(): SourceLike;
  createGain(): GainLike;
}

/** Makes the page's audio context. */
export type ContextFactory = () => AudioContextLike;

const browserContext: ContextFactory = () => new AudioContext() as unknown as AudioContextLike;

/** The files of a loop (bytes of Ogg files); `start` and `stop` are optional, as in the declaration. */
export interface LoopFiles {
  start?: Uint8Array;
  main: Uint8Array;
  stop?: Uint8Array;
}

/** Why a sound could not be played. */
export class AuditionError extends Error {
  constructor(
    readonly code: 'unsupported' | 'decode',
    message: string,
  ) {
    super(message);
    this.name = 'AuditionError';
  }
}

interface Running {
  id: string;
  gain: GainLike;
  /** The sources that make a sound now (the lead-in or the loop; the tail plays by itself). */
  sources: Set<SourceLike>;
  files: LoopFiles;
  main: BufferLike;
  stop: BufferLike | null;
  /** The loop's main buffer is repeated by the source itself (a loop; a single-file signal). */
  signal: boolean;
  levels: Levels;
  /** False once the loop was released. */
  on: boolean;
  /** The source of the loop proper, once it started. */
  mainSource: SourceLike | null;
}

export class Audition {
  private context: AudioContextLike | null = null;
  private readonly decoded = new Map<string, { bytes: Uint8Array; buffer: BufferLike }>();
  private running: Running | null = null;
  /** Grows with every stop: a sound that was asked for before it, and decoded after, is not started. */
  private generation = 0;
  private readonly once = new Set<{ source: SourceLike; gain: GainLike }>();
  private readonly currentId = signal<string | null>(null);

  constructor(private readonly makeContext: ContextFactory = browserContext) {}

  /** The id of the loop that plays now (as it was started), or null. */
  get current(): ReadonlySignal<string | null> {
    return this.currentId;
  }

  /** The page's audio context; made on the first call, which has to come from a user's gesture. */
  private async ready(): Promise<AudioContextLike> {
    if (this.context === null) {
      if (typeof AudioContext === 'undefined' && this.makeContext === browserContext) {
        throw new AuditionError('unsupported', 'this browser has no WebAudio');
      }
      this.context = this.makeContext();
    }
    if (this.context.state === 'suspended') await this.context.resume();
    return this.context;
  }

  /** Decodes a file (kept while its bytes are the same). */
  private async decode(context: AudioContextLike, key: string, bytes: Uint8Array): Promise<BufferLike> {
    const known = this.decoded.get(key);
    if (known?.bytes === bytes) return known.buffer;
    let buffer: BufferLike;
    try {
      buffer = await context.decodeAudioData(bytes.slice().buffer);
    } catch (error) {
      throw new AuditionError('decode', error instanceof Error ? error.message : String(error));
    }
    this.decoded.set(key, { bytes, buffer });
    return buffer;
  }

  private start(context: AudioContextLike, gain: GainLike, buffer: BufferLike, levels: Levels, loop: boolean): SourceLike {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    source.playbackRate.value = gamePitch(levels.pitch);
    source.connect(gain);
    source.start();
    return source;
  }

  private track(source: SourceLike, gain: GainLike): void {
    const handle = { source, gain };
    this.once.add(handle);
    source.onended = () => {
      this.once.delete(handle);
      source.disconnect();
      gain.disconnect();
    };
  }

  private playOnceVia(context: AudioContextLike, buffer: BufferLike, levels: Levels): void {
    const gain = context.createGain();
    gain.gain.value = gameGain(levels.volume);
    gain.connect(context.destination);
    this.track(this.start(context, gain, buffer, levels, false), gain);
  }

  /** Plays a file once, as the game plays a one-shot sound. `key` names the file for the decoded copy kept. */
  async playOnce(key: string, bytes: Uint8Array, levels: Levels): Promise<void> {
    const context = await this.ready();
    this.playOnceVia(context, await this.decode(context, key, bytes), levels);
  }

  /**
   * Starts a loop (a running one stops first). `files` are the declared Ogg files by key
   * (`keys` name each for the decoded copies); a lead-in plays before the loop. A signal
   * (horn, whistle) played from one file repeats it whole while on. A stop or a new sound
   * asked for while the files decode wins: the loop is then not started.
   */
  async playLoop(id: string, keys: { start?: string; main: string; stop?: string }, files: LoopFiles, levels: Levels, signalLoop: boolean): Promise<void> {
    this.stopAll();
    const ticket = this.generation;
    const context = await this.ready();
    const main = await this.decode(context, keys.main, files.main);
    const lead = files.start && keys.start ? await this.decode(context, keys.start, files.start) : null;
    const tail = files.stop && keys.stop ? await this.decode(context, keys.stop, files.stop) : null;
    if (ticket !== this.generation) return;
    const gain = context.createGain();
    gain.gain.value = gameGain(levels.volume);
    gain.connect(context.destination);
    const run: Running = { id, gain, sources: new Set(), files, main, stop: tail, signal: signalLoop, levels, on: true, mainSource: null };
    this.running = run;
    this.currentId.value = id;
    const startMain = (): void => {
      if (!run.on) return;
      const source = this.start(context, gain, main, run.levels, true);
      run.mainSource = source;
      run.sources.add(source);
    };
    if (lead === null) {
      startMain();
      return;
    }
    const first = this.start(context, gain, lead, levels, false);
    run.sources.add(first);
    first.onended = () => {
      run.sources.delete(first);
      startMain();
    };
  }

  /** Moves the running loop to new levels (a slider moved). */
  setLevels(levels: Levels): void {
    const run = this.running;
    if (run === null) return;
    run.levels = levels;
    run.gain.gain.value = gameGain(levels.volume);
    for (const source of run.sources) source.playbackRate.value = gamePitch(levels.pitch);
  }

  /**
   * Releases the running loop: its tail plays once; a single-file signal that is short
   * (no lead-in, no tail, at most {@link SOUND_OUT_SECONDS}) plays to its end first.
   */
  release(): void {
    const run = this.running;
    this.generation++;
    if (run === null) return;
    run.on = false;
    this.running = null;
    this.currentId.value = null;
    const soundsOut = run.signal && run.mainSource !== null && run.files.start === undefined && run.files.stop === undefined && run.main.duration <= SOUND_OUT_SECONDS;
    for (const source of run.sources) {
      source.onended = null;
      if (soundsOut && source === run.mainSource) {
        source.loop = false;
        this.track(source, run.gain);
      } else {
        source.stop();
        source.disconnect();
      }
    }
    if (!soundsOut) run.gain.disconnect();
    if (run.stop !== null && this.context !== null) this.playOnceVia(this.context, run.stop, run.levels);
  }

  /** Stops every sound at once (no tails): the pack closes, another wagon opens. */
  stopAll(): void {
    this.generation++;
    const run = this.running;
    if (run !== null) {
      run.on = false;
      for (const source of run.sources) {
        source.onended = null;
        source.stop();
        source.disconnect();
      }
      run.gain.disconnect();
      this.running = null;
    }
    for (const { source, gain } of this.once) {
      source.onended = null;
      source.stop();
      source.disconnect();
      gain.disconnect();
    }
    this.once.clear();
    this.currentId.value = null;
  }

  /** Stops everything and gives the audio context back (the page closes; tests). */
  async close(): Promise<void> {
    this.stopAll();
    const context = this.context;
    this.context = null;
    this.decoded.clear();
    if (context !== null && context.state !== 'closed') await context.close();
  }
}

/** The page's one audition. */
export const audition = new Audition();
