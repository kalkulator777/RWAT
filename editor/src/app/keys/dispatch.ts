/**
 * The one key handler of the editor (docs/proposals/editor.md §6.3): a keydown on the page
 * is looked up in the key map (./actions.ts) for the focus it came from, and the handler
 * of the action it finds runs. Nothing else listens for the editor's shortcuts; the widgets
 * that handle their own keys are listed in the map as such.
 *
 * What stands between a key and its action:
 * - a key already handled (`defaultPrevented`: a field's Enter, a tab's arrow) is left alone,
 *   as is a key of an input method's composition;
 * - an action works only in its scope: the page, the 3D view, a tool being on, a list;
 *   where several scopes apply the narrowest one first (list, view, tool, global);
 * - in a text field only the actions marked `allow` run, and Ctrl+Z (`clean`) while the
 *   field has no uncommitted typing, so that Ctrl+Z over typing is the field's own undo,
 *   and `?` and the letters are typed;
 * - while a modal dialog is open only the actions marked `modal` run;
 * - a held key repeats only the actions that say so.
 *
 * A handler answers `false` for "nothing to do here": the key is then not taken, and the
 * browser does with it what it would. Anything else takes the key (`preventDefault`).
 */

import { KEY_ACTIONS, chordsOf, type KeyAction, type KeyScope } from './actions';
import { matchChord, parseChord, type Chord, type KeyLike, type Platform } from './chords';

/** Where a key came from, as far as the key map cares. */
export interface KeyContext {
  /** The focus is in a place where keys are text: a text box, a text area, a drop-down list, an editable element. */
  readonly typing: boolean;
  /** The focus is in a text field with typing that is not committed yet (./context.ts `watchEdits`). */
  readonly edited: boolean;
  /** A modal dialog is open. */
  readonly modal: boolean;
  /** The focus is in the 3D view's panel. */
  readonly view: boolean;
  /** A markup tool is on and the focus is in the view or in the tool's section of the inspector. */
  readonly tool: boolean;
  /** The kind of the tree or list the focus is on an item of, or null. */
  readonly list: 'tree' | 'list' | null;
}

export type ActionHandler = (event: KeyboardEvent, context: KeyContext) => boolean | void;

/** The handlers by action id. */
export type Handlers = Readonly<Record<string, ActionHandler>>;

/** The scopes that apply to a key of this context, narrowest first. */
export function activeScopes(context: KeyContext): KeyScope[] {
  const scopes: KeyScope[] = [];
  if (context.list !== null) scopes.push('list');
  if (context.view) scopes.push('view');
  if (context.tool) scopes.push('tool');
  scopes.push('global');
  return scopes;
}

/** The chords of every action on a platform, parsed (once per map and platform). */
const parsed = new WeakMap<readonly KeyAction[], Partial<Record<Platform, Map<KeyAction, Chord[]>>>>();

function chordTable(platform: Platform, actions: readonly KeyAction[]): ReadonlyMap<KeyAction, readonly Chord[]> {
  const byPlatform = parsed.get(actions) ?? {};
  parsed.set(actions, byPlatform);
  return (byPlatform[platform] ??= new Map(actions.map((action) => [action, chordsOf(action, platform).map(parseChord)])));
}

/** What a key event is, as far as finding its action goes (a real `KeyboardEvent` is one). */
export interface KeyEventLike extends KeyLike {
  readonly repeat: boolean;
  readonly isComposing?: boolean;
  readonly keyCode?: number;
}

/**
 * The action a key event is, in a context, or null: the first action of the narrowest scope
 * that has one of the event's chords and is allowed to run here (see the file's head).
 */
export function findAction(event: KeyEventLike, context: KeyContext, platform: Platform, actions: readonly KeyAction[] = KEY_ACTIONS): KeyAction | null {
  if (event.isComposing === true || event.keyCode === 229) return null;
  const table = chordTable(platform, actions);
  for (const scope of activeScopes(context)) {
    for (const [action, chords] of table) {
      if (action.scope !== scope || action.widget !== undefined) continue;
      if (context.typing && action.typing !== 'allow' && !(action.typing === 'clean' && !context.edited)) continue;
      if (context.modal && action.modal !== true) continue;
      if (event.repeat && action.repeat !== true) continue;
      if (chords.some((chord) => matchChord(chord, event, platform))) return action;
    }
  }
  return null;
}

export interface DispatcherOptions {
  readonly handlers: Handlers;
  readonly platform: Platform;
  /** Where the event came from (./context.ts reads the page for it). */
  readonly context: (event: KeyboardEvent) => KeyContext;
  readonly actions?: readonly KeyAction[];
}

/** The listener for `keydown` that finds the action of an event and runs its handler. */
export function createDispatcher(options: DispatcherOptions): (event: KeyboardEvent) => void {
  const { handlers, platform, actions = KEY_ACTIONS } = options;
  return (event) => {
    if (event.defaultPrevented) return;
    const context = options.context(event);
    const action = findAction(event, context, platform, actions);
    if (action === null) return;
    const run = handlers[action.id];
    if (run === undefined) return;
    if (run(event, context) === false) return;
    event.preventDefault();
  };
}
