import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { panels } from '../panels';
import { Shell } from '../Shell';
import { MemorySource, readTree } from '../../core/pack/testing.node';
import { createSchema } from '../../core/schema';
import { readSchemaFiles } from '../../core/schema/files.node';
import { setLang } from '../../i18n';
import { EXAMPLE_PACK } from '../../testing/repo.node';
import { toolHost } from '../../tools';
import { view } from '../../view3d/state';
import { saveDialogOpen } from '../save/state';
import { openSource } from '../session';
import { failure, journal, pack, revision, schema, schemaError, selection } from '../store';
import { announcement } from './announce';
import { editorHandlers, installKeys } from './wire';

const COACH = 'data/rwat_example/wagon_types/coach.json';
const files = readTree(EXAMPLE_PACK);

function reset(): void {
  pack.value = null;
  journal.value = null;
  schema.value = null;
  schemaError.value = null;
  failure.value = null;
  selection.value = [];
  revision.value = 0;
  saveDialogOpen.value = false;
  toolHost.active.value = null;
  toolHost.current.value = null;
  view.setCamera('orbit');
  announcement.value = '';
}

let off: () => void;

beforeEach(() => {
  reset();
  setLang('en');
  off = installKeys(document, { platform: 'pc' });
});

afterEach(() => {
  off();
  cleanup();
  reset();
  localStorage.clear();
});

/** A keydown on an element; false when the editor took the key. */
function press(target: Element, key: string, init: KeyboardEventInit = {}): boolean {
  return fireEvent.keyDown(target, { key, ...init });
}

describe('Escape', () => {
  it('clears the selection first and leaves the tool when there is nothing to clear, and is the browser’s after that', () => {
    selection.value = [{ kind: 'file', file: COACH }];
    toolHost.use('floor');
    expect(press(document.body, 'Escape')).toBe(false);
    expect(selection.value).toEqual([]);
    expect(toolHost.active.value).toBe('floor');
    expect(announcement.value.trim()).toBe('Selection cleared.');
    expect(press(document.body, 'Escape')).toBe(false);
    expect(toolHost.active.value).toBeNull();
    expect(announcement.value.trim()).toBe('Tool: Select');
    expect(press(document.body, 'Escape')).toBe(true);
  });

  it('closes an open menu before anything else', () => {
    document.body.innerHTML = '<details open id="menu"><summary>menu</summary><label><input type="checkbox" id="box"></label></details>';
    selection.value = [{ kind: 'file', file: COACH }];
    expect(press(document.getElementById('box') as Element, 'Escape')).toBe(false);
    expect(document.getElementById('menu')?.hasAttribute('open')).toBe(false);
    expect(selection.value).toHaveLength(1);
  });

  it('is left to a text field', () => {
    selection.value = [{ kind: 'file', file: COACH }];
    const input = document.createElement('input');
    document.body.append(input);
    expect(press(input, 'Escape')).toBe(true);
    expect(selection.value).toHaveLength(1);
  });
});

describe('the keys of the 3D view', () => {
  it('work on the view’s panel and not elsewhere', () => {
    document.body.innerHTML = '<div data-keys-scope="view tool"><button id="bar">bar</button></div><button id="elsewhere">e</button>';
    const bar = document.getElementById('bar') as Element;
    expect(press(bar, '7')).toBe(false);
    expect(view.camera.value).toBe('top');
    press(bar, '1');
    expect(view.camera.value).toBe('side');
    press(bar, '3');
    expect(view.camera.value).toBe('front');
    press(bar, '5');
    expect(view.camera.value).toBe('orbit');
    const serial = view.framing.value.serial;
    press(bar, 'Home');
    expect(view.framing.value).toEqual({ serial: serial + 1, what: 'all' });
    press(bar, '.');
    expect(view.framing.value).toEqual({ serial: serial + 2, what: 'selected' });
    // on the numeric keypad too
    fireEvent.keyDown(bar, { key: '7', code: 'Numpad7' });
    expect(view.camera.value).toBe('top');

    view.setCamera('orbit');
    expect(press(document.getElementById('elsewhere') as Element, '7')).toBe(true);
    expect(view.camera.value).toBe('orbit');
  });

  it('turn a tool on and off by its letter on any layout, and say so; a tool that does not fit the wagon says so', () => {
    document.body.innerHTML = '<div data-keys-scope="view tool"><button id="bar">bar</button></div>';
    const bar = document.getElementById('bar') as Element;
    press(bar, 'z');
    // no wagon is open: no tool applies, nothing turns on
    expect(toolHost.active.value).toBeNull();
    expect(announcement.value.trim()).toBe('The tool “Zones” does not fit the open wagon.');
    toolHost.use('doors');
    press(bar, 's');
    expect(toolHost.active.value).toBeNull();
    expect(announcement.value.trim()).toBe('Tool: Select');
    // a Russian layout: the key of Z types я
    toolHost.use('floor');
    fireEvent.keyDown(bar, { key: 'я', code: 'KeyZ' });
    expect(toolHost.active.value).toBeNull();
  });
});

describe('Delete with a tool on', () => {
  it('removes what the tool has selected, from the view or the tool’s section, and not from elsewhere', () => {
    document.body.innerHTML = '<div data-keys-scope="view tool"><button id="bar">bar</button></div><section data-keys-scope="tool"><button id="section">s</button></section><button id="elsewhere">e</button>';
    let removed = 0;
    let anything = true;
    toolHost.current.value = {
      tool: toolHost.tools[0] as (typeof toolHost.tools)[number],
      wagon: 'a:b',
      session: {
        Inspector: () => null,
        removeSelected: () => {
          removed++;
          return anything;
        },
        dispose: () => undefined,
      },
    };
    expect(press(document.getElementById('bar') as Element, 'Delete')).toBe(false);
    expect(press(document.getElementById('section') as Element, 'Delete')).toBe(false);
    expect(removed).toBe(2);
    expect(announcement.value.trim()).toBe('The selected item is deleted.');
    expect(press(document.getElementById('elsewhere') as Element, 'Delete')).toBe(true);
    expect(removed).toBe(2);
    anything = false;
    expect(press(document.getElementById('bar') as Element, 'Delete')).toBe(true);
    expect(removed).toBe(3);
    // with the tool off the key is nobody's
    toolHost.current.value = null;
    expect(press(document.getElementById('bar') as Element, 'Delete')).toBe(true);
  });
});

describe('the shortcuts of the page', () => {
  it('work with the focus on a check box or a button, and in a text field only those that say so', async () => {
    await openSource(new MemorySource(files, 'RwatExamplePack'));
    await journal.value?.run({ label: 'edit.field', ops: [{ op: 'set', file: COACH, at: '/mass_t', value: 60 }] });
    expect(pack.value?.dirtyPaths()).toEqual([COACH]);
    document.body.innerHTML = '<input type="checkbox" id="box"><input type="text" id="text">';
    // the check box is not a place of typing: Ctrl+Z is the editor's
    expect(press(document.getElementById('box') as Element, 'z', { ctrlKey: true })).toBe(false);
    expect(pack.value?.dirtyPaths()).toEqual([]);
    await journal.value?.run({ label: 'edit.field', ops: [{ op: 'set', file: COACH, at: '/mass_t', value: 61 }] });
    // a text field with fresh typing keeps its own undo of the text
    const text = document.getElementById('text') as HTMLInputElement;
    fireEvent.input(text, { target: { value: 'abc' } });
    expect(press(text, 'z', { ctrlKey: true })).toBe(true);
    expect(pack.value?.dirtyPaths()).toEqual([COACH]);
    // once the text is accepted (Enter, or leaving the field) Ctrl+Z is the pack's undo again
    fireEvent.change(text);
    expect(press(text, 'z', { ctrlKey: true })).toBe(false);
    expect(pack.value?.dirtyPaths()).toEqual([]);
    // Save is the editor's in a text field in any case
    expect(press(text, 's', { ctrlKey: true })).toBe(false);
    expect(saveDialogOpen.value).toBe(true);
  });

  it('take Ctrl+Z whatever the layout types: the Russian key of Z', async () => {
    await openSource(new MemorySource(files, 'RwatExamplePack'));
    await journal.value?.run({ label: 'edit.field', ops: [{ op: 'set', file: COACH, at: '/mass_t', value: 60 }] });
    expect(fireEvent.keyDown(document.body, { key: 'я', code: 'KeyZ', ctrlKey: true })).toBe(false);
    expect(pack.value?.dirtyPaths()).toEqual([]);
  });

  it('have a handler of their own for each action, so the map and the handlers cannot part', () => {
    expect(typeof editorHandlers['file.save']).toBe('function');
  });
});

/** The shell with the real panels, the example pack open, and the schema loaded. */
async function shellWithPack(): Promise<void> {
  schema.value = createSchema(readSchemaFiles());
  render(<Shell panels={panels} />);
  await openSource(new MemorySource(files, 'RwatExamplePack'));
  await waitFor(() => expect(screen.getByTestId('pack-status').textContent).toContain('RwatExamplePack'));
}

describe('the bottom tabs', () => {
  it('go forward and back with Alt+PageDown and Alt+PageUp, wrapping round, with the focus on the tab', async () => {
    await shellWithPack();
    const tabs = screen.getAllByRole('tab').filter((tab) => tab.closest('[data-slot="bottom"]') !== null);
    expect(tabs.length).toBeGreaterThanOrEqual(5);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    expect(press(document.body, 'PageDown', { altKey: true })).toBe(false);
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs[1]);
    press(document.body, 'PageUp', { altKey: true });
    press(document.body, 'PageUp', { altKey: true });
    expect(tabs.at(-1)?.getAttribute('aria-selected')).toBe('true');
    press(document.body, 'PageDown', { altKey: true });
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
  });
});

describe('the findings', () => {
  it('go next and previous with F8 and Shift+F8, selecting the place of each as a click does, and say which', async () => {
    await shellWithPack();
    await journal.value?.run({
      label: 'edit.field',
      ops: [
        { op: 'set', file: COACH, at: '/mass_t', value: 'heavy' },
        { op: 'set', file: COACH, at: '/length', value: 'long' },
      ],
    });
    const checks = await screen.findByTestId('checks');
    await waitFor(() => expect(Number(checks.getAttribute('data-count'))).toBeGreaterThanOrEqual(2));
    // the findings that point somewhere are the ones the keys go through
    const total = checks.querySelectorAll('.finding:not([disabled])').length;
    expect(total).toBeGreaterThanOrEqual(2);

    expect(press(document.body, 'F8')).toBe(false);
    const first = selection.value;
    expect(first.length).toBeGreaterThan(0);
    expect(announcement.value.trim()).toMatch(new RegExp(`^Finding 1 of ${total}: `));
    press(document.body, 'F8');
    expect(selection.value).not.toEqual(first);
    expect(announcement.value.trim()).toMatch(new RegExp(`^Finding 2 of ${total}: `));
    press(document.body, 'F8', { shiftKey: true });
    expect(selection.value).toEqual(first);
    // back past the first: the last
    press(document.body, 'F8', { shiftKey: true });
    expect(announcement.value.trim()).toMatch(new RegExp(`^Finding ${total} of ${total}: `));
    // F8 is the editor's in a text field too
    const input = document.createElement('input');
    document.body.append(input);
    expect(press(input, 'F8')).toBe(false);
  });

  it('say so when there is no finding with a place', async () => {
    await shellWithPack();
    await waitFor(() => expect(screen.getByTestId('checks-summary').textContent).toBe('No findings.'));
    expect(press(document.body, 'F8')).toBe(false);
    expect(announcement.value.trim()).toBe('No findings with a place.');
  });
});
