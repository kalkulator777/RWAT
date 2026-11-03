import { signal } from '@preact/signals';
import { t } from '../../i18n';
import {
  describeIoError,
  downloadBytes,
  isFsAccessSupported,
  PackIoError,
  pickFolderPack,
  pickFsAccessPack,
  pickZipPack,
  zipFileName,
  ZipSink,
  type PackSource,
} from '../../io';

/** What the last open found; the panel shows it. */
interface Opened {
  source: PackSource;
  count: number;
  bytes: number;
}

const opened = signal<Opened | null>(null);
const failure = signal<string | null>(null);

async function open(pick: () => Promise<PackSource | null>): Promise<void> {
  failure.value = null;
  try {
    const source = await pick();
    if (source === null) return;
    const files = await source.list();
    opened.value = { source, count: files.length, bytes: files.reduce((sum, file) => sum + file.size, 0) };
  } catch (error) {
    opened.value = null;
    if (error instanceof PackIoError) {
      const { key, params } = describeIoError(error);
      failure.value = t(key, params);
    } else {
      failure.value = error instanceof Error ? error.message : String(error);
    }
  }
}

async function saveZip(): Promise<void> {
  const current = opened.value;
  if (current === null) return;
  await new ZipSink(current.source, (zip) => {
    downloadBytes(zip.slice(), zipFileName(current.source.name), 'application/zip');
  }).write([]);
}

/**
 * Temporary panel of A1.2 (docs/proposals/editor.md §7, M1): opens a pack from a zip or
 * a folder and shows how many files it has, so the io/ module can be seen working
 * before the pack model and the real toolbar exist. The conductor deletes this folder
 * when the real "Open" and "Save" arrive.
 */
export function IoDevPanel() {
  const current = opened.value;
  return (
    <div class="io-dev" style={{ padding: '8px 12px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
      <button type="button" data-testid="io-open-zip" onClick={() => void open(pickZipPack)}>
        {t('iodev.openZip')}
      </button>
      <button type="button" data-testid="io-open-folder" onClick={() => void open(pickFolderPack)}>
        {t('iodev.openFolder')}
      </button>
      {isFsAccessSupported() && (
        <button type="button" data-testid="io-open-fs" onClick={() => void open(() => pickFsAccessPack())}>
          {t('iodev.openFs')}
        </button>
      )}
      <button type="button" data-testid="io-save-zip" disabled={current === null} onClick={() => void saveZip()}>
        {t('iodev.saveZip')}
      </button>
      {current !== null && (
        <p role="status" data-testid="io-status" data-kind={current.source.kind} data-count={current.count} data-bytes={current.bytes}>
          {t('iodev.status', { name: current.source.name, kind: current.source.kind, count: current.count, bytes: current.bytes })}
        </p>
      )}
      {failure.value !== null && (
        <p role="alert" data-testid="io-error">
          {failure.value}
        </p>
      )}
    </div>
  );
}
