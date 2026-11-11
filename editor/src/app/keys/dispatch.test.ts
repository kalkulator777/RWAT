import { describe, expect, it } from 'vitest';
import type { KeyAction } from './actions';
import type { KeyLike } from './chords';
import { activeScopes, createDispatcher, findAction, type Handlers, type KeyContext, type KeyEventLike } from './dispatch';

const PLAIN: KeyContext = { typing: false, edited: false, modal: false, view: false, tool: false, list: null };

/** A key event as the lookup reads it. */
function event(name: string, init: Partial<KeyEventLike> = {}): KeyEventLike {
  const base: KeyLike = { key: name, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false };
  return { ...base, repeat: false, ...init };
}

const MAP: readonly KeyAction[] = [
  { id: 'a.save', scope: 'global', keys: ['Mod+S'], typing: 'allow', modal: true },
  { id: 'a.undo', scope: 'global', keys: ['Mod+Z'], typing: 'clean', modal: true, repeat: true },
  { id: 'a.help', scope: 'global', keys: ['?'] },
  { id: 'a.clear', scope: 'global', keys: ['Escape'] },
  { id: 'v.top', scope: 'view', keys: ['7'] },
  { id: 'v.home', scope: 'view', keys: ['Home'] },
  { id: 't.delete', scope: 'tool', keys: ['Delete'] },
  { id: 'l.first', scope: 'list', keys: ['Home'] },
  { id: 'l.next', scope: 'list', keys: ['ArrowDown'], repeat: true },
  { id: 'w.tabs', scope: 'list', widget: 'tabs', keys: ['ArrowLeft'] },
];

const ctrl = { ctrlKey: true };

describe('activeScopes', () => {
  it('lists the narrowest first and always ends with the whole page', () => {
    expect(activeScopes(PLAIN)).toEqual(['global']);
    expect(activeScopes({ ...PLAIN, view: true, tool: true, list: 'list' })).toEqual(['list', 'view', 'tool', 'global']);
  });
});

describe('findAction', () => {
  const find = (e: KeyEventLike, context: Partial<KeyContext> = {}) => findAction(e, { ...PLAIN, ...context }, 'pc', MAP)?.id ?? null;

  it('finds a global action anywhere and a narrower one only in its place', () => {
    expect(find(event('s', ctrl))).toBe('a.save');
    expect(find(event('7'))).toBeNull();
    expect(find(event('7'), { view: true })).toBe('v.top');
    expect(find(event('Delete'))).toBeNull();
    expect(find(event('Delete'), { tool: true })).toBe('t.delete');
    expect(find(event('ArrowDown'))).toBeNull();
    expect(find(event('ArrowDown'), { list: 'list' })).toBe('l.next');
  });

  it('prefers the narrower scope when two apply to one chord', () => {
    expect(find(event('Home'), { view: true })).toBe('v.home');
    expect(find(event('Home'), { view: true, list: 'tree' })).toBe('l.first');
  });

  it('leaves the keys of a text field to the field, but for the actions that say they work there', () => {
    expect(find(event('z', ctrl), { typing: true, edited: true })).toBeNull();
    expect(find(event('?', { shiftKey: true }), { typing: true })).toBeNull();
    expect(find(event('7'), { typing: true, view: true })).toBeNull();
    expect(find(event('s', ctrl), { typing: true })).toBe('a.save');
  });

  it('runs a clean action in a text field with nothing typed that is not committed, and leaves it to the field otherwise', () => {
    expect(find(event('z', ctrl), { typing: true, edited: false })).toBe('a.undo');
    expect(find(event('z', ctrl), { typing: true, edited: true })).toBeNull();
    expect(find(event('z', ctrl), { typing: false })).toBe('a.undo');
  });

  it('lets only the actions marked for it run under an open dialog', () => {
    expect(find(event('z', ctrl), { modal: true })).toBe('a.undo');
    expect(find(event('s', ctrl), { modal: true })).toBe('a.save');
    expect(find(event('Escape'), { modal: true })).toBeNull();
    expect(find(event('?', { shiftKey: true }), { modal: true })).toBeNull();
  });

  it('repeats only what asks to, and ignores a key of an input method’s composition', () => {
    expect(find(event('z', { ...ctrl, repeat: true }))).toBe('a.undo');
    expect(find(event('s', { ...ctrl, repeat: true }))).toBeNull();
    expect(find(event('z', { ...ctrl, isComposing: true }))).toBeNull();
    expect(find(event('z', { ...ctrl, keyCode: 229 }))).toBeNull();
  });

  it('never runs the keys a widget handles itself', () => {
    expect(find(event('ArrowLeft'), { list: 'list' })).toBeNull();
  });

  it('uses the Mac’s own chords on a Mac', () => {
    const redo: readonly KeyAction[] = [{ id: 'redo', scope: 'global', keys: ['Mod+Shift+Z', 'Mod+Y'], mac: ['Mod+Shift+Z'] }];
    const y = event('y', ctrl);
    expect(findAction(y, PLAIN, 'pc', redo)?.id).toBe('redo');
    expect(findAction(event('y', { metaKey: true }), PLAIN, 'mac', redo)).toBeNull();
    expect(findAction(event('Z', { metaKey: true, shiftKey: true }), PLAIN, 'mac', redo)?.id).toBe('redo');
  });
});

describe('createDispatcher', () => {
  /** A keyboard event whose default can be prevented and read back. */
  function press(name: string, init: KeyboardEventInit = {}): KeyboardEvent {
    return new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init });
  }

  function setup(context: Partial<KeyContext> = {}, handlers: Handlers = {}) {
    const calls: string[] = [];
    const record = (id: string) => () => {
      calls.push(id);
    };
    const all: Handlers = {
      'a.save': record('a.save'),
      'a.undo': record('a.undo'),
      'a.clear': () => {
        calls.push('a.clear');
        return false;
      },
      'v.top': record('v.top'),
      ...handlers,
    };
    const dispatch = createDispatcher({ handlers: all, platform: 'pc', actions: MAP, context: () => ({ ...PLAIN, ...context }) });
    return { calls, dispatch };
  }

  it('calls the handler of the action and takes the key', () => {
    const { calls, dispatch } = setup();
    const e = press('s', ctrl);
    dispatch(e);
    expect(calls).toEqual(['a.save']);
    expect(e.defaultPrevented).toBe(true);
  });

  it('does not take a key it has no action for, and calls nothing', () => {
    const { calls, dispatch } = setup();
    const e = press('q', ctrl);
    dispatch(e);
    expect(calls).toEqual([]);
    expect(e.defaultPrevented).toBe(false);
  });

  it('leaves the key to the browser when the handler says there was nothing to do', () => {
    const { calls, dispatch } = setup();
    const e = press('Escape');
    dispatch(e);
    expect(calls).toEqual(['a.clear']);
    expect(e.defaultPrevented).toBe(false);
  });

  it('leaves alone a key that something took already', () => {
    const { calls, dispatch } = setup();
    const e = press('s', ctrl);
    e.preventDefault();
    dispatch(e);
    expect(calls).toEqual([]);
  });

  it('asks for the context of each key', () => {
    const { calls, dispatch } = setup({ view: true });
    dispatch(press('7'));
    expect(calls).toEqual(['v.top']);
  });

  it('survives an action with no handler', () => {
    const { calls, dispatch } = setup({ tool: true });
    const e = press('Delete');
    dispatch(e);
    expect(calls).toEqual([]);
    expect(e.defaultPrevented).toBe(false);
  });
});
