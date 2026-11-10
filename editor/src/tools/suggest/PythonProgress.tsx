/**
 * What the author sees while a call of the Python tools lasts (docs/proposals/editor.md
 * §3.11): the first call of a page loads Pyodide — about 13 MB, a few seconds, once —, so the
 * download is shown with its size and the start of the interpreter after it; then the work
 * itself. A button stops the call (the bridge stops its worker, the next call starts a new one).
 */

import { formatNumber, t } from '../../i18n';
import type { Running } from './run';
import './suggest.css';

/** Bytes as the progress says them: megabytes to a tenth. */
function megabytes(bytes: number): string {
  return formatNumber(bytes / 2 ** 20, 1);
}

/** The progress of a call under way, and its «Отмена». */
export function PythonProgress({ running }: { running: Running }) {
  const progress = running.progress.value;
  const loading = progress.stage === 'download' || progress.stage === 'start';
  const known = progress.stage === 'download' && progress.total > 0;
  const text =
    progress.stage === 'download'
      ? t('tools.suggest.progress.download', { loaded: megabytes(progress.loaded), total: progress.total > 0 ? megabytes(progress.total) : '…' })
      : progress.stage === 'start'
        ? t('tools.suggest.progress.start')
        : t('tools.suggest.progress.work');
  return (
    <div class="suggest-progress" data-testid="suggest-progress" data-stage={progress.stage}>
      <span role="status" aria-live="polite" class="tool-note">
        {text}
      </span>
      {loading && known && <progress value={progress.loaded} max={progress.total} aria-label={t('tools.suggest.progress.label')} />}
      {loading && !known && <progress aria-label={t('tools.suggest.progress.label')} />}
      <button type="button" class="tool-button" data-action="suggest-cancel" onClick={() => running.cancel()}>
        {t('tools.suggest.cancel')}
      </button>
    </div>
  );
}
