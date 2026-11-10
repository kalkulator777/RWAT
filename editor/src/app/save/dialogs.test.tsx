import { cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemorySource, readTree } from '../../core/pack/testing.node';
import { createSchema } from '../../core/schema';
import { readSchemaFiles } from '../../core/schema/files.node';
import { MemoryStore } from '../../core/session';
import { setLang } from '../../i18n';
import { FsAccessSource, openZipSource } from '../../io';
import { FakeDirectory } from '../../io/testPack.node';
import { EXAMPLE_PACK } from '../../testing/repo.node';
import { installShortcuts, openSource } from '../session';
import { failure, journal, pack, revision, schema, selection } from '../store';
import { SaveDialogs, startSave, windowTitle } from '.';
import { sessionSettled, useSessionStore } from './keep';
import { SaveDialog } from './SaveDialog';
import { restoreState, saveDialogOpen, saveReport } from './state';

const COACH = 'data/rwat_example/wagon_types/coach.json';
const files = readTree(EXAMPLE_PACK);
let store: MemoryStore;

// the example pack is read and compared in these tests: give a loaded machine time
configure({ asyncUtilTimeout: 5000 });

function reset(): void {
  pack.value = null;
  journal.value = null;
  schema.value = null;
  failure.value = null;
  saveReport.value = null;
  restoreState.value = null;
  saveDialogOpen.value = false;
  selection.value = [];
  revision.value = 0;
}

beforeEach(() => {
  reset();
  setLang('en');
  store = new MemoryStore();
  useSessionStore(store, { delay: 0 });
});

afterEach(() => {
  cleanup();
  reset();
  localStorage.clear();
});

const mass = (value: unknown) => ({ label: 'edit', ops: [{ op: 'set' as const, file: COACH, at: '/mass_t', value }] });

describe('the save dialog', () => {
  it('lists the one changed file with its lines, shows its difference, says the errors and saves a zip', async () => {
    schema.value = createSchema(readSchemaFiles());
    await openSource(new MemorySource(files, 'RwatExamplePack'));
    await journal.value?.run(mass('heavy'));
    const delivered: { zip: Uint8Array; name: string }[] = [];
    render(<SaveDialog deliver={(zip, name) => void delivered.push({ zip, name })} />);
    const rows = await screen.findAllByRole('listitem');
    expect(rows.map((row) => row.getAttribute('data-path'))).toEqual([COACH]);
    expect(rows[0]?.getAttribute('data-status')).toBe('changed');
    expect(screen.getByTestId('save-lines').textContent).toBe('+1 −1');
    await waitFor(() => expect(screen.getByTestId('save-errors').getAttribute('data-count')).toBe('1'));
    expect(screen.getByTestId('save-errors').textContent).toContain('skips the files with errors');
    expect(screen.getByTestId('save-where').getAttribute('data-target')).toBe('zip');
    expect(screen.queryByTestId('save-folder')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Difference' }));
    const diff = await screen.findByTestId('save-diff');
    expect([...diff.querySelectorAll('[data-kind="del"], [data-kind="add"]')].map((line) => line.textContent)).toEqual([
      '−   "mass_t": 42.0,\n',
      '+   "mass_t": "heavy",\n',
    ]);
    saveDialogOpen.value = true;
    fireEvent.click(screen.getByTestId('save-zip'));
    await waitFor(() => expect(delivered).toHaveLength(1));
    expect(delivered[0]?.name).toBe('RwatExamplePack.zip');
    const zipped = await openZipSource(delivered[0]?.zip as Uint8Array, 'x.zip');
    expect(new TextDecoder().decode(await zipped.read(COACH))).toContain('"mass_t": "heavy"');
    await waitFor(() => expect(saveDialogOpen.value).toBe(false));
  });

  it('writes into a folder opened for writing, offers asking for the permission when it was refused, and tells a write that stopped', async () => {
    const folder = new FakeDirectory('RwatExamplePack');
    const source = new FsAccessSource(folder, true);
    await source.sink().write([...files].map(([path, bytes]) => ({ path, bytes })));
    await openSource(source);
    await journal.value?.run(mass(45));
    render(<SaveDialog />);
    expect((await screen.findByTestId('save-where')).getAttribute('data-target')).toBe('folder');
    expect(screen.getByTestId('save-where').textContent).toContain('RwatExamplePack');
    saveReport.value = { written: ['a.json'], deleted: [], failed: 'b.json', pending: ['pack.mcmeta'], detail: 'disk full' };
    await waitFor(() => expect(screen.getByTestId('save-report').textContent).toContain('Could not write b.json: disk full'));
    expect(screen.getByTestId('save-report-pending').textContent).toBe('b.jsonpack.mcmeta');
    fireEvent.click(screen.getByTestId('save-folder'));
    await waitFor(() => expect(pack.value?.dirtyPaths()).toEqual([]));

    cleanup();
    const readOnly = new FsAccessSource(folder, false);
    await openSource(readOnly);
    render(<SaveDialog />);
    expect((await screen.findByTestId('save-where')).textContent).toContain('No permission to write');
    fireEvent.click(screen.getByTestId('save-allow'));
    await waitFor(() => expect(screen.getByTestId('save-where').getAttribute('data-target')).toBe('folder'));
  });

  it('says there is nothing to save, and opens on Ctrl+S with a pack open', async () => {
    const remove = installShortcuts();
    try {
      render(<SaveDialogs />);
      const press = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
      press();
      expect(saveDialogOpen.value).toBe(false);
      expect(await openSource(new MemorySource(files, 'RwatExamplePack'))).toBe(true);
      expect(failure.value).toBeNull();
      press();
      expect(saveDialogOpen.value).toBe(true);
      expect(await screen.findByTestId('save-none')).toBeTruthy();
      fireEvent.click(screen.getByTestId('save-close'));
      expect(saveDialogOpen.value).toBe(false);
    } finally {
      remove();
    }
  });
});

describe('the page around saving', () => {
  it('marks unsaved changes in the title and asks before a tab with them closes', async () => {
    const stop = startSave();
    try {
      expect(document.title).toBe('RWAT pack editor');
      await openSource(new MemorySource(files, 'RwatExamplePack'));
      await waitFor(() => expect(document.title).toBe('RwatExamplePack — RWAT pack editor'));
      const leave = (): Event => {
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        return event;
      };
      expect(leave().defaultPrevented).toBe(false);
      await journal.value?.run(mass(45));
      await waitFor(() => expect(document.title).toBe('● RwatExamplePack — RWAT pack editor'));
      expect(windowTitle()).toBe(document.title);
      expect(leave().defaultPrevented).toBe(true);
      journal.value?.undo();
      await waitFor(() => expect(document.title).toBe('RwatExamplePack — RWAT pack editor'));
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      await sessionSettled();
      expect(store.values.has('record')).toBe(true);
    } finally {
      stop();
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    }
  });

  it('asks at start whether to restore unsaved work, and restores it on the click', async () => {
    await openSource(new MemorySource(files, 'RwatExamplePack'));
    await journal.value?.run(mass(45));
    await sessionSettled();
    reset();
    useSessionStore(store, { delay: 0 });
    // a memory source is kept by its files: restoring needs no dialog
    const stop = startSave();
    try {
      render(<SaveDialogs />);
      const dialog = await screen.findByTestId('restore-dialog');
      expect(dialog.textContent).toContain('RwatExamplePack');
      expect(dialog.textContent).toContain('1 changed file');
      fireEvent.click(screen.getByTestId('restore-session'));
      await waitFor(() => expect(pack.value).not.toBeNull());
      expect((pack.value?.json(COACH) as { mass_t: number }).mass_t).toBe(45);
      await waitFor(() => expect(screen.queryByTestId('restore-dialog')).toBeNull());
    } finally {
      stop();
    }
  });

  it('shows the other questions of restoring: files changed, a failure, another editor version', async () => {
    render(<SaveDialogs />);
    restoreState.value = { step: 'incompatible', reason: 'x' };
    expect((await screen.findByTestId('restore-text')).getAttribute('data-step')).toBe('incompatible');
    restoreState.value = { step: 'busy', record: {} as never };
    await waitFor(() => expect(screen.getByTestId('restore-text').getAttribute('data-step')).toBe('busy'));
    restoreState.value = { step: 'failed', record: null, key: 'save.restore.failed', params: { detail: 'boom' } };
    await waitFor(() => expect(screen.getByTestId('restore-text').textContent).toBe('The session could not be restored: boom'));
    fireEvent.click(screen.getByTestId('restore-later'));
    expect(restoreState.value).toBeNull();
    restoreState.value = {
      step: 'changed',
      record: {} as never,
      source: new MemorySource(files),
      changes: { changed: ['a', 'b', 'c', 'd', 'e', 'f'], added: ['g'], removed: ['h'] },
    };
    expect((await screen.findByTestId('restore-changes')).textContent).toBe('Changed: a, b, c, d, e (+1)Added: gRemoved: h');
    restoreState.value = { step: 'offer', record: { name: 'Big.zip', dirty: 2, updated: 0, base: 'reopen', reopen: 'zip' } as never };
    await waitFor(() => expect(screen.getByTestId('restore-session').textContent).toBe('Open and restore'));
    expect(screen.getByTestId('restore-dialog').textContent).toContain('open the same zip “Big.zip”');
    fireEvent.click(screen.getByTestId('restore-discard'));
    await waitFor(() => expect(restoreState.value).toBeNull());
  });
});
