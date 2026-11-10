import { useEffect, useState } from 'preact/hooks';
import type { Pack } from '../../core/pack';
import { t } from '../../i18n';
import { FsAccessSource, isFsAccessSupported } from '../../io';
import { homeOf } from '../../core/session';
import { savePack, downloadZip, type DeliverZip } from '../session';
import { failure, findings, pack, revision } from '../store';
import { changeDiff, listChanges, type ChangeItem } from './changes';
import { hunks, type LineDiff } from './diff';
import { Modal } from './Modal';
import { folderOf, saveTarget, zipNameOf } from './save';
import { saveDialogOpen, saveReport, type FolderReport } from './state';

/** Why the pack is saved where it is, as one sentence. */
function whereText(open: Pack): string {
  const file = zipNameOf(open);
  const home = homeOf(open.source);
  if (saveTarget(open) === 'folder') return t('save.where.folder', { name: home.name });
  if (home instanceof FsAccessSource && !open.readOnly) return t('save.where.zipNoWrite', { name: home.name, file });
  if (home.kind === 'dir-input') return t(isFsAccessSupported() ? 'save.where.zipReadonly' : 'save.where.zipNoFsAccess', { file });
  if (open.readOnly) return t('save.where.zipReadonly', { file });
  return t('save.where.zip', { file });
}

function Diff({ open, path }: { open: Pack; path: string }) {
  const [diff, setDiff] = useState<LineDiff | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void changeDiff(open, path).then((found) => {
      if (live) setDiff(found);
    });
    return () => {
      live = false;
    };
  }, [open, path, revision.value]);
  if (diff === undefined || diff === null) return null;
  if (diff.lines === null) return <p class="dialog-hint">{t('save.diffTooBig')}</p>;
  return (
    <pre class="save-diff" aria-label={t('save.diffLabel', { file: path })} data-testid="save-diff">
      {hunks(diff.lines).map((hunk, i) => (
        <span key={i}>
          {hunk.skipped > 0 && <span class="save-diff-skip">{`${t('save.diffSkipped', { count: hunk.skipped })}\n`}</span>}
          {hunk.lines.map((line, j) => (
            <span key={j} class={`save-diff-${line.kind}`} data-kind={line.kind}>
              {`${line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '} ${line.text}\n`}
            </span>
          ))}
        </span>
      ))}
    </pre>
  );
}

function ChangeRow({ open, item }: { open: Pack; item: ChangeItem }) {
  const [shown, setShown] = useState(false);
  const lines =
    item.added === null || item.removed === null
      ? t('save.binary')
      : t(item.exact ? 'save.lines' : 'save.linesApprox', { added: item.added, removed: item.removed });
  return (
    <li class="save-change" data-path={item.path} data-status={item.status}>
      <div class="save-change-row">
        <span class={`save-status save-status-${item.status}`}>{t(`save.status.${item.status}`)}</span>
        <code class="save-path">{item.path}</code>
        <span class="save-lines" data-testid="save-lines">
          {lines}
        </span>
        {item.kind !== 'binary' && (
          <button type="button" class="save-diff-toggle" aria-expanded={shown} onClick={() => setShown(!shown)}>
            {t(shown ? 'save.hideDiff' : 'save.showDiff')}
          </button>
        )}
      </div>
      {shown && <Diff open={open} path={item.path} />}
    </li>
  );
}

function Report({ report }: { report: FolderReport }) {
  return (
    <div class="dialog-errors save-report" role="alert" data-testid="save-report">
      <p>
        <strong>{t('save.report.title')}</strong>
      </p>
      <p>{report.failed !== null ? t('save.report.failed', { file: report.failed, detail: report.detail }) : t('save.report.detail', { detail: report.detail })}</p>
      <p>{t('save.report.written', { count: report.written.length + report.deleted.length })}</p>
      {(report.written.length > 0 || report.deleted.length > 0) && (
        <ul data-testid="save-report-done">
          {[...report.deleted, ...report.written].map((path) => (
            <li key={path}>
              <code>{path}</code>
            </li>
          ))}
        </ul>
      )}
      <p>{t('save.report.pending', { count: report.pending.length + (report.failed === null ? 0 : 1) })}</p>
      <ul data-testid="save-report-pending">
        {[...(report.failed === null ? [] : [report.failed]), ...report.pending].map((path) => (
          <li key={path}>
            <code>{path}</code>
          </li>
        ))}
      </ul>
      <p>{t('save.report.retry')}</p>
    </div>
  );
}

/**
 * The save dialog (editor.md §2.5, steps 3–4): what the save writes — new, changed and
 * deleted files, the lines each gains and loses and the text's difference on demand —,
 * where it goes (the folder, or a zip and why), and the reminder that a pack with errors
 * can be saved but the loader skips what is broken. A write into the folder that stops
 * part way is told here, file by file.
 */
export function SaveDialog({ deliver = downloadZip }: { deliver?: DeliverZip }) {
  void revision.value;
  const open = pack.value;
  const [items, setItems] = useState<ChangeItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open === null) return;
    let live = true;
    void listChanges(open).then((list) => {
      if (live) setItems(list);
    });
    return () => {
      live = false;
    };
  }, [open, revision.value]);
  if (open === null) return null;
  const close = (): void => {
    saveDialogOpen.value = false;
  };
  const save = async (target: 'folder' | 'zip'): Promise<void> => {
    setBusy(true);
    const saved = await savePack(deliver, target);
    setBusy(false);
    if (saved) close();
  };
  // the checks tab's findings: the pack is not checked again for the dialog
  const errors = findings.value.filter((problem) => problem.severity === 'error').length;
  const target = saveTarget(open);
  const folder = folderOf(open);
  const report = saveReport.value;
  const problem = failure.value;
  return (
    <Modal title={t('save.title')} testId="save-dialog" onClose={close} wide>
      <p class="dialog-hint" data-testid="save-where" data-target={target}>
        {whereText(open)}
      </p>
      <p class={errors > 0 ? 'dialog-warning' : 'dialog-hint'} data-testid="save-errors" data-count={errors}>
        {errors > 0 ? t('save.errors', { count: errors }) : t('save.noErrors')}
      </p>
      <h3 class="save-list-title">{t('save.list')}</h3>
      {items === null ? (
        <p class="dialog-hint">{t('save.busy')}</p>
      ) : items.length === 0 ? (
        <p class="dialog-hint" data-testid="save-none">
          {t('save.none')}
        </p>
      ) : (
        <ul class="save-changes" data-testid="save-changes">
          {items.map((item) => (
            <ChangeRow key={item.path} open={open} item={item} />
          ))}
        </ul>
      )}
      {report !== null && <Report report={report} />}
      {report === null && problem !== null && (
        <p class="dialog-errors" role="alert">
          {t(problem.key, problem.params)}
        </p>
      )}
      <div class="dialog-buttons">
        <button type="button" data-testid="save-close" onClick={close}>
          {t('save.close')}
        </button>
        {folder !== null && !folder.writable && !open.readOnly && (
          <button
            type="button"
            data-testid="save-allow"
            onClick={() => {
              void folder.requestWrite().then(() => {
                revision.value++;
              });
            }}
          >
            {t('save.allowWrite')}
          </button>
        )}
        <button type="button" class={target === 'zip' ? 'button-primary' : undefined} data-testid="save-zip" disabled={busy} onClick={() => void save('zip')}>
          {t('save.toZip')}
        </button>
        {target === 'folder' && (
          <button type="button" class="button-primary" data-testid="save-folder" disabled={busy} onClick={() => void save('folder')}>
            {t('save.toFolder')}
          </button>
        )}
      </div>
    </Modal>
  );
}
