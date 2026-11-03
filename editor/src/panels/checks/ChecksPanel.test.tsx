import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openSource } from '../../app/session';
import { failure, journal, pack, revision, schema, schemaError, selection } from '../../app/store';
import { MemorySource, readTree } from '../../core/pack/testing.node';
import { setLang } from '../../i18n';
import { EXAMPLE_PACK } from '../../testing/repo.node';
import { ChecksPanel } from './ChecksPanel';
import { modelSweep } from './findings';

// the page's model worker, in this thread: the textures stand in for (Node decodes no images)
vi.mock('../../model/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../model/client')>();
  const { createModelApi } = await import('../../model/api');
  return { ...actual, lazyModelWorker: () => createModelApi(() => Promise.resolve(null)) };
});

const COACH = 'data/rwat_example/wagon_types/coach.json';
const SEAT_TEXTURE = 'assets/rwat_example/stock/coach/coach_seat.png';

function reset(): void {
  modelSweep.clear();
  pack.value = null;
  journal.value = null;
  schema.value = null;
  schemaError.value = null;
  failure.value = null;
  selection.value = [];
  revision.value = 0;
}

beforeEach(() => {
  reset();
  setLang('en');
});

afterEach(() => {
  cleanup();
  reset();
});

async function openExample(): Promise<void> {
  render(<ChecksPanel />);
  await openSource(new MemorySource(readTree(EXAMPLE_PACK), 'RwatExamplePack'));
  await waitFor(() => expect(screen.getByTestId('checks-summary').textContent).toBe('No findings.'));
}

describe('the checks tab', () => {
  it("lists the floor check's finding of a broken type in the interface language, the engine's line as its tooltip; a click selects the door", async () => {
    await openExample();
    setLang('ru');
    // door_fl half a block off the side wall (ExamplePackLoadTest.coachBreaks)
    await journal.value?.run({ label: 'edit.field', ops: [{ op: 'set', file: COACH, at: '/doors/0/min/2', value: 1.95 }] });
    await journal.value?.run({ label: 'edit.field', ops: [{ op: 'set', file: COACH, at: '/doors/0/max/2', value: 2.01 }] });
    const finding = await waitFor(() => {
      const found = screen.getByTestId('checks').querySelector('[data-code="floor.door-not-at-floor-end"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(finding.getAttribute('data-source')).toBe('floor');
    expect(finding.querySelector('.finding-text')?.textContent).toBe(
      'дверь 0 «door_fl» не там, где кончается пол: через неё не выйти (перед ней, в её пролёте, должен помещаться игрок, а пол — кончаться не дальше 0.4 от её внутренней грани)',
    );
    expect(finding.getAttribute('title')).toBe(
      "door 0 'door_fl' isn't where the floor ends: nobody can walk through it (a player must fit in front of it, inside its span, with the floor ending within 0.4 of its inner face)",
    );
    expect(finding.querySelector('.finding-where')?.textContent).toBe(`${COACH} /doors/0`);
    fireEvent.click(finding);
    expect(selection.value).toEqual([
      { kind: 'field', file: COACH, at: '/doors/0' },
      { kind: 'door', type: 'rwat_example:coach', index: 0 },
    ]);
  });

  it('checks all models with progress, lists what it finds, and says when the pack changed since', async () => {
    await openExample();
    fireEvent.click(screen.getByTestId('check-models'));
    await waitFor(() => expect(screen.getByTestId('check-models-bar').getAttribute('data-status')).toBe('done'));
    expect(screen.getByTestId('check-models-status').textContent).toBe('Models checked: 3; errors: 0, warnings: 0.');
    expect(screen.getByTestId('checks-summary').textContent).toBe('No findings.');

    await journal.value?.run({ label: 'edit.delete', ops: [{ op: 'deleteFile', file: SEAT_TEXTURE }] });
    await waitFor(() => expect(screen.getByTestId('check-models-bar').getAttribute('data-stale')).toBe('true'));
    expect(screen.getByTestId('check-models-status').textContent).toContain('The pack changed since: check again.');

    fireEvent.click(screen.getByTestId('check-models'));
    const finding = await waitFor(() => {
      const found = screen.getByTestId('checks').querySelector('[data-code="model.missing-texture"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(finding.getAttribute('data-source')).toBe('model');
    expect(finding.querySelector('.finding-text')?.textContent).toBe(
      'model rwat_example:stock/coach/coach.obj: texture rwat_example:stock/coach/coach_seat.png of material seat not found',
    );
    await waitFor(() => expect(screen.getByTestId('check-models-bar').getAttribute('data-status')).toBe('done'));
    expect(screen.getByTestId('check-models-status').textContent).toBe('Models checked: 3; errors: 1, warnings: 0.');
    fireEvent.click(finding);
    expect(selection.value).toEqual([{ kind: 'file', file: 'assets/rwat_example/stock/coach/coach.mtl' }]);
  });

  it('forgets the run when another pack opens', async () => {
    await openExample();
    fireEvent.click(screen.getByTestId('check-models'));
    await waitFor(() => expect(screen.getByTestId('check-models-bar').getAttribute('data-status')).toBe('done'));
    await openSource(new MemorySource(readTree(EXAMPLE_PACK), 'Again'));
    await waitFor(() => expect(screen.getByTestId('check-models-bar').getAttribute('data-status')).toBe('idle'));
    expect(screen.queryByTestId('check-models-status')).toBeNull();
  });
});
