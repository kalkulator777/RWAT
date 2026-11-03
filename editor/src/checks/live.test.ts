import { signal } from '@preact/signals';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Problem } from '../core/contracts';
import { dump } from '../core/json';
import { Journal } from '../core/journal';
import { Pack } from '../core/pack';
import { filesOf, MemorySource, readTree } from '../core/pack/testing.node';
import { createSchema, type Schema } from '../core/schema';
import { readSchemaFiles } from '../core/schema/files.node';
import { EXAMPLE_PACK } from '../testing/repo.node';
import { CHECK_DELAY_MS, liveFindings } from './live';
import { checkPack } from './pack';

const COACH = 'data/rwat_example/wagon_types/coach.json';

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
    const live = liveFindings({ pack, schema, revision }, { check });
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
