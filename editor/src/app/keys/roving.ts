/**
 * Moving between the items of a tree or a list with the arrow keys (docs/proposals/editor.md
 * §6.3). A container marks itself `data-roving="tree"` or `"list"`, its items
 * `data-roving-item`; the dispatcher (./dispatch.ts) calls these when an arrow, Home, End,
 * Enter or Space comes from an item, and no component listens for them itself.
 *
 * Long lists are one stop of the Tab key, not one per item ("roving tabindex"): an item
 * takes `tabIndex` 0 when it is the one to land on and -1 otherwise, and {@link useRoving}
 * keeps count of which. Short lists may leave every item a stop of its own and use the
 * attributes alone.
 *
 * A tree adds Right and Left: Right opens a closed branch, then goes to its first child;
 * Left closes an open branch, then goes to the parent. A branch opens and closes by a
 * click on it (`aria-expanded` says which), so the keys do the same.
 */

import { useState } from 'preact/hooks';

/** Where the arrows go from an item. */
export type RovingMove = 'next' | 'prev' | 'first' | 'last';

/** The index an arrow goes to from `index` among `count` items: it stops at the ends, it does not wrap. */
export function movedIndex(move: RovingMove, index: number, count: number): number {
  if (count <= 0) return -1;
  switch (move) {
    case 'first':
      return 0;
    case 'last':
      return count - 1;
    case 'next':
      return Math.min(index + 1, count - 1);
    case 'prev':
      return Math.max(index - 1, 0);
  }
}

/** The item a place is, or is inside; null for a place outside every item. */
export function itemOf(target: EventTarget | null): HTMLElement | null {
  const node = target as { closest?: (selector: string) => Element | null } | null;
  return typeof node?.closest === 'function' ? (node.closest('[data-roving-item]') as HTMLElement | null) : null;
}

/** The items of a container in the order shown that can take the focus (a disabled one cannot). */
export function rovingItems(container: Element): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-roving-item]')].filter(
    (item) => !item.hasAttribute('disabled') && item.getAttribute('aria-disabled') !== 'true' && item.closest('[hidden]') === null,
  );
}

function containerOf(item: HTMLElement): HTMLElement | null {
  return item.closest<HTMLElement>('[data-roving]');
}

/** Moves the focus from `item` along its container's items; false when the item is in none. */
export function moveFocus(item: HTMLElement, move: RovingMove): boolean {
  const container = containerOf(item);
  if (container === null) return false;
  const items = rovingItems(container);
  const at = items.indexOf(item);
  if (at < 0) return false;
  const next = items[movedIndex(move, at, items.length)];
  if (next !== undefined && next !== item) next.focus();
  return true;
}

function level(item: HTMLElement): number {
  return Number(item.getAttribute('aria-level') ?? '1');
}

/** The branch a tree item hangs from: the nearest item before it that is one level up; null at the top. */
export function treeParent(items: readonly HTMLElement[], item: HTMLElement): HTMLElement | null {
  const at = items.indexOf(item);
  for (let i = at - 1; i >= 0; i--) {
    if (level(items[i] as HTMLElement) < level(item)) return items[i] as HTMLElement;
  }
  return null;
}

/** Right in a tree: opens a closed branch, goes into an open one, does nothing on a leaf. */
export function treeExpand(item: HTMLElement): boolean {
  const container = containerOf(item);
  if (container === null) return false;
  const expanded = item.getAttribute('aria-expanded');
  if (expanded === 'false') {
    item.click();
  } else if (expanded === 'true') {
    const items = rovingItems(container);
    const child = items[items.indexOf(item) + 1];
    if (child !== undefined && level(child) > level(item)) child.focus();
  }
  return true;
}

/** Left in a tree: closes an open branch, else goes to the parent. */
export function treeCollapse(item: HTMLElement): boolean {
  const container = containerOf(item);
  if (container === null) return false;
  if (item.getAttribute('aria-expanded') === 'true') {
    item.click();
  } else {
    treeParent(rovingItems(container), item)?.focus();
  }
  return true;
}

/** True for an element the browser activates by Enter or Space by itself. */
export function isNativeControl(element: Element): boolean {
  return ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY'].includes(element.tagName);
}

/**
 * The tab stop of a long list or tree: `props(key)` are the attributes of the item `key`;
 * `active` is the key that holds the stop — the last item focused, else `preferred` (the
 * selected one), else the first. A key that is no longer in the list gives the stop back.
 */
export function useRoving(keys: readonly string[], preferred: string | null = null): { active: string | null; props: (key: string) => { 'data-roving-item': string; tabIndex: number; onFocus: () => void } } {
  const [last, setLast] = useState<string | null>(null);
  const active = last !== null && keys.includes(last) ? last : preferred !== null && keys.includes(preferred) ? preferred : (keys[0] ?? null);
  return {
    active,
    props: (key) => ({ 'data-roving-item': key, tabIndex: key === active ? 0 : -1, onFocus: () => setLast(key) }),
  };
}
