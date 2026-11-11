import { describe, expect, it } from 'vitest';
import { catalog } from '../../i18n';
import { tools } from '../../tools';
import { KEY_ACTIONS, KEY_SCOPES, TOOL_KEYS, chordsOf, type KeyAction } from './actions';
import { formatChord, parseChord, type Platform } from './chords';
import { keyReference } from './reference';
import { dispatchedActions, editorHandlers } from './wire';

const PLATFORMS: readonly Platform[] = ['pc', 'mac'];

/** The chord as one string whose two spellings of the same chord are equal: modifiers in a fixed order. */
function canonical(text: string): string {
  const chord = parseChord(text);
  return [chord.mod ? 'mod' : '', chord.alt ? 'alt' : '', chord.shift ? 'shift' : '', chord.key].filter((part) => part !== '').join('+');
}

/** What the browsers keep for themselves (tabs, address bar, search, print, reload, history, full screen, tools). */
const BROWSER_CHORDS: ReadonlySet<string> = new Set(
  [
    'Mod+N', 'Mod+Shift+N', 'Mod+T', 'Mod+Shift+T', 'Mod+W', 'Mod+Shift+W', 'Mod+Tab', 'Mod+Shift+Tab', 'Mod+PageUp', 'Mod+PageDown',
    'Mod+F', 'Mod+G', 'Mod+Shift+G', 'Mod+H', 'Mod+J', 'Mod+K', 'Mod+L', 'Mod+D', 'Mod+Shift+D', 'Mod+P', 'Mod+R', 'Mod+Shift+R', 'Mod+O', 'Mod+U',
    'Mod+Shift+I', 'Mod+Shift+J', 'Mod+Shift+C', 'Mod+Shift+Delete', 'Mod+Shift+B', 'Mod+Shift+O', 'Mod+Shift+A', 'Mod+Shift+M',
    'Mod+0', 'Mod+1', 'Mod+2', 'Mod+3', 'Mod+4', 'Mod+5', 'Mod+6', 'Mod+7', 'Mod+8', 'Mod+9', 'Mod+=', 'Mod+-', 'Mod+Home',
    'Alt+1', 'Alt+2', 'Alt+3', 'Alt+4', 'Alt+5', 'Alt+6', 'Alt+7', 'Alt+8', 'Alt+9', 'Alt+ArrowLeft', 'Alt+ArrowRight', 'Alt+Home', 'Alt+D', 'Alt+F', 'Alt+E',
    'F1', 'F3', 'F5', 'F6', 'F7', 'F10', 'F11', 'F12', 'Mod+F5', 'Shift+F5', 'Shift+F6', 'Shift+F10',
  ].map(canonical),
);

/** On a Mac, besides: ⌘Y is History, ⌘⇧Z is redo but ⌘Q, ⌘M, ⌘H, ⌘, belong to the system. */
const MAC_ONLY: ReadonlySet<string> = new Set(['Mod+Y', 'Mod+Q', 'Mod+M', 'Mod+,'].map(canonical));

describe('the key map', () => {
  it('has no two actions on one chord in one place', () => {
    for (const platform of PLATFORMS) {
      const seen = new Map<string, string>();
      for (const action of KEY_ACTIONS) {
        for (const chord of chordsOf(action, platform)) {
          const place = `${platform} ${action.scope} ${action.widget ?? ''} ${canonical(chord)}`;
          const first = seen.get(place);
          expect(first, `${action.id} and ${first} are both ${chord} on a ${platform} in ${action.scope}`).toBeUndefined();
          seen.set(place, action.id);
        }
      }
    }
  });

  it('has unique ids, parseable chords and chords at all for every action', () => {
    expect(new Set(KEY_ACTIONS.map((action) => action.id)).size).toBe(KEY_ACTIONS.length);
    for (const action of KEY_ACTIONS) {
      for (const platform of PLATFORMS) {
        const chords = chordsOf(action, platform);
        expect(chords.length, `${action.id} on a ${platform}`).toBeGreaterThan(0);
        for (const chord of chords) expect(() => parseChord(chord), `${action.id}: ${chord}`).not.toThrow();
      }
      expect(KEY_SCOPES).toContain(action.scope);
    }
  });

  it('names every action in both languages', () => {
    for (const action of KEY_ACTIONS) {
      for (const lang of ['ru', 'en'] as const) {
        expect(catalog.get(lang, `keys.action.${action.id}`), `${action.id} in ${lang}`).toBeTruthy();
      }
    }
    // and no title is left without an action
    const titles = catalog.keys().filter((key) => key.startsWith('keys.action.'));
    expect(titles.sort()).toEqual(KEY_ACTIONS.map((action) => `keys.action.${action.id}`).sort());
  });

  it('keeps clear of the browser’s own shortcuts', () => {
    for (const action of KEY_ACTIONS) {
      if (action.widget !== undefined) continue;
      for (const platform of PLATFORMS) {
        for (const chord of chordsOf(action, platform)) {
          const name = canonical(chord);
          expect(BROWSER_CHORDS.has(name), `${action.id}: ${chord} is the browser's`).toBe(false);
          if (platform === 'mac') expect(MAC_ONLY.has(name), `${action.id}: ${chord} is the Mac's`).toBe(false);
        }
      }
    }
  });

  it('uses a plain letter or digit only where the 3D view has the focus (WCAG 2.1.4)', () => {
    for (const action of KEY_ACTIONS) {
      if (action.widget !== undefined) continue;
      for (const chord of chordsOf(action, 'pc')) {
        const parsed = parseChord(chord);
        const character = /^[a-z0-9]$/.test(parsed.key) && !parsed.mod && !parsed.alt;
        if (character) expect(action.scope, `${action.id}: ${chord}`).toBe('view');
      }
    }
  });

  it('has a handler for every action the dispatcher runs, and only those', () => {
    expect(Object.keys(editorHandlers).sort()).toEqual(dispatchedActions().sort());
  });

  it('gives every tool of the editor a key, and every tool key a tool', () => {
    expect(tools.map((tool) => tool.id).sort()).toEqual([...TOOL_KEYS].sort());
    expect(KEY_ACTIONS.some((action) => action.id === 'tool.use.select')).toBe(true);
  });

  it('keeps the keys the platform’s way: ⌘ for Ctrl on a Mac, and no ⌘Y there', () => {
    const redo = KEY_ACTIONS.find((action) => action.id === 'edit.redo') as KeyAction;
    expect(chordsOf(redo, 'pc').map((chord) => formatChord(parseChord(chord), 'pc'))).toEqual(['Ctrl+Shift+Z', 'Ctrl+Y']);
    expect(chordsOf(redo, 'mac').map((chord) => formatChord(parseChord(chord), 'mac'))).toEqual(['⇧⌘Z']);
  });
});

describe('the reference for people', () => {
  it('has a row for every action with a title in each language and its keys per platform', () => {
    const rows = keyReference();
    expect(rows.map((row) => row.id)).toEqual(KEY_ACTIONS.map((action) => action.id));
    const undo = rows.find((row) => row.id === 'edit.undo');
    expect(undo?.title.en).toBe('Undo the last edit of the pack');
    expect(undo?.title.ru).toBe('Отменить правку пака');
    expect(undo?.keys).toEqual({ pc: ['Ctrl+Z'], mac: ['⌘Z'] });
    expect(rows.find((row) => row.id === 'tabs.move')?.widget).toBe('tabs');
    expect(rows.find((row) => row.id === 'view.camera.top')).toMatchObject({ scope: 'view', keys: { pc: ['7'], mac: ['7'] } });
  });
});
