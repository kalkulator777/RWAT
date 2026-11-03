import { signal } from '@preact/signals';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Problem } from '../core/contracts';
import { dump } from '../core/json';
import { Journal } from '../core/journal';
import { Pack, putJson } from '../core/pack';
import { filesOf, MemorySource, readTree } from '../core/pack/testing.node';
import { createSchema, type Schema } from '../core/schema';
import { readSchemaFiles } from '../core/schema/files.node';
import { EXAMPLE_PACK } from '../testing/repo.node';
import { CHECK_DELAY_MS, liveFindings } from './live';
import { checkPack } from './pack';

const COACH = 'data/rwat_example/wagon_types/coach.json';

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

/** Where each floor finding points first: the door's field. */
function places(problems: readonly Problem[]): unknown[] {
  return problems.filter((p) => p.source === 'floor').map((p) => p.at[0]);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the findings the panels show', () => {
  it('are checked at once for a new pack or schema, and once a moment after the last of a run of edits', async () => {
    const pack = signal<Pack | null>(null);
    const schema = signal<Schema | null>(null);
    const revision = signal(0);
    const check = vi.fn((open: Pack, loaded: Schema | null): Problem[] => checkPack(open, loaded));
    const live = liveFindings({ pack, schema, revision }, { check, sliceMs: Infinity });
    expect(live.value).toEqual([]);
    expect(check).not.toHaveBeenCalled();

    const opened = await Pack.open(new MemorySource(readTree(EXAMPLE_PACK)));
    pack.value = opened;
    expect(check).toHaveBeenCalledTimes(1);
    schema.value = createSchema(readSchemaFiles());
    expect(check).toHaveBeenCalledTimes(2);
    expect(live.value).toEqual([]);

    const journal = new Journal(opened);
    for (const value of ['h', 'he', 'heavy']) {
      journal.dispatch({ label: 'x', ops: [{ op: 'set', file: COACH, at: '/mass_t', value }] });
      revision.value++;
      vi.advanceTimersByTime(CHECK_DELAY_MS - 1);
    }
    expect(check).toHaveBeenCalledTimes(2);
    expect(live.value).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(check).toHaveBeenCalledTimes(3);
    expect(live.value.map((p) => p.code)).toEqual(['schema.type']);

    pack.value = null;
    expect(live.value).toEqual([]);
    live.dispose();
    revision.value++;
    vi.runAllTimers();
    expect(check).toHaveBeenCalledTimes(3);
  });
});

describe('the floor check among the findings', () => {
  it('is a part of the pack check, each finding pointing at its door', async () => {
    const pack = await packOf({ a: car(true), b: car(false) });
    const found = checkPack(pack, null);
    expect(found.filter((p) => p.source === 'floor').map((p) => p.code)).toEqual(['floor.door-not-at-floor-end']);
    expect(places(found)).toEqual([{ kind: 'field', file: 'data/ns/wagon_types/a.json', at: '/doors/0' }]);
  });

  it('is checked at once when a pack opens, and again a moment after the last of a run of edits', async () => {
    const opened = await packOf({ a: car(true), b: car(false) });
    const pack = signal<Pack | null>(null);
    const schema = signal<Schema | null>(null);
    const revision = signal(0);
    const live = liveFindings({ pack, schema, revision }, { delayMs: 150, sliceMs: Infinity });
    pack.value = opened;
    expect(places(live.value)).toEqual([{ kind: 'field', file: 'data/ns/wagon_types/a.json', at: '/doors/0' }]);

    opened.apply(putJson('data/ns/wagon_types/b.json', car(true)));
    revision.value++;
    vi.advanceTimersByTime(100);
    opened.apply(putJson('data/ns/wagon_types/a.json', car(false)));
    revision.value++;
    vi.advanceTimersByTime(100);
    expect(places(live.value)).toHaveLength(1); // not yet: the run of edits goes on
    vi.advanceTimersByTime(60);
    await vi.runAllTimersAsync();
    expect(places(live.value)).toEqual([{ kind: 'field', file: 'data/ns/wagon_types/b.json', at: '/doors/0' }]);
    live.dispose();
  });

  it('goes type by type, giving the page back once a slice is spent; a pass a newer one overtakes gives up', async () => {
    vi.useRealTimers();
    const first = await packOf({ a: car(true), b: car(true), c: car(true) });
    const second = await packOf({ d: car(true) });
    const pack = signal<Pack | null>(null);
    const schema = signal<Schema | null>(null);
    const revision = signal(0);
    const yields: (() => void)[] = [];
    const check = vi.fn((open: Pack, loaded: Schema | null): Problem[] => checkPack(open, loaded));
    const live = liveFindings({ pack, schema, revision }, { check, sliceMs: 0, yieldToPage: () => new Promise<void>((resolve) => yields.push(resolve)) });
    pack.value = first;
    expect(yields).toHaveLength(1); // one type checked, then the page's turn
    expect(live.value).toEqual([]);
    yields.shift()!();
    await Promise.resolve();
    await Promise.resolve();
    expect(yields).toHaveLength(1);
    expect(check).not.toHaveBeenCalled();
    pack.value = second; // overtakes: one type, no slice spent before it
    expect(places(live.value)).toEqual([{ kind: 'field', file: 'data/ns/wagon_types/d.json', at: '/doors/0' }]);
    yields.shift()!(); // the first pass wakes up and gives up
    await Promise.resolve();
    await Promise.resolve();
    expect(yields).toEqual([]);
    expect(check).toHaveBeenCalledTimes(1);
    expect(places(live.value)).toEqual([{ kind: 'field', file: 'data/ns/wagon_types/d.json', at: '/doors/0' }]);
    live.dispose();
  });
});

describe('the schema findings of a pack', () => {
  it('check again only the files whose value changed', async () => {
    const schema = createSchema(readSchemaFiles());
    const spy = vi.spyOn(schema.checker, 'problems');
    const pack = await Pack.open(
      new MemorySource(
        filesOf({
          'pack.mcmeta': dump({ pack: { pack_format: 34, description: 'x' }, rwat: { format: 1 } }),
          'data/ns/wagon_types/a.json': dump({ length: 10, bogies: [2, -2], mass_t: 1 }),
          'data/ns/wagon_types/b.json': dump({ length: 10, bogies: [2, -2], mass_t: 1 }),
        }),
      ),
    );
    checkPack(pack, schema);
    expect(spy).toHaveBeenCalledTimes(3);
    new Journal(pack).dispatch({ label: 'x', ops: [{ op: 'set', file: 'data/ns/wagon_types/a.json', at: '/mass_t', value: 'x' }] });
    const found = checkPack(pack, schema);
    expect(spy).toHaveBeenCalledTimes(4);
    expect(spy.mock.calls[3]?.[1]).toBe('data/ns/wagon_types/a.json');
    expect(found.map((p) => p.code)).toContain('schema.type');
  });
});
