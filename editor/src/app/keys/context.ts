/**
 * Where a key press came from, read off the page for the dispatcher (./dispatch.ts):
 * whether the focus is in a text field, whether a modal dialog is open, which part of the
 * screen holds the focus.
 *
 * Typing is tracked too: a text field whose text was typed into and not yet committed
 * (an `input` event not followed by a `change` or by leaving the field) is "edited", and its
 * Ctrl+Z is the field's own undo of the typing; a field with nothing uncommitted passes
 * Ctrl+Z on to the pack's undo (see `typing: 'clean'` in ./actions.ts).
 *
 * Parts of the screen mark themselves with attributes, so that no class name is read here:
 * - `data-keys-scope="view"` — the 3D view's panel (the keys of the view work in all of it);
 * - `data-keys-scope="tool"` — a place where the keys of a tool that is on work (the
 *   view's panel and the tool's section of the inspector);
 * - `data-roving="tree"` or `"list"` — a tree or a list whose items the arrows move
 *   between (./roving.ts).
 */

import type { KeyContext } from './dispatch';

/** The `type`s of an `<input>` whose keys are text. */
const TEXT_TYPES = new Set(['', 'text', 'search', 'number', 'email', 'url', 'tel', 'password', 'date', 'datetime-local', 'month', 'time', 'week']);

/**
 * True for a place where the keys are the user's text: a text box or text area, a
 * drop-down list (its letters pick an entry), an editable element. A check box, a radio
 * button, a slider or a button is not: the keys of the editor work with the focus on them.
 */
export function isTextEntry(target: EventTarget | null): boolean {
  const element = target as { tagName?: string; type?: string; isContentEditable?: boolean } | null;
  if (element === null || typeof element !== 'object') return false;
  if (element.isContentEditable === true) return true;
  switch (element.tagName) {
    case 'TEXTAREA':
    case 'SELECT':
      return true;
    case 'INPUT':
      return TEXT_TYPES.has((element.type ?? '').toLowerCase());
    default:
      return false;
  }
}

/** The text fields with typing that is not committed yet. */
const edited = new WeakSet<EventTarget>();

/**
 * Starts tracking the typing in text fields on `target` (the page): returns the function that
 * stops it. A field is edited from its first `input` until its `change` (Enter, or leaving a
 * field whose text differs), until Escape or until the focus leaves it.
 */
export function watchEdits(target: EventTarget): () => void {
  const mark = (event: Event): void => {
    if (event.target !== null) edited.add(event.target);
  };
  const clear = (event: Event): void => {
    if (event.target !== null) edited.delete(event.target);
  };
  // a field that brings its old text back on Escape has nothing uncommitted left
  const escape = (event: Event): void => {
    if ((event as KeyboardEvent).key === 'Escape') clear(event);
  };
  target.addEventListener('input', mark);
  target.addEventListener('change', clear);
  target.addEventListener('focusout', clear);
  target.addEventListener('keydown', escape);
  return () => {
    target.removeEventListener('input', mark);
    target.removeEventListener('change', clear);
    target.removeEventListener('focusout', clear);
    target.removeEventListener('keydown', escape);
  };
}

/** The element a key press came from, or null when it came from the page itself. */
function elementOf(target: EventTarget | null): Element | null {
  const node = target as { closest?: unknown } | null;
  return node !== null && typeof node.closest === 'function' ? (target as Element) : null;
}

/** The context of a key press: `toolOn` says whether a markup tool is on (the tool host knows). */
export function contextOf(event: Event, toolOn: boolean, doc: Document = document): KeyContext {
  const target = event.target;
  const element = elementOf(target);
  const roving = element?.closest('[data-roving]')?.getAttribute('data-roving');
  return {
    typing: isTextEntry(target),
    edited: target !== null && edited.has(target),
    modal: doc.querySelector('dialog[open]') !== null,
    view: element?.closest('[data-keys-scope~="view"]') != null,
    tool: toolOn && element?.closest('[data-keys-scope~="tool"]') != null,
    list: roving === 'tree' || roving === 'list' ? roving : null,
  };
}
