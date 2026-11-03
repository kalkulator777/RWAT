import { signal } from '@preact/signals';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dump } from '../../core/json';
import { Pack, putJson } from '../../core/pack';
import { MemorySource, filesOf } from '../../core/pack/testing.node';
import { liveFloorFindings } from './live';

afterEach(() => {
  vi.useRealTimers();
});

/** A type whose only door is half a block off its side wall (`floor.door-not-at-floor-end`), or not. */
function car(off: boolean): unknown {
  const z = off ? 1.9 : 1.4;
  return {
    length: 20.0,
    bogies: [7.0, -7.0],
    mass_t: 40.0,
    interior: [{ min: [-9.0, 1.2, -1.4], max: [9.0, 3.5, 1.4] }],
    doors: [{ id: 'side', min: [-0.5, 1.2, z], max: [0.5, 3.3, z + 0.06] }],
  };
}

async function packOf(types: Record<string, unknown>): Promise<Pack> {
  const files: Record<string, string> = { 'pack.mcmeta': dump({ pack: { pack_format: 34, description: 'x' }, rwat: { format: 1 } }) };
  for (const [name, type] of Object.entries(types)) files[`data/ns/wagon_types/${name}.json`] = dump(type);
  return Pack.open(new MemorySource(filesOf(files)));
}

describe('the floor check kept up to date', () => {
  it('checks a pack at once when it opens, and again a moment after the last of a run of edits', async () => {
    vi.useFakeTimers();
    const opened = await packOf({ a: car(true), b: car(false) });
    const pack = signal<Pack | null>(null);
    const revision = signal(0);
    const live = liveFloorFindings({ pack, revision }, { delayMs: 150, sliceMs: Infinity });
    expect(live.value).toEqual([]);
    pack.value = opened;
    expect(live.value.map((p) => p.at[0])).toEqual([{ kind: 'field', file: 'data/ns/wagon_types/a.json', at: '/doors/0' }]);

    opened.apply(putJson('data/ns/wagon_types/b.json', car(true)));
    revision.value++;
    vi.advanceTimersByTime(100);
    opened.apply(putJson('data/ns/wagon_types/a.json', car(false)));
    revision.value++;
    vi.advanceTimersByTime(100);
    expect(live.value).toHaveLength(1); // not yet: the run of edits goes on
    vi.advanceTimersByTime(60);
    await vi.runAllTimersAsync();
    expect(live.value.map((p) => p.at[0])).toEqual([{ kind: 'field', file: 'data/ns/wagon_types/b.json', at: '/doors/0' }]);

    pack.value = null;
    expect(live.value).toEqual([]);
    live.dispose();
  });

  it('gives the page back between types once a slice is spent, and a pass a newer one overtakes gives up', async () => {
    const first = await packOf({ a: car(true), b: car(true), c: car(true) });
    const second = await packOf({ d: car(true) });
    const pack = signal<Pack | null>(null);
    const revision = signal(0);
    const yields: (() => void)[] = [];
    const live = liveFloorFindings(
      { pack, revision },
      { sliceMs: 0, yieldToPage: () => new Promise<void>((resolve) => yields.push(resolve)) },
    );
    pack.value = first;
    expect(yields).toHaveLength(1); // one type checked, then the page's turn
    expect(live.value).toEqual([]);
    yields.shift()!();
    await Promise.resolve();
    await Promise.resolve();
    expect(yields).toHaveLength(1);
    pack.value = second; // overtakes: one type, no slice spent before it
    expect(live.value.map((p) => p.at[0])).toEqual([{ kind: 'field', file: 'data/ns/wagon_types/d.json', at: '/doors/0' }]);
    yields.shift()!(); // the first pass wakes up and gives up
    await Promise.resolve();
    await Promise.resolve();
    expect(yields).toEqual([]);
    expect(live.value.map((p) => p.at[0])).toEqual([{ kind: 'field', file: 'data/ns/wagon_types/d.json', at: '/doors/0' }]);
    live.dispose();
  });
});
