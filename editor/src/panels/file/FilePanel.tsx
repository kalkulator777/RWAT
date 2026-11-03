import { openPicked, redo, savePack, undo } from '../../app/session';
import { canRedo, canUndo, dirtyCount, pack } from '../../app/store';
import { t } from '../../i18n';
import { isFsAccessSupported, pickFolderPack, pickFsAccessPack, pickZipPack } from '../../io';

/**
 * An arrow that turns back (undo) or, mirrored, forward (redo), drawn in the text's colour.
 * Decoration: the button carries the name.
 */
function TurnArrow(props: { forward?: boolean }) {
  return (
    <svg class="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" data-forward={props.forward === true}>
      <path
        d="M5.5 3.5 2 7l3.5 3.5M2 7h8a3.5 3.5 0 0 1 0 7H8"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

/**
 * The file buttons of the top bar (editor.md §6.1): open a zip or a folder, save with
 * the count of changed files, undo and redo. Keyboard: Ctrl+Z, Ctrl+Shift+Z, Ctrl+S
 * (app/session.ts `installShortcuts`). Undo and redo are arrows named by their label and
 * shortcut, so the bar keeps to one line at 1280 px in either language.
 */
export function FilePanel() {
  const open = pack.value;
  const changes = dirtyCount.value;
  return (
    <div class="file-actions">
      <button type="button" data-testid="open-zip" onClick={() => void openPicked(pickZipPack)}>
        {t('file.openZip')}
      </button>
      {isFsAccessSupported() && (
        <button type="button" data-testid="open-folder" onClick={() => void openPicked(() => pickFsAccessPack())}>
          {t('file.openFolder')}
        </button>
      )}
      <button type="button" data-testid="open-folder-readonly" onClick={() => void openPicked(pickFolderPack)}>
        {t('file.openFolderReadonly')}
      </button>
      <button type="button" data-testid="save" disabled={open === null} onClick={() => void savePack()}>
        {changes > 0 ? t('file.saveCount', { count: changes }) : t('file.save')}
      </button>
      <button
        type="button"
        class="icon-button"
        data-testid="undo"
        aria-label={t('file.undo')}
        title={`${t('file.undo')} (Ctrl+Z)`}
        disabled={!canUndo.value}
        onClick={undo}
      >
        <TurnArrow />
      </button>
      <button
        type="button"
        class="icon-button"
        data-testid="redo"
        aria-label={t('file.redo')}
        title={`${t('file.redo')} (Ctrl+Shift+Z)`}
        disabled={!canRedo.value}
        onClick={redo}
      >
        <TurnArrow forward />
      </button>
    </div>
  );
}
