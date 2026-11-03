import { openPicked, redo, savePack, undo } from '../../app/session';
import { canRedo, canUndo, dirtyCount, pack } from '../../app/store';
import { t } from '../../i18n';
import { isFsAccessSupported, pickFolderPack, pickFsAccessPack, pickZipPack } from '../../io';

/**
 * The file buttons of the top bar (editor.md §6.1): open a zip or a folder, save with
 * the count of changed files, undo and redo. Keyboard: Ctrl+Z, Ctrl+Shift+Z, Ctrl+S
 * (app/session.ts `installShortcuts`).
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
      <button type="button" data-testid="undo" disabled={!canUndo.value} onClick={undo}>
        {t('file.undo')}
      </button>
      <button type="button" data-testid="redo" disabled={!canRedo.value} onClick={redo}>
        {t('file.redo')}
      </button>
    </div>
  );
}
