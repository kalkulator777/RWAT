import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { useRef, useState } from 'preact/hooks';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLang } from '../../i18n';
import { installKeys } from './wire';
import { KeysDialog } from './KeysDialog';
import { KeysPanel } from './KeysButton';
import { keysDialogOpen } from './state';
import { tabStops, trapTab, useModalDialog } from './modal';

beforeEach(() => {
  setLang('en');
  keysDialogOpen.value = false;
});

afterEach(() => {
  cleanup();
  keysDialogOpen.value = false;
  document.body.innerHTML = '';
  localStorage.clear();
});

/** A dialog of three stops: an input, a disabled button, a link with tabindex -1, then two buttons. */
function Probe({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useModalDialog(ref);
  return (
    <dialog
      ref={ref}
      data-testid="probe"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <input aria-label="name" />
      <button disabled>never</button>
      <a href="#x" tabIndex={-1}>skipped</a>
      <div hidden>
        <button>hidden</button>
      </div>
      <button>first</button>
      <button>last</button>
    </dialog>
  );
}

function Opener() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>open</button>
      {open && <Probe onClose={() => setOpen(false)} />}
    </>
  );
}

function tab(shift = false): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true });
}

describe('tabStops', () => {
  it('lists what Tab visits: enabled, shown, not taken out of the order', () => {
    render(<Probe onClose={() => undefined} />);
    expect(tabStops(screen.getByTestId('probe')).map((stop) => stop.textContent || stop.getAttribute('aria-label'))).toEqual(['name', 'first', 'last']);
  });
});

describe('a modal dialog', () => {
  it('opens when it appears and keeps Tab inside, wrapping from the last stop to the first and back', () => {
    render(<Opener />);
    const opener = screen.getByText('open');
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByTestId<HTMLDialogElement>('probe');
    expect(dialog.hasAttribute('open')).toBe(true);
    const [name, first, last] = [screen.getByLabelText('name'), screen.getByText('first'), screen.getByText('last')];

    last.focus();
    const forward = tab();
    dialog.dispatchEvent(forward);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(name);

    const back = tab(true);
    dialog.dispatchEvent(back);
    expect(back.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);

    // in the middle the key is the browser's
    first.focus();
    const middle = tab();
    dialog.dispatchEvent(middle);
    expect(middle.defaultPrevented).toBe(false);
    const withCtrl = new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, bubbles: true, cancelable: true });
    last.focus();
    dialog.dispatchEvent(withCtrl);
    expect(withCtrl.defaultPrevented).toBe(false);
  });

  it('brings the focus in when it is outside, and holds it when nothing inside can take it', () => {
    render(<Probe onClose={() => undefined} />);
    const dialog = screen.getByTestId('probe');
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    const forward = tab();
    expect(trapTab(dialog, forward)).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText('name'));
    outside.focus();
    expect(trapTab(dialog, tab(true))).toBe(true);
    expect(document.activeElement).toBe(screen.getByText('last'));
    const empty = document.createElement('dialog');
    document.body.append(empty);
    const held = tab();
    expect(trapTab(empty, held)).toBe(true);
    expect(held.defaultPrevented).toBe(true);
    expect(trapTab(dialog, new KeyboardEvent('keydown', { key: 'a' }))).toBe(false);
  });

  it('gives the focus back to the button that opened it when it closes', () => {
    render(<Opener />);
    const opener = screen.getByText('open');
    opener.focus();
    fireEvent.click(opener);
    screen.getByText('first').focus();
    expect(document.activeElement).toBe(screen.getByText('first'));
    // Escape: the browser asks the dialog to cancel
    fireEvent(screen.getByTestId('probe'), new Event('cancel', { cancelable: true }));
    expect(screen.queryByTestId('probe')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('does not fail when the button that opened it is gone', () => {
    render(<Opener />);
    const opener = screen.getByText('open');
    opener.focus();
    fireEvent.click(opener);
    opener.remove();
    expect(() => {
      cleanup();
    }).not.toThrow();
  });
});

describe('the Keys window', () => {
  it('opens on the question mark from where the focus is, lists the keys, closes on Escape and returns the focus', () => {
    render(<KeysPanel />);
    const off = installKeys(document, { platform: 'pc' });
    try {
      const outside = document.createElement('button');
      outside.textContent = 'somewhere';
      document.body.append(outside);
      outside.focus();
      fireEvent.keyDown(outside, { key: '?', shiftKey: true });
      expect(keysDialogOpen.value).toBe(true);
      const dialog = screen.getByTestId('keys-dialog');
      expect(dialog.getAttribute('aria-labelledby')).toBe('keys-dialog-title');
      expect(dialog.querySelector('#keys-dialog-title')?.textContent).toBe('Keyboard shortcuts');
      expect(dialog.querySelector('[data-action="edit.undo"] kbd')?.textContent).toBe('Ctrl+Z');
      expect(dialog.querySelectorAll('section[data-scope]')).toHaveLength(4);
      // a key under an open dialog is the dialog's: the question mark does not open a second one
      fireEvent.keyDown(dialog, { key: '?', shiftKey: true });
      expect(document.querySelectorAll('[data-testid="keys-dialog"]')).toHaveLength(1);
      fireEvent(dialog, new Event('cancel', { cancelable: true }));
      expect(keysDialogOpen.value).toBe(false);
      expect(screen.queryByTestId('keys-dialog')).toBeNull();
      expect(document.activeElement).toBe(outside);
    } finally {
      off();
    }
  });

  it('opens from the top bar’s button and says its keys in Russian', () => {
    setLang('ru');
    render(<KeysPanel />);
    const button = screen.getByTestId('keys-button');
    expect(button.getAttribute('aria-label')).toBe('Горячие клавиши');
    button.focus();
    fireEvent.click(button);
    const dialog = screen.getByTestId('keys-dialog');
    expect(dialog.querySelector('[data-action="edit.undo"] th')?.textContent).toBe('Отменить правку пака');
    fireEvent.click(screen.getByTestId('keys-close'));
    expect(keysDialogOpen.value).toBe(false);
    expect(document.activeElement).toBe(button);
  });

  it('does not open the question mark in a text field', () => {
    const off = installKeys(document, { platform: 'pc' });
    try {
      const input = document.createElement('input');
      document.body.append(input);
      input.focus();
      fireEvent.keyDown(input, { key: '?', shiftKey: true });
      expect(keysDialogOpen.value).toBe(false);
    } finally {
      off();
    }
  });

  it('is drawn on its own too', () => {
    render(<KeysDialog />);
    expect(screen.getByTestId('keys-dialog').hasAttribute('open')).toBe(true);
  });
});
