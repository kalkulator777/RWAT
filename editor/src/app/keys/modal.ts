/**
 * What every modal window of the editor does about the focus (docs/proposals/editor.md
 * §6.3): it opens as the browser's own modal `<dialog>` (the page behind it is inert, Escape
 * asks it to close), Tab and Shift+Tab go round inside it and never out into the page or
 * the browser's bar, and when it closes the focus goes back to where it was when it
 * opened — the button that opened it, or the place the `?` key was pressed at.
 *
 * {@link useModalDialog} is for a `<dialog ref={…}>` that the component mounts only while
 * it is open: the dialog opens when the component mounts and closes when it unmounts.
 */

import type { RefObject } from 'preact';
import { useEffect } from 'preact/hooks';

/** What Tab can reach. */
const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]';

/** The elements of a root that Tab visits, in order: enabled, not hidden, not taken out of the order by `tabindex="-1"`. */
export function tabStops(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => {
    const index = element.getAttribute('tabindex');
    if (element.hasAttribute('disabled') || (index !== null && Number(index) < 0) || element.closest('[hidden], [inert]') !== null) return false;
    return !(element.tagName === 'INPUT' && element.getAttribute('type') === 'hidden');
  });
}

/**
 * Keeps Tab inside `dialog`: from the last stop it goes to the first, back from the first to
 * the last. Returns true if it took the key.
 */
export function trapTab(dialog: HTMLElement, event: KeyboardEvent): boolean {
  if (event.key !== 'Tab' || event.ctrlKey || event.metaKey || event.altKey) return false;
  const stops = tabStops(dialog);
  const first = stops[0];
  const last = stops.at(-1);
  if (first === undefined || last === undefined) {
    // nothing to focus (a dialog that only says "wait"): the key stays here
    event.preventDefault();
    return true;
  }
  const active = dialog.ownerDocument.activeElement;
  const outside = active === null || !dialog.contains(active) || active === dialog;
  if (event.shiftKey ? active === first || outside : active === last || outside) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
    return true;
  }
  return false;
}

/** Puts the focus back on `element` if it is still on the page. */
function restoreFocus(element: HTMLElement | null): void {
  if (element !== null && element.isConnected && typeof element.focus === 'function') element.focus({ preventScroll: true });
}

/**
 * Opens the dialog when the component mounts, keeps Tab inside it, and on unmount closes it
 * and returns the focus to the element that had it at the start.
 */
export function useModalDialog(ref: RefObject<HTMLDialogElement>): void {
  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    const opener = dialog.ownerDocument.activeElement as HTMLElement | null;
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      trapTab(dialog, event);
    };
    dialog.addEventListener('keydown', onKeyDown);
    return () => {
      dialog.removeEventListener('keydown', onKeyDown);
      // the page behind a modal dialog is inert: it has to close before the focus can go back
      if (dialog.open) {
        if (typeof dialog.close === 'function') dialog.close();
        else dialog.removeAttribute('open');
      }
      restoreFocus(opener);
    };
  }, []);
}
