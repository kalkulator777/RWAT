import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { filesOf, MemorySource, readTree } from '../core/pack/testing.node';
import { createSchema } from '../core/schema';
import { readSchemaFiles } from '../core/schema/files.node';
import { FsAccessSource, openZipSource } from '../io';
import { FakeDirectory } from '../io/testPack.node';
import { EXAMPLE_PACK } from '../testing/repo.node';
import { installShortcuts, loadSchema, openPicked, openSource, redo, savePack, undo } from './session';
import { canRedo, canUndo, dirtyCount, failure, journal, pack, problems, revision, schema, schemaError, selection } from './store';

const COACH = 'data/rwat_example/wagon_types/coach.json';
const files = readTree(EXAMPLE_PACK);
const decoder = new TextDecoder();

function reset(): void {
  pack.value = null;
  journal.value = null;
  schema.value = null;
  schemaError.value = null;
  failure.value = null;
  selection.value = [];
  revision.value = 0;
}

beforeEach(reset);
afterEach(reset);

async function openExample(): Promise<void> {
  expect(await openSource(new MemorySource(files, 'RwatExamplePack'))).toBe(true);
}

async function edit(value: unknown = 45): Promise<void> {
  await journal.value?.run({ label: 'edit.field', ops: [{ op: 'set', file: COACH, at: '/mass_t', value }] });
}

describe('opening', () => {
  it('opens a pack into the signals and starts with nothing to undo or save', async () => {
    await openExample();
    expect(pack.value?.source.name).toBe('RwatExamplePack');
    expect(dirtyCount.value).toBe(0);
    expect(canUndo.value).toBe(false);
    expect(canRedo.value).toBe(false);
    expect(failure.value).toBeNull();
  });

  it('says why a source with no pack.mcmeta did not open and keeps the pack that was open', async () => {
    await openExample();
    const before = pack.value;
    expect(await openSource(new MemorySource(filesOf({ 'readme.txt': 'x' }), 'nothing'))).toBe(false);
    expect(failure.value?.key).toBe('app.error.not-a-pack');
    expect(pack.value).toBe(before);
  });

  it('leaves everything as it was when the dialog is cancelled and reports a dialog that fails', async () => {
    await openExample();
    const before = pack.value;
    await openPicked(() => Promise.resolve(null));
    expect(pack.value).toBe(before);
    expect(failure.value).toBeNull();
    await openPicked(() => Promise.reject(new Error('boom')));
    expect(failure.value).toEqual({ key: 'app.error.unknown', params: { detail: 'boom' } });
  });
});

describe('editing', () => {
  it('counts the changed files, undoes and redoes, and finds a broken value', async () => {
    schema.value = createSchema(readSchemaFiles());
    await openExample();
    expect(problems.value).toEqual([]);

    await edit('heavy');
    expect(dirtyCount.value).toBe(1);
    expect(canUndo.value).toBe(true);
    expect(problems.value.map((p) => p.at)).toEqual([[{ kind: 'field', file: COACH, at: '/mass_t' }]]);

    undo();
    expect(dirtyCount.value).toBe(0);
    expect(problems.value).toEqual([]);
    expect(canRedo.value).toBe(true);
    redo();
    expect(dirtyCount.value).toBe(1);
    expect(canRedo.value).toBe(false);
  });

  it('does nothing without a pack', () => {
    expect(() => {
      undo();
      redo();
    }).not.toThrow();
  });
});

describe('saving', () => {
  it('downloads a zip of the whole pack for a pack that cannot be written in place', async () => {
    await openExample();
    await edit();
    const delivered: { zip: Uint8Array; name: string }[] = [];
    await savePack((zip, name) => void delivered.push({ zip, name }));
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.name).toBe('RwatExamplePack.zip');
    const saved = await openZipSource(delivered[0]?.zip as Uint8Array, 'saved.zip');
    expect((await saved.list()).map((e) => e.path)).toEqual([...files.keys()].sort());
    expect(decoder.decode(await saved.read(COACH)).split('\n')[3]).toBe('  "mass_t": 45.0,');
    expect(dirtyCount.value).toBe(0);
    expect(failure.value).toBeNull();
  });

  it('writes only the changed file back into a folder opened for writing', async () => {
    const folder = new FakeDirectory('RwatExamplePack');
    const source = new FsAccessSource(folder, true);
    await source.sink().write([...files].map(([path, bytes]) => ({ path, bytes })));
    await openSource(source);
    await edit();
    const delivered: unknown[] = [];
    await savePack(() => void delivered.push(1));
    expect(delivered).toEqual([]);
    const after = new Map((await source.list()).map((e) => [e.path, e.size]));
    expect(after.size).toBe(files.size);
    const text = decoder.decode(await source.read(COACH));
    expect(text.split('\n')[3]).toBe('  "mass_t": 45.0,');
    for (const [path, bytes] of files) {
      if (path !== COACH) expect(Buffer.from(await source.read(path)).equals(Buffer.from(bytes)), path).toBe(true);
    }
    expect(dirtyCount.value).toBe(0);
  });

  it('does nothing without a pack', async () => {
    await savePack(() => {
      throw new Error('nothing to deliver');
    });
    expect(failure.value).toBeNull();
  });
});

describe('loading the schema', () => {
  it('builds the checks from the files the site serves and says when it cannot', async () => {
    const served = readSchemaFiles();
    const calls: string[] = [];
    const fetchFile = (url: string) => {
      calls.push(url);
      const name = url.slice(url.lastIndexOf('/') + 1);
      return Promise.resolve({ ok: name in served, status: name in served ? 200 : 404, json: () => Promise.resolve(served[name]) });
    };
    // loadSchema uses the page's fetch: stand in for it for this call
    const real = globalThis.fetch;
    globalThis.fetch = ((url: string) => fetchFile(url)) as unknown as typeof fetch;
    try {
      await loadSchema('http://site.test/schema/');
      expect(schema.value).not.toBeNull();
      expect(schemaError.value).toBeNull();
      expect(calls[0]).toBe('http://site.test/schema/pack-layout.json');

      schema.value = null;
      globalThis.fetch = (() => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) })) as unknown as typeof fetch;
      await loadSchema('http://site.test/schema/');
      expect(schema.value).toBeNull();
      expect(schemaError.value).toContain('HTTP 404');
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe('keyboard', () => {
  function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = document): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  }

  it('undoes with Ctrl+Z and redoes with Ctrl+Shift+Z or Ctrl+Y', async () => {
    const remove = installShortcuts();
    try {
      await openExample();
      await edit();
      expect(press('z').defaultPrevented).toBe(true);
      expect(dirtyCount.value).toBe(0);
      press('Z', { shiftKey: true });
      expect(dirtyCount.value).toBe(1);
      press('z');
      press('y');
      expect(dirtyCount.value).toBe(1);
      expect(press('q').defaultPrevented).toBe(false);
    } finally {
      remove();
    }
  });

  it('leaves the keys to a text field and stops after it is removed', async () => {
    const remove = installShortcuts();
    await openExample();
    await edit();
    const input = document.createElement('input');
    document.body.append(input);
    expect(press('z', {}, input).defaultPrevented).toBe(false);
    expect(dirtyCount.value).toBe(1);
    input.remove();
    remove();
    press('z');
    expect(dirtyCount.value).toBe(1);
  });
});
