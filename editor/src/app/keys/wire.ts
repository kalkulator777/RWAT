/**
 * What each action of the key map does (./actions.ts): the handlers by action id, and
 * {@link installKeys}, which puts the dispatcher (./dispatch.ts) on the page. The shell
 * calls it once (app/start.ts); the handlers use the editor's own functions and signals —
 * the same ones its buttons use — so a key and a click are one code path.
 */

import { problemMessage } from '../../checks/messages';
import type { Link } from '../../core/contracts';
import { t } from '../../i18n';
import { shownFindings } from '../../panels/checks/findings';
import { toolHost } from '../../tools';
import { view } from '../../view3d/state';
import { openSaveDialog } from '../save/state';
import { redo, undo } from '../session';
import { pack, schema, selection } from '../store';
import { KEY_ACTIONS } from './actions';
import { announce } from './announce';
import { detectPlatform, type Platform } from './chords';
import { contextOf, watchEdits } from './context';
import { createDispatcher, type ActionHandler, type Handlers, type KeyContext } from './dispatch';
import { isNativeControl, itemOf, moveFocus, treeCollapse, treeExpand, type RovingMove } from './roving';
import { keysDialogOpen } from './state';

/** The bottom area's tabs, in order; their tab list is marked `data-slot="bottom"` (app/SlotTabs.tsx). */
const BOTTOM_TABS = '[role="tablist"][data-slot="bottom"] [role="tab"]';

/** Two lists of links point at the same places. */
function sameLinks(a: readonly Link[], b: readonly Link[]): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/** Selects the place of the next (`1`) or previous (`-1`) finding that points anywhere, as a click on it in the checks tab does. */
function stepFinding(step: 1 | -1): boolean {
  const list = shownFindings.value.filter((problem) => problem.at.length > 0);
  if (list.length === 0) {
    announce(t('keys.announce.noFindings'));
    return true;
  }
  const here = list.findIndex((problem) => sameLinks(problem.at, selection.value));
  const index = here < 0 ? (step > 0 ? 0 : list.length - 1) : (here + step + list.length) % list.length;
  const problem = list[index] as (typeof list)[number];
  selection.value = problem.at;
  toolHost.reveal(problem.at);
  announce(t('keys.announce.finding', { index: index + 1, count: list.length, text: problemMessage(problem, { pack: pack.value, schema: schema.value }) }));
  return true;
}

/** Goes to the next (`1`) or previous (`-1`) tab of the bottom area, wrapping round, and puts the focus on it. */
function stepBottomTab(step: 1 | -1): boolean {
  const tabs = [...document.querySelectorAll<HTMLElement>(BOTTOM_TABS)];
  if (tabs.length < 2) return false;
  const at = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
  const next = tabs[(at + step + tabs.length) % tabs.length] as HTMLElement;
  next.click();
  next.focus();
  return true;
}

/** Turns a tool on, or off when it is on already (`null`: the plain selection), as its button in the view's bar does. */
function useTool(id: string | null): ActionHandler {
  return () => {
    if (id === null) {
      toolHost.use(null);
      announce(t('keys.announce.tool', { name: t('tools.select') }));
      return;
    }
    const tool = toolHost.tools.find((candidate) => candidate.id === id);
    if (tool === undefined) return false;
    const on = toolHost.active.value === id;
    if (!on && !toolHost.canUse(tool)) {
      announce(t('keys.announce.toolUnavailable', { name: t(tool.title) }));
      return;
    }
    toolHost.use(on ? null : id);
    announce(t('keys.announce.tool', { name: on ? t('tools.select') : t(tool.title) }));
  };
}

/** An arrow, Home or End on an item of a tree or a list. */
function moveList(move: RovingMove): ActionHandler {
  return (event) => {
    const item = itemOf(event.target);
    return item === null ? false : moveFocus(item, move);
  };
}

const EDITOR_HANDLERS: Handlers = {
  'file.save': () => {
    if (pack.value !== null) openSaveDialog();
  },
  'edit.undo': () => undo(),
  'edit.redo': () => redo(),
  'help.keys': () => {
    keysDialogOpen.value = true;
  },
  'selection.clear': (event) => {
    // an open menu closes first (the layers menu of the view)
    const menu = (event.target as Element | null)?.closest?.('details[open]');
    if (menu != null) {
      menu.removeAttribute('open');
      menu.querySelector<HTMLElement>('summary')?.focus();
      return;
    }
    if (selection.value.length > 0) {
      selection.value = [];
      announce(t('keys.announce.cleared'));
      return;
    }
    if (toolHost.active.value === null) return false;
    toolHost.use(null);
    announce(t('keys.announce.tool', { name: t('tools.select') }));
  },
  'findings.next': () => stepFinding(1),
  'findings.prev': () => stepFinding(-1),
  'bottom.next': () => stepBottomTab(1),
  'bottom.prev': () => stepBottomTab(-1),
  'view.camera.orbit': () => view.setCamera('orbit'),
  'view.camera.side': () => view.setCamera('side'),
  'view.camera.front': () => view.setCamera('front'),
  'view.camera.top': () => view.setCamera('top'),
  'view.frame.all': () => view.requestFraming('all'),
  'view.frame.selected': () => view.requestFraming('selected'),
  'tool.use.select': useTool(null),
  'tool.use.floor': useTool('floor'),
  'tool.use.doors': useTool('doors'),
  'tool.use.seats': useTool('seats'),
  'tool.use.lights': useTool('lights'),
  'tool.use.pivots': useTool('pivots'),
  'tool.delete': () => {
    const removed = toolHost.current.value?.session.removeSelected?.() ?? false;
    if (removed) announce(t('keys.announce.deleted'));
    return removed;
  },
  'list.next': moveList('next'),
  'list.prev': moveList('prev'),
  'list.first': moveList('first'),
  'list.last': moveList('last'),
  'list.activate': (event) => {
    const item = itemOf(event.target);
    // a button or a link does it by itself; a tree's item is a plain element and is clicked here
    if (item === null || isNativeControl(item) || event.target !== item) return false;
    item.click();
  },
  'tree.expand': (event) => {
    const item = itemOf(event.target);
    return item === null || event.target !== item ? false : treeExpand(item);
  },
  'tree.collapse': (event) => {
    const item = itemOf(event.target);
    return item === null || event.target !== item ? false : treeCollapse(item);
  },
};

/** The handlers of the editor by action id: one for every action of the key map that the dispatcher runs. */
export const editorHandlers: Handlers = EDITOR_HANDLERS;

/** The action ids the dispatcher runs: the map's rows that no widget handles itself. */
export function dispatchedActions(): string[] {
  return KEY_ACTIONS.filter((action) => action.widget === undefined).map((action) => action.id);
}

export interface InstallOptions {
  /** The handlers to run; the editor's by default. */
  handlers?: Handlers;
  /** The platform whose keys apply; the browser's by default. */
  platform?: Platform;
  /** Where the key came from; read off the page by default. */
  context?: (event: KeyboardEvent) => KeyContext;
}

/**
 * Puts the editor's one key handler on `target` (the page): returns the function that takes
 * it off. A key goes through the key map (./actions.ts) to the handler of its action.
 */
export function installKeys(target: EventTarget = document, options: InstallOptions = {}): () => void {
  const listener = createDispatcher({
    handlers: options.handlers ?? editorHandlers,
    platform: options.platform ?? detectPlatform(),
    context: options.context ?? ((event) => contextOf(event, toolHost.current.value !== null)),
  });
  const stopWatching = watchEdits(target);
  target.addEventListener('keydown', listener as EventListener);
  return () => {
    stopWatching();
    target.removeEventListener('keydown', listener as EventListener);
  };
}
