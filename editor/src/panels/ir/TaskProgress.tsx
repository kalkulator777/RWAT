import { irTask, type IrTask } from '../../app/ir';
import { formatNumber, t } from '../../i18n';

const MB = 2 ** 20;

/** What the work under way is doing now, in a line: Pyodide downloading (so much of so much), starting, the converter at work. */
export function taskLine(task: IrTask): string {
  const { progress } = task;
  if (progress.stage === 'download') {
    return progress.total > 0
      ? t('ir.task.download', { loaded: formatNumber(Math.round((progress.loaded / MB) * 10) / 10), total: formatNumber(Math.round((progress.total / MB) * 10) / 10) })
      : t('ir.task.downloadUnknown');
  }
  if (progress.stage === 'start') return t('ir.task.start');
  return t(`ir.task.${task.kind}`, { lines: task.lines });
}

/**
 * The long work of the IR mode under way (editor.md §2.6, step 2): Pyodide's download as a
 * bar (about 13 MB the first time, then from the browser's cache), its start, then the
 * converter at work with the last line it printed; a button stops it (the worker doing it
 * is stopped). A screen reader hears the stage change, not every line.
 */
export function TaskProgress({ kind }: { kind?: IrTask['kind'] }) {
  const task = irTask.value;
  if (task === null || (kind !== undefined && task.kind !== kind)) return null;
  const { progress } = task;
  const downloading = progress.stage === 'download' && progress.total > 0;
  return (
    <div class="ir-task" data-testid="ir-task" data-kind={task.kind} data-stage={progress.stage}>
      <p class="ir-task-line" role="status" aria-live="polite">
        {taskLine(task)}
      </p>
      {downloading ? (
        <progress class="ir-task-bar" value={progress.loaded} max={progress.total} aria-label={t('ir.task.bar')} />
      ) : (
        <progress class="ir-task-bar" aria-label={t('ir.task.bar')} />
      )}
      {task.last !== '' && (
        <p class="ir-task-last" title={task.last}>
          <code>{task.last}</code>
        </p>
      )}
      <button type="button" data-testid="ir-task-cancel" onClick={() => task.cancel()}>
        {t('ir.task.cancel')}
      </button>
    </div>
  );
}
