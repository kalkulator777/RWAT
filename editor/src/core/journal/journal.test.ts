import { describe, expect, it } from 'vitest';
import type { Command, Op } from '../contracts';
import { Pack, putJson } from '../pack/pack';
import { MemorySource, filesOf } from '../pack/testing.node';
import { Journal, type OpTarget } from './journal';
import { JournalFormatError, fromBase64, parseJournal, serializeJournal, toBase64 } from './serialize';

const TYPE = 'data/ns/wagon_types/coach.json';
const FILES = {
  'pack.mcmeta': '{\n  "pack": {"pack_format": 34},\n  "rwat": {"format": 1}\n}\n',
  [TYPE]: '{\n  "length": 20.0,\n  "bogies": [7.0, -7.0],\n  "doors": [\n    {"id": "a"},\n    {"id": "b"}\n  ]\n}\n',
  'assets/ns/stock/body.png': new Uint8Array([137, 80, 78, 71, 0, 255]),
};

async function open(): Promise<Pack> {
  return Pack.open(new MemorySource(filesOf(FILES)));
}

/** Every file of the pack as saving would write it now. */
async function state(pack: Pack): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const change of await pack.snapshot()) files[change.path] = toBase64((change as { bytes: Uint8Array }).bytes);
  return files;
}

const command = (label: string, ...ops: Op[]): Command => ({ label, ops });

describe('the journal', () => {
  const kinds: [string, Op[]][] = [
    ['set a member', [{ op: 'set', file: TYPE, at: '/length', value: 21 }]],
    ['add a member', [{ op: 'set', file: TYPE, at: '/mass_t', value: 42 }]],
    ['set an element', [{ op: 'set', file: TYPE, at: '/bogies/1', value: -8 }]],
    ['set the whole value', [{ op: 'set', file: TYPE, at: '', value: { length: 1 } }]],
    ['remove a member', [{ op: 'remove', file: TYPE, at: '/bogies' }]],
    ['remove an element', [{ op: 'remove', file: TYPE, at: '/doors/0' }]],
    ['insert an element', [{ op: 'insert', file: TYPE, at: '/doors/1', value: { id: 'c' } }]],
    ['insert at the end', [{ op: 'insert', file: TYPE, at: '/doors/-', value: { id: 'z' } }]],
    ['put a new file', [putJson('data/ns/wagon_types/flat.json', { length: 12 })]],
    ['put over an edited JSON file', [{ op: 'set', file: TYPE, at: '/length', value: 5 }, putJson(TYPE, { length: 1 })]],
    ['put over a binary file not read yet', [{ op: 'putFile', file: 'assets/ns/stock/body.png', bytes: new Uint8Array([1]) }]],
    ['delete an edited JSON file', [{ op: 'set', file: TYPE, at: '/length', value: 5 }, { op: 'deleteFile', file: TYPE }]],
    ['delete a binary file not read yet', [{ op: 'deleteFile', file: 'assets/ns/stock/body.png' }]],
    ['rename a file', [{ op: 'renameFile', file: 'assets/ns/stock/body.png', to: 'assets/ns/stock/coach.png' }]],
  ];

  it.each(kinds)('undoes and redoes: %s', async (_name, ops) => {
    const pack = await open();
    const journal = new Journal(pack);
    const before = await state(pack);
    await journal.run(command('edit', ...ops));
    const after = await state(pack);
    expect(after).not.toEqual(before);
    expect(journal.undo()).toMatchObject({ label: 'edit' });
    expect(await state(pack)).toEqual(before);
    expect(pack.dirtyPaths()).toEqual([]);
    expect(journal.canUndo).toBe(false);
    expect(journal.redo()).toMatchObject({ label: 'edit' });
    expect(await state(pack)).toEqual(after);
    expect(journal.canRedo).toBe(false);
  });

  it('applies a command whole or not at all', async () => {
    const pack = await open();
    const journal = new Journal(pack);
    const before = await state(pack);
    expect(() =>
      journal.dispatch(command('broken', { op: 'set', file: TYPE, at: '/length', value: 1 }, { op: 'remove', file: TYPE, at: '/doors/0' }, { op: 'remove', file: TYPE, at: '/nothing' })),
    ).toThrow(/no such member/);
    expect(await state(pack)).toEqual(before);
    expect(journal.canUndo).toBe(false);
    journal.dispatch(command('nothing'));
    expect(journal.canUndo).toBe(false);
  });

  it('merges a drag into one entry of one op per place, and undoes it at once', async () => {
    const pack = await open();
    const journal = new Journal(pack);
    const before = await state(pack);
    for (let i = 1; i <= 50; i++) {
      journal.dispatch({ label: 'drag', coalesceKey: 'door-0', ops: [{ op: 'set', file: TYPE, at: '/doors/0/min', value: [i, 0, 0] }, { op: 'set', file: TYPE, at: '/length', value: 20 + i }] });
    }
    const { done } = journal.state();
    expect(done.length).toBe(1);
    expect(done[0]?.ops).toEqual([
      { op: 'set', file: TYPE, at: '/doors/0/min', value: [50, 0, 0] },
      { op: 'set', file: TYPE, at: '/length', value: 70 },
    ]);
    const dragged = await state(pack);
    journal.undo();
    expect(await state(pack)).toEqual(before);
    journal.redo();
    expect(await state(pack)).toEqual(dragged);
  });

  it('keeps the ops of a drag that touch a place inside one it set, and undoes them right', async () => {
    const pack = await open();
    const journal = new Journal(pack);
    const before = await state(pack);
    journal.dispatch({ label: 'drag', coalesceKey: 'k', ops: [{ op: 'set', file: TYPE, at: '/doors/0', value: { id: 'a', min: [0, 0, 0] } }] });
    journal.dispatch({ label: 'drag', coalesceKey: 'k', ops: [{ op: 'set', file: TYPE, at: '/doors/0/min', value: [1, 1, 1] }] });
    journal.dispatch({ label: 'drag', coalesceKey: 'k', ops: [{ op: 'set', file: TYPE, at: '/doors/0', value: { id: 'a', min: [2, 2, 2] } }, { op: 'remove', file: TYPE, at: '/doors/1' }] });
    expect(journal.state().done[0]?.ops.length).toBe(4);
    journal.undo();
    expect(await state(pack)).toEqual(before);
  });

  it('starts a new entry after the drag ends, for another key, after an undo', async () => {
    const pack = await open();
    const journal = new Journal(pack);
    const drag = (key: string, value: number): void => journal.dispatch({ label: 'drag', coalesceKey: key, ops: [{ op: 'set', file: TYPE, at: '/length', value }] });
    drag('a', 1);
    drag('a', 2);
    journal.endCoalescing();
    drag('a', 3);
    drag('b', 4);
    journal.dispatch(command('plain', { op: 'set', file: TYPE, at: '/length', value: 5 }));
    drag('b', 6);
    expect(journal.state().done.length).toBe(5);
    journal.undo();
    drag('b', 7);
    expect(journal.state().done.length).toBe(5);
    expect((pack.json(TYPE) as { length: number }).length).toBe(7);
  });

  it('forgets what could be redone when a new command comes', async () => {
    const pack = await open();
    const journal = new Journal(pack);
    journal.dispatch(command('one', { op: 'set', file: TYPE, at: '/length', value: 1 }));
    journal.undo();
    expect(journal.canRedo).toBe(true);
    journal.dispatch(command('two', { op: 'set', file: TYPE, at: '/length', value: 2 }));
    expect(journal.canRedo).toBe(false);
    expect(journal.redo()).toBeNull();
    journal.undo();
    expect(journal.undo()).toBeNull();
  });

  it('undoes as deep as it was told; older commands stay as committed', async () => {
    const pack = await open();
    const journal = new Journal(pack, { depth: 3 });
    for (let i = 1; i <= 5; i++) journal.dispatch(command(`set ${i}`, { op: 'set', file: TYPE, at: '/length', value: i }));
    expect(journal.state().committed.map((c) => c.label)).toEqual(['set 1', 'set 2']);
    expect(journal.state().done.map((c) => c.label)).toEqual(['set 3', 'set 4', 'set 5']);
    while (journal.undo() !== null);
    expect((pack.json(TYPE) as { length: number }).length).toBe(2);
  });

  it('tells its listeners about every change until they leave', async () => {
    const pack = await open();
    const journal = new Journal(pack);
    let calls = 0;
    const leave = journal.subscribe(() => calls++);
    journal.dispatch(command('one', { op: 'set', file: TYPE, at: '/length', value: 1 }));
    journal.undo();
    journal.redo();
    leave();
    journal.undo();
    expect(calls).toBe(3);
  });

  it('rolls back an undo that fails halfway', () => {
    const log: string[] = [];
    const target: OpTarget = {
      apply(op) {
        const at = 'at' in op ? op.at : op.file;
        if (op.op === 'remove' && at === '/fail') throw new Error('refused');
        log.push(`${op.op} ${at}`);
        if (op.op === 'set' && at === '/a') return [{ op: 'remove', file: 'f', at: '/fail' }];
        return [{ op: 'remove', file: 'f', at: op.op === 'set' ? at : '/x' }];
      },
    };
    const journal = new Journal(target);
    journal.dispatch(command('two', { op: 'set', file: 'f', at: '/a', value: 1 }, { op: 'set', file: 'f', at: '/b', value: 1 }));
    expect(() => journal.undo()).toThrow('refused');
    expect(journal.canUndo).toBe(true);
    expect(log).toEqual(['set /a', 'set /b', 'remove /b', 'remove /x']);
  });
});

describe('the journal as JSON', () => {
  it('saves and restores what was done, undone and committed, bytes and all', async () => {
    const pack = await open();
    const journal = new Journal(pack, { depth: 2 });
    journal.dispatch({ label: 'field.set', labelParams: { field: 'length', n: 1 }, ops: [{ op: 'set', file: TYPE, at: '/length', value: 1 }] });
    await journal.run(command('put', { op: 'putFile', file: 'assets/ns/stock/body.png', bytes: new Uint8Array([0, 1, 254, 255]) }));
    journal.dispatch({ label: 'drag', coalesceKey: 'd', ops: [{ op: 'insert', file: TYPE, at: '/doors/-', value: { id: 'c' } }] });
    journal.dispatch(command('rename', { op: 'renameFile', file: 'assets/ns/stock/body.png', to: 'assets/ns/stock/b.png' }));
    journal.undo();
    const text = serializeJournal(journal.state());
    const saved = await state(pack);

    const fresh = await open();
    const restored = await Journal.restore(fresh, parseJournal(text), { depth: 2 });
    expect(await state(fresh)).toEqual(saved);
    expect(restored.state()).toEqual(journal.state());
    restored.redo();
    expect(fresh.has('assets/ns/stock/b.png')).toBe(true);
    while (restored.undo() !== null);
    expect((fresh.json(TYPE) as { length: number }).length).toBe(1);
    expect(fresh.dirtyPaths()).toEqual(['assets/ns/stock/body.png', TYPE]); // the committed commands stay
  });

  it('writes bytes as base64 and back', () => {
    const bytes = new Uint8Array(70000).map((_, i) => i % 256);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
    expect(toBase64(new Uint8Array([255, 0]))).toBe('/wA=');
  });

  it('refuses what is no journal', () => {
    const bad: unknown[] = [
      'not json',
      '[]',
      { format: 2, committed: [], done: [], undone: [] },
      { format: 1, committed: [], done: {}, undone: [] },
      { format: 1, committed: [], done: [5], undone: [] },
      { format: 1, committed: [], done: [{ label: 'x' }], undone: [] },
      { format: 1, committed: [], done: [{ label: 1, ops: [] }], undone: [] },
      { format: 1, committed: [], done: [{ label: 'x', ops: [7] }], undone: [] },
      { format: 1, committed: [], done: [{ label: 'x', ops: [{ op: 'move', file: 'a' }] }], undone: [] },
      { format: 1, committed: [], done: [{ label: 'x', ops: [{ op: 'set', file: 'a', at: '' }] }], undone: [] },
      { format: 1, committed: [], done: [{ label: 'x', ops: [{ op: 'putFile', file: 'a', base64: '***' }] }], undone: [] },
      { format: 1, committed: [], done: [{ label: 'x', ops: [{ op: 'putFile', file: 'a' }] }], undone: [] },
      { format: 1, committed: [], done: [{ label: 'x', ops: [], labelParams: { a: [] } }], undone: [] },
      { format: 1, committed: [], done: [{ label: 'x', ops: [], coalesceKey: 3 }], undone: [] },
    ];
    for (const data of bad) {
      expect(() => parseJournal(typeof data === 'string' ? data : JSON.stringify(data)), JSON.stringify(data)).toThrow(JournalFormatError);
    }
    const ops: Op[] = [
      { op: 'remove', file: 'a', at: '/x' },
      { op: 'deleteFile', file: 'a' },
      { op: 'insert', file: 'a', at: '/l/-', value: null },
    ];
    const state = { committed: [], done: [{ label: 'x', ops, coalesceKey: 'k' }], undone: [] };
    expect(parseJournal(serializeJournal(state))).toEqual(state);
  });
});
