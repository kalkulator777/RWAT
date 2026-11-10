import { describe, expect, it } from 'vitest';
import { Audition, AuditionError, SOUND_OUT_SECONDS, type AudioContextLike, type BufferLike, type GainLike, type SourceLike } from './audition';

/** A stand-in for the browser's audio: records what is made, started, stopped and set. */
class FakeSource implements SourceLike {
  buffer: BufferLike | null = null;
  loop = false;
  readonly playbackRate = { value: 1 };
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  disconnected = false;
  connect(): void {}
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
  disconnect(): void {
    this.disconnected = true;
  }
  /** The sound plays out. */
  end(): void {
    this.onended?.();
  }
}

class FakeGain implements GainLike {
  readonly gain = { value: 1 };
  disconnected = false;
  connect(): void {}
  disconnect(): void {
    this.disconnected = true;
  }
}

class FakeContext implements AudioContextLike {
  state = 'suspended';
  readonly destination = {};
  readonly sources: FakeSource[] = [];
  readonly gains: FakeGain[] = [];
  decodes = 0;
  /** Seconds a decoded file plays, by its first byte. */
  constructor(private readonly failOn = -1) {}
  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }
  decodeAudioData(data: ArrayBuffer): Promise<BufferLike> {
    this.decodes++;
    const first = new Uint8Array(data)[0] ?? 0;
    return first === this.failOn ? Promise.reject(new Error('EncodingError')) : Promise.resolve({ duration: first });
  }
  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
}

/** A file whose decoded length is `seconds` (the stand-in reads it from the first byte). */
const file = (seconds: number): Uint8Array => new Uint8Array([seconds, 0, 0]);

function audition(failOn?: number): { audition: Audition; context: FakeContext; made: () => number } {
  const context = new FakeContext(failOn);
  let made = 0;
  return {
    audition: new Audition(() => {
      made++;
      return context;
    }),
    context,
    made: () => made,
  };
}

describe('listening to a file', () => {
  it('plays it once at the game’s gain and pitch, resuming the context a gesture made', async () => {
    const { audition: a, context } = audition();
    await a.playOnce('a.ogg', file(2), { volume: 1.7, pitch: 3 });
    expect(context.state).toBe('running');
    const [source] = context.sources;
    expect(source).toMatchObject({ started: true, loop: false, playbackRate: { value: 2 } });
    expect(context.gains[0]?.gain.value).toBe(1);
    source?.end();
    expect(source?.disconnected).toBe(true);
    expect(context.gains[0]?.disconnected).toBe(true);
  });

  it('makes one audio context for the page and decodes a file once while its bytes are the same', async () => {
    const { audition: a, context, made } = audition();
    const bytes = file(1);
    await a.playOnce('a.ogg', bytes, { volume: 1, pitch: 1 });
    await a.playOnce('a.ogg', bytes, { volume: 1, pitch: 1 });
    expect(made()).toBe(1);
    expect(context.decodes).toBe(1);
    await a.playOnce('a.ogg', file(1), { volume: 1, pitch: 1 }); // the file was replaced
    expect(context.decodes).toBe(2);
  });

  it('says why a file does not play', async () => {
    const { audition: a, context } = audition(9);
    await expect(a.playOnce('bad.ogg', file(9), { volume: 1, pitch: 1 })).rejects.toMatchObject({ code: 'decode', message: 'EncodingError' });
    await expect(a.playOnce('bad.ogg', file(9), { volume: 1, pitch: 1 })).rejects.toBeInstanceOf(AuditionError);
    expect(context.sources).toHaveLength(0);
  });
});

describe('listening to a loop', () => {
  const keys = { main: 'main.ogg' };

  it('loops the file, follows the sliders, and stops when released', async () => {
    const { audition: a, context } = audition();
    await a.playLoop('idle', keys, { main: file(5) }, { volume: 0.6, pitch: 1 }, false);
    expect(a.current.value).toBe('idle');
    const [source] = context.sources;
    expect(source).toMatchObject({ started: true, loop: true });
    a.setLevels({ volume: 1, pitch: 1.3 });
    expect(context.gains[0]?.gain.value).toBe(1);
    expect(source?.playbackRate.value).toBeCloseTo(1.3);
    a.release();
    expect(source?.stopped).toBe(true);
    expect(a.current.value).toBeNull();
    expect(context.sources).toHaveLength(1); // no tail
  });

  it('plays the lead-in once, then the loop, and the tail on release', async () => {
    const { audition: a, context } = audition();
    await a.playLoop('idle', { start: 's.ogg', main: 'm.ogg', stop: 't.ogg' }, { start: file(1), main: file(5), stop: file(2) }, { volume: 1, pitch: 1 }, false);
    expect(context.sources.map((s) => s.loop)).toEqual([false]);
    context.sources[0]?.end(); // the lead-in is through: the loop takes over
    expect(context.sources.map((s) => s.loop)).toEqual([false, true]);
    a.release();
    expect(context.sources[1]?.stopped).toBe(true);
    expect(context.sources).toHaveLength(3);
    expect(context.sources[2]).toMatchObject({ started: true, loop: false });
  });

  it('plays the tail when released during the lead-in, and the loop then never starts', async () => {
    const { audition: a, context } = audition();
    await a.playLoop('idle', { start: 's.ogg', main: 'm.ogg', stop: 't.ogg' }, { start: file(3), main: file(5), stop: file(2) }, { volume: 1, pitch: 1 }, false);
    a.release();
    context.sources[0]?.end();
    expect(context.sources[0]?.stopped).toBe(true);
    expect(context.sources.map((s) => s.loop)).toEqual([false, false]);
  });

  it('lets a short single-file signal sound out when released, and cuts a long one', async () => {
    const short = audition();
    await short.audition.playLoop('horn', keys, { main: file(SOUND_OUT_SECONDS) }, { volume: 1, pitch: 1 }, true);
    short.audition.release();
    const [blast] = short.context.sources;
    expect(blast).toMatchObject({ stopped: false, loop: false });
    expect(short.context.gains[0]?.disconnected).toBe(false);
    short.audition.stopAll(); // the page closes it anyway
    expect(blast?.stopped).toBe(true);

    const long = audition();
    await long.audition.playLoop('horn', keys, { main: file(SOUND_OUT_SECONDS + 1) }, { volume: 1, pitch: 1 }, true);
    long.audition.release();
    expect(long.context.sources[0]?.stopped).toBe(true);
  });

  it('does not let a signal with a lead-in or a tail sound out: it is a loop', async () => {
    const { audition: a, context } = audition();
    await a.playLoop('horn', { main: 'm.ogg', stop: 't.ogg' }, { main: file(1), stop: file(1) }, { volume: 1, pitch: 1 }, true);
    a.release();
    expect(context.sources[0]?.stopped).toBe(true);
  });

  it('starts only the last of two loops asked for, and none that was stopped while it decoded', async () => {
    const { audition: a, context } = audition();
    const first = a.playLoop('idle', keys, { main: file(5) }, { volume: 1, pitch: 1 }, false);
    const second = a.playLoop('wheels', keys, { main: file(5) }, { volume: 1, pitch: 1 }, false);
    await Promise.all([first, second]);
    expect(a.current.value).toBe('wheels');
    expect(context.sources.filter((s) => s.started && !s.stopped)).toHaveLength(1);

    a.stopAll();
    const pending = a.playLoop('idle', keys, { main: file(5) }, { volume: 1, pitch: 1 }, false);
    a.stopAll(); // the pack closes while the file decodes
    await pending;
    expect(a.current.value).toBeNull();
    expect(context.sources.filter((s) => s.started && !s.stopped)).toHaveLength(0);
  });

  it('stops everything at once, and gives the context back', async () => {
    const { audition: a, context } = audition();
    await a.playOnce('a.ogg', file(1), { volume: 1, pitch: 1 });
    await a.playLoop('idle', keys, { main: file(5) }, { volume: 1, pitch: 1 }, false);
    a.stopAll();
    expect(context.sources.every((s) => s.stopped)).toBe(true);
    expect(a.current.value).toBeNull();
    await a.close();
    expect(context.state).toBe('closed');
  });

  it('releases nothing and moves nothing when no loop plays', () => {
    const { audition: a, made } = audition();
    a.release();
    a.setLevels({ volume: 1, pitch: 1 });
    a.stopAll();
    expect(made()).toBe(0);
  });
});
