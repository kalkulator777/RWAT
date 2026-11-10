import { afterEach, describe, expect, it } from 'vitest';
import { bench } from '../testing.node';
import { ToolHost } from '../registry';
import { suggestBridge, useSuggestBridge } from './bridge';
import { fakeBridge } from './testing.node';

afterEach(() => {
  useSuggestBridge(null);
});

describe('the bridge the suggestions call', () => {
  it('is the page’s, its module imported by the first call: before that it is idle and starts nothing', async () => {
    const bridge = suggestBridge();
    expect(suggestBridge()).toBe(bridge);
    expect(bridge.progress).toEqual({ stage: 'idle', loaded: 0, total: 0 });
    const heard: unknown[] = [];
    const stop = bridge.onProgress((progress) => heard.push(progress));
    // a call whose signal is aborted already ends as the bridge ends it, and starts no worker
    await expect(bridge.suggestFloor(new Uint8Array(), {}, [], { signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'BridgeError', kind: 'cancelled' });
    await expect(bridge.modelDoors(new Uint8Array(), [], { signal: AbortSignal.abort() })).rejects.toMatchObject({ kind: 'cancelled' });
    await expect(bridge.rewriteReferences(new Uint8Array(), 'mtllib', {}, { signal: AbortSignal.abort() })).rejects.toMatchObject({ kind: 'cancelled' });
    expect(bridge.progress.stage).toBe('idle');
    expect(heard).toEqual([]);
    stop();
  });

  it('is the test’s when one is given, until it is taken back', () => {
    const own = fakeBridge();
    useSuggestBridge(own);
    expect(suggestBridge()).toBe(own);
    useSuggestBridge(null);
    expect(suggestBridge()).not.toBe(own);
  });
});

describe('the open wagon’s files', () => {
  it('are read through the subject as the pack holds them now, an edit included', async () => {
    const b = await bench('rwat_example:coach', null);
    const host = new ToolHost([]);
    const stop = host.connect(b.wiring);
    const subject = host.subject.value;
    if (subject?.read === undefined) throw new Error('no subject');
    const file = 'data/rwat_example/wagon_types/coach.json';
    const before = new TextDecoder().decode(await subject.read(file));
    expect(before).toContain('"mass_t": 42');
    b.journal.dispatch({ label: 'x', ops: [{ op: 'set', file, at: '/mass_t', value: 45 }] });
    const after = host.subject.value;
    expect(new TextDecoder().decode(await after?.read?.(file))).toContain('"mass_t": 45');
    await expect(subject.read('assets/nothing.obj')).rejects.toThrow('no file assets/nothing.obj');
    stop();
  });
});
