import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

/**
 * A modal dialog of this module (the browser's own `<dialog>`: focus stays inside, Escape
 * calls `onClose` when given). The buttons are the caller's.
 */
export function Modal(props: { title: string; testId: string; onClose?: () => void; children: ComponentChildren; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog !== null && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
  }, []);
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
