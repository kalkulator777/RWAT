/**
 * The editor's key map: every shortcut, declared in one place (docs/proposals/editor.md
 * §6.3). One row is an action — what the keys do — with the chords that do it, where they
 * work (the {@link KeyScope}) and how they behave around text fields and dialogs. The
 * rows carry no text and no code: the help text of each is `keys.action.<id>` in
 * ./i18n.ts, and what it does is the handler of the same id in ./wire.ts. A row without
 * one of them fails the key map's test.
 *
 * Where the keys work:
 * - `global` — anywhere on the page;
 * - `view` — the focus is in the 3D view's panel (its bar or the drawing), so the
 *   single-key shortcuts of the view are active only on the view itself;
 * - `tool` — a markup tool is on and the focus is in the 3D view or in the inspector's
 *   section of the tool;
 * - `list` — the focus is on an item of a tree or a list (`data-roving`, ./roving.ts).
 *
 * A row with a `widget` names keys that a widget handles itself, as its ARIA pattern asks
 * (the tabs' arrows, the splitters' arrows, a field's Enter and Escape, a list item's
 * Delete). The dispatcher never runs them; they are here so that the Keys window and the
 * help list every key, and so that two rows cannot claim one chord.
 *
 * The keys avoid the browser's: Ctrl+N/T/W/Tab/PageUp/PageDown, Ctrl+F/G/H/L/P/R/D and the
 * digits with Ctrl or Alt are the browser's (tabs, search, address bar, print), F5/F6/F11/F12
 * too. Plain letters and digits are only the view's (WCAG 2.1.4: character-key shortcuts
 * act only while their component has the focus); the one exception is `?`, which opens
 * this list from anywhere but a text field (the Keys button in the top bar is the other
 * way in). ⌘Y is the browser's History on a Mac, so redo there is ⌘⇧Z alone.
 */

/** Where an action's keys work (see the file's head). */
export type KeyScope = 'global' | 'view' | 'tool' | 'list';

/** The widgets that handle some keys themselves. */
export type KeyWidget = 'tabs' | 'splitter' | 'tool-item' | 'field';

export interface KeyAction {
  /** `<area>.<name>`; its text is `keys.action.<id>`, its handler (./wire.ts) the same id. */
  readonly id: string;
  readonly scope: KeyScope;
  /** The chords (./chords.ts) on every platform but where {@link mac} says otherwise. */
  readonly keys: readonly string[];
  /** The chords on a Mac, when they are not {@link keys}. */
  readonly mac?: readonly string[];
  /** Set for keys a widget handles itself; the dispatcher leaves them alone. */
  readonly widget?: KeyWidget;
  /**
   * What the keys do in a text field: `native` (the default) leaves them to the field;
   * `allow` runs the action there too; `clean` runs it when the field holds no typing
   * that is not committed yet, so that Ctrl+Z over fresh typing is the field's own undo of
   * the text, and after Enter or leaving the field it is the pack's undo of the edit.
   */
  readonly typing?: 'native' | 'allow' | 'clean';
  /** Runs while a modal dialog is open (the dialog's own question comes first for all the rest). */
  readonly modal?: boolean;
  /** Runs again while the keys are held down. */
  readonly repeat?: boolean;
}

export const KEY_ACTIONS: readonly KeyAction[] = [
  // ---- global
  { id: 'file.save', scope: 'global', keys: ['Mod+S'], typing: 'allow', modal: true },
  { id: 'edit.undo', scope: 'global', keys: ['Mod+Z'], typing: 'clean', modal: true, repeat: true },
  { id: 'edit.redo', scope: 'global', keys: ['Mod+Shift+Z', 'Mod+Y'], mac: ['Mod+Shift+Z'], typing: 'clean', modal: true, repeat: true },
  { id: 'help.keys', scope: 'global', keys: ['?'] },
  { id: 'selection.clear', scope: 'global', keys: ['Escape'] },
  { id: 'findings.next', scope: 'global', keys: ['F8'], typing: 'allow' },
  { id: 'findings.prev', scope: 'global', keys: ['Shift+F8'], typing: 'allow' },
  { id: 'bottom.next', scope: 'global', keys: ['Alt+PageDown'], typing: 'allow' },
  { id: 'bottom.prev', scope: 'global', keys: ['Alt+PageUp'], typing: 'allow' },
  // ---- the 3D view (Blender's keypad for the cameras)
  { id: 'view.camera.orbit', scope: 'view', keys: ['5'] },
  { id: 'view.camera.side', scope: 'view', keys: ['1'] },
  { id: 'view.camera.front', scope: 'view', keys: ['3'] },
  { id: 'view.camera.top', scope: 'view', keys: ['7'] },
  { id: 'view.frame.all', scope: 'view', keys: ['Home'] },
  { id: 'view.frame.selected', scope: 'view', keys: ['.'] },
  { id: 'tool.use.select', scope: 'view', keys: ['S'] },
  { id: 'tool.use.floor', scope: 'view', keys: ['Z'] },
  { id: 'tool.use.doors', scope: 'view', keys: ['D'] },
  { id: 'tool.use.seats', scope: 'view', keys: ['C'] },
  { id: 'tool.use.lights', scope: 'view', keys: ['L'] },
  { id: 'tool.use.pivots', scope: 'view', keys: ['P'] },
  // ---- with a tool on
  { id: 'tool.delete', scope: 'tool', keys: ['Delete'], mac: ['Delete', 'Backspace'] },
  // ---- trees and lists
  { id: 'list.next', scope: 'list', keys: ['ArrowDown'], repeat: true },
  { id: 'list.prev', scope: 'list', keys: ['ArrowUp'], repeat: true },
  { id: 'list.first', scope: 'list', keys: ['Home'] },
  { id: 'list.last', scope: 'list', keys: ['End'] },
  { id: 'list.activate', scope: 'list', keys: ['Enter', ' '] },
  { id: 'tree.expand', scope: 'list', keys: ['ArrowRight'] },
  { id: 'tree.collapse', scope: 'list', keys: ['ArrowLeft'] },
  // ---- keys the widgets handle themselves
  { id: 'tabs.move', scope: 'list', widget: 'tabs', keys: ['ArrowLeft', 'ArrowRight', 'Home', 'End'] },
  { id: 'splitter.move', scope: 'list', widget: 'splitter', keys: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'] },
  { id: 'splitter.step', scope: 'list', widget: 'splitter', keys: ['Shift+ArrowLeft', 'Shift+ArrowRight', 'Shift+ArrowUp', 'Shift+ArrowDown'] },
  { id: 'splitter.limit', scope: 'list', widget: 'splitter', keys: ['Home', 'End'] },
  { id: 'item.delete', scope: 'list', widget: 'tool-item', keys: ['Delete', 'Backspace'] },
  { id: 'field.commit', scope: 'list', widget: 'field', keys: ['Enter'] },
  { id: 'field.revert', scope: 'list', widget: 'field', keys: ['Escape'] },
];

/** The scopes in the order the Keys window lists them. */
export const KEY_SCOPES: readonly KeyScope[] = ['global', 'view', 'tool', 'list'];

/** The chords of an action on a platform. */
export function chordsOf(action: KeyAction, platform: 'pc' | 'mac'): readonly string[] {
  return platform === 'mac' && action.mac !== undefined ? action.mac : action.keys;
}

/** The markup tools that have a key (`tool.use.<id>` besides `tool.use.select`), in the tool bar's order. */
export const TOOL_KEYS: readonly string[] = KEY_ACTIONS.filter((action) => action.id.startsWith('tool.use.') && action.id !== 'tool.use.select').map((action) => action.id.slice('tool.use.'.length));
