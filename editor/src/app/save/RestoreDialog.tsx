import { t } from '../../i18n';
import { Modal } from './Modal';
import { discardKept, postponeRestore, restoreAnyway, restoreKept } from './restore';
import { restoreState } from './state';

/** At most this many paths are named in a line; the rest are counted. */
const NAMED = 5;

function paths(list: readonly string[]): string {
  return list.length > NAMED ? `${list.slice(0, NAMED).join(', ')} (+${list.length - NAMED})` : list.join(', ');
}

function when(time: number): string {
  const date = new Date(time);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * The question at start (editor.md §2.2 step 5, M5): unsaved work of the last visit is
 * kept — restore it or start afresh; files that changed since are named before anything
 * is replayed over them; a session of another editor version can only be dropped.
 */
export function RestoreDialog() {
  const state = restoreState.value;
  if (state === null) return null;
  const discard = (
    <button type="button" data-testid="restore-discard" onClick={() => void discardKept()}>
      {t('save.restore.discard')}
    </button>
  );
  if (state.step === 'incompatible') {
    return (
      <Modal title={t('save.restore.title')} testId="restore-dialog">
        <p data-testid="restore-text" data-step={state.step}>
          {t('save.restore.incompatible')}
        </p>
        <div class="dialog-buttons">{discard}</div>
      </Modal>
    );
  }
  if (state.step === 'busy') {
    return (
      <Modal title={t('save.restore.title')} testId="restore-dialog">
        <p data-testid="restore-text" data-step={state.step} aria-live="polite">
          {t('save.restore.busy')}
        </p>
      </Modal>
    );
  }
  if (state.step === 'failed') {
    return (
      <Modal title={t('save.restore.title')} testId="restore-dialog" onClose={postponeRestore}>
        <p class="dialog-errors" role="alert" data-testid="restore-text" data-step={state.step}>
          {t(state.key, state.params)}
        </p>
        <div class="dialog-buttons">
          <button type="button" data-testid="restore-later" onClick={postponeRestore}>
            {t('save.restore.later')}
          </button>
          {discard}
        </div>
      </Modal>
    );
  }
  const { record } = state;
  if (state.step === 'changed') {
    const { changes } = state;
    return (
      <Modal title={t('save.restore.title')} testId="restore-dialog" onClose={postponeRestore}>
        <p class="dialog-warning" data-testid="restore-text" data-step={state.step}>
          {t('save.restore.changed')}
        </p>
        <ul class="save-changed-files" data-testid="restore-changes">
          {changes.changed.length > 0 && <li>{t('save.restore.changedFiles', { files: paths(changes.changed) })}</li>}
          {changes.added.length > 0 && <li>{t('save.restore.addedFiles', { files: paths(changes.added) })}</li>}
          {changes.removed.length > 0 && <li>{t('save.restore.removedFiles', { files: paths(changes.removed) })}</li>}
        </ul>
        <div class="dialog-buttons">
          {discard}
          <button type="button" class="button-primary" data-testid="restore-anyway" onClick={() => void restoreAnyway()}>
            {t('save.restore.anyway')}
          </button>
        </div>
      </Modal>
    );
  }
  const reopen = record.reopen !== null;
  return (
    <Modal title={t('save.restore.title')} testId="restore-dialog" onClose={postponeRestore}>
      <p data-testid="restore-text" data-step={state.step}>
        {t('save.restore.offer', { name: record.name, count: record.dirty, time: when(record.updated) })}
      </p>
      {record.base === 'folder' && <p class="dialog-hint">{t('save.restore.folder')}</p>}
      {record.reopen !== null && <p class="dialog-hint">{t(record.reopen === 'zip' ? 'save.restore.reopenZip' : 'save.restore.reopenFolder', { name: record.name })}</p>}
      <div class="dialog-buttons">
        <button type="button" data-testid="restore-later" onClick={postponeRestore}>
          {t('save.restore.later')}
        </button>
        {discard}
        <button type="button" class="button-primary" data-testid="restore-session" onClick={() => void restoreKept()}>
          {t(reopen ? 'save.restore.reopen' : 'save.restore.restore')}
        </button>
      </div>
    </Modal>
  );
}
