import type { ComponentChildren } from 'preact';
import { useRef } from 'preact/hooks';
import { useModalDialog } from '../keys/modal';

/**
 * A modal dialog of this module (the browser's own `<dialog>`: Tab stays inside, Escape
 * calls `onClose` when given, the focus goes back to where it was when the dialog closes:
 * app/keys/modal.ts). The buttons are the caller's.
 */
export function Modal(props: { title: string; testId: string; onClose?: () => void; children: ComponentChildren; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useModalDialog(ref);
  const titleId = `${props.testId}-title`;
  return (
    <dialog
      ref={ref}
      class={props.wide === true ? 'dialog save-dialog' : 'dialog'}
      aria-labelledby={titleId}
      data-testid={props.testId}
      onCancel={(event) => {
        event.preventDefault();
        props.onClose?.();
      }}
    >
      <div class="dialog-form">
        <h2 id={titleId} class="dialog-title">
          {props.title}
        </h2>
        {props.children}
      </div>
    </dialog>
  );
}
