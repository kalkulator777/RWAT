/**
 * Saving and the session (editor.md §2.5 steps 3–4, §3.6, M5): the save dialog with the
 * list of changes, writing into the folder or a zip, the save point in the window's title
 * and the warning when a tab with unsaved work closes, the session kept in IndexedDB and
 * offered for restoring at start.
 */

import { effect } from '@preact/signals';
import { t } from '../../i18n';
import { dirtyCount, pack } from '../store';
import { keeper } from './keep';
import { checkKeptSession } from './restore';
import { RestoreDialog } from './RestoreDialog';
import { SaveDialog } from './SaveDialog';
import { saveDialogOpen } from './state';
import './save.css';

export { keeperStatus, openSaveDialog, saveDialogOpen } from './state';

/** The window's title: a mark while there are unsaved changes, the pack's name, the editor's. */
export function windowTitle(): string {
  const open = pack.value;
  const editor = t('shell.title');
  if (open === null) return editor;
  return `${dirtyCount.value > 0 ? '● ' : ''}${open.source.name} — ${editor}`;
}

/** The dialogs of this module, wherever the shell puts them: the save dialog while it is open, the restore question at start. */
export function SaveDialogs() {
  return (
    <>
      {saveDialogOpen.value && pack.value !== null && <SaveDialog />}
      <RestoreDialog />
    </>
  );
}

/**
 * Starts the module in the page: the title follows the save point, closing a tab with
 * unsaved changes asks first, the session is written when the page is hidden, and a kept
 * session is offered. Returns the function that stops it (the tests').
 */
export function startSave(target: Window = window): () => void {
  const stopTitle = effect(() => {
    target.document.title = windowTitle();
  });
  const onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (dirtyCount.value === 0) return;
    event.preventDefault();
    event.returnValue = ''; // older Chromium asks only when this is set
  };
  const onHide = (): void => {
    if (target.document.visibilityState === 'hidden') void keeper().flush();
  };
  target.addEventListener('beforeunload', onBeforeUnload);
  target.document.addEventListener('visibilitychange', onHide);
  void checkKeptSession();
  return () => {
    stopTitle();
    target.removeEventListener('beforeunload', onBeforeUnload);
    target.document.removeEventListener('visibilitychange', onHide);
  };
}
