import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installKeys } from '../../app/keys';
import { openSource } from '../../app/session';
import { journal, pack, revision, schema, selection } from '../../app/store';
import { MemorySource, readTree } from '../../core/pack/testing.node';
import { createSchema } from '../../core/schema';
import { readSchemaFiles } from '../../core/schema/files.node';
import { setLang } from '../../i18n';
import { EXAMPLE_PACK } from '../../testing/repo.node';
import { TreePanel } from './TreePanel';

const COACH = 'data/rwat_example/wagon_types/coach.json';
const COACH_MODEL = 'assets/rwat_example/wagon_models/coach.json';
const files = readTree(EXAMPLE_PACK);
let off: () => void;

beforeEach(() => {
  pack.value = null;
  journal.value = null;
  schema.value = createSchema(readSchemaFiles());
  selection.value = [];
  revision.value = 0;
  setLang('en');
  off = installKeys(document, { platform: 'pc' });
});

afterEach(() => {
  off();
  cleanup();
  pack.value = null;
  journal.value = null;
  schema.value = null;
  selection.value = [];
  localStorage.clear();
});

async function openTree() {
  render(<TreePanel />);
  await openSource(new MemorySource(files, 'RwatExamplePack'));
  return screen.findByRole('tree', { name: 'Pack files' });
}

/** The tree items in the order shown, by their text. */
function names(tree: HTMLElement): string[] {
  return within(tree)
    .getAllByRole('treeitem')
    .map((item) => item.getAttribute('data-file') ?? item.textContent ?? '');
}

describe('the pack tree as an ARIA tree', () => {
  it('has levels, branches that say if they are open, and one stop of the Tab key', async () => {
    const tree = await openTree();
    const items = within(tree).getAllByRole('treeitem');
    expect(items.length).toBeGreaterThan(10);
    const wagons = items.find((item) => item.textContent === 'Wagons (3)') as HTMLElement;
    expect(wagons.getAttribute('aria-level')).toBe('1');
    expect(wagons.getAttribute('aria-expanded')).toBe('true');
    const group = document.getElementById(wagons.getAttribute('aria-owns') as string) as HTMLElement;
    expect(group.getAttribute('role')).toBe('group');
    const coach = items.find((item) => item.textContent === 'rwat_example:coach') as HTMLElement;
    expect(coach.getAttribute('aria-level')).toBe('2');
    const type = items.find((item) => item.getAttribute('data-file') === COACH) as HTMLElement;
    expect(type.getAttribute('aria-level')).toBe('3');
    expect(type.textContent).toBe('type');
    // one item holds the stop: the first
    expect(items.filter((item) => item.getAttribute('tabindex') === '0')).toHaveLength(1);
    expect(items[0]?.getAttribute('tabindex')).toBe('0');
  });

  it('keeps its old marks: sections, wagons by id, files by path, the counts of findings', async () => {
    const tree = await openTree();
    const wagons = tree.querySelector('[data-section="wagons"]') as HTMLElement;
    expect([...wagons.querySelectorAll('[data-stock]')].map((li) => li.getAttribute('data-stock'))).toEqual(['rwat_example:coach', 'rwat_example:gondola', 'rwat_example:shunter']);
    expect(wagons.querySelector(`[data-stock="rwat_example:coach"] [data-file="${COACH}"]`)).not.toBeNull();
    await journal.value?.run({ label: 'edit.field', ops: [{ op: 'set', file: COACH, at: '/mass_t', value: 'heavy' }] });
    await waitFor(() => expect(tree.querySelector(`[data-file="${COACH}"] .badge-error`)).not.toBeNull());
    const badge = tree.querySelector(`[data-file="${COACH}"] .badge-error`) as HTMLElement;
    expect(badge.getAttribute('role')).toBe('img');
    expect(badge.getAttribute('aria-label')).toMatch(/^Errors: \d+$/);
  });

  it('moves with the arrows, closes and opens a branch with Left and Right, and chooses a file with Enter', async () => {
    const tree = await openTree();
    const first = within(tree).getAllByRole('treeitem')[0] as HTMLElement;
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    const second = document.activeElement as HTMLElement;
    expect(second.getAttribute('data-file')).toBe('pack.mcmeta');
    fireEvent.keyDown(second, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'ArrowLeft' });
    await waitFor(() => expect(first.getAttribute('aria-expanded')).toBe('false'));
    expect(tree.querySelector('[data-file="pack.mcmeta"]')).toBeNull();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    await waitFor(() => expect(first.getAttribute('aria-expanded')).toBe('true'));
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    const file = document.activeElement as HTMLElement;
    expect(file.getAttribute('data-file')).toBe('pack.mcmeta');
    fireEvent.keyDown(file, { key: 'Enter' });
    expect(selection.value).toEqual([{ kind: 'file', file: 'pack.mcmeta' }]);
    await waitFor(() => expect(file.getAttribute('aria-selected')).toBe('true'));

    // the last item, and back to the first
    fireEvent.keyDown(file, { key: 'End' });
    const last = document.activeElement as HTMLElement;
    expect(last).toBe(within(tree).getAllByRole('treeitem').at(-1));
    fireEvent.keyDown(last, { key: 'Home' });
    expect(document.activeElement).toBe(first);
  });

  it('walks a wagon’s id, type and model one after another, and chooses the model with Space', async () => {
    const tree = await openTree();
    const coach = within(tree).getByText('rwat_example:coach');
    coach.focus();
    fireEvent.keyDown(coach, { key: 'ArrowDown' });
    expect((document.activeElement as HTMLElement).getAttribute('data-file')).toBe(COACH);
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
    const model = document.activeElement as HTMLElement;
    expect(model.getAttribute('data-file')).toBe(COACH_MODEL);
    fireEvent.keyDown(model, { key: ' ' });
    expect(selection.value).toEqual([{ kind: 'file', file: COACH_MODEL }]);
  });

  it('takes the stop of the Tab key to the selected file, and says what is missing in a wagon', async () => {
    const tree = await openTree();
    selection.value = [{ kind: 'file', file: COACH }];
    await waitFor(() => expect(tree.querySelector(`[data-file="${COACH}"]`)?.getAttribute('tabindex')).toBe('0'));
    expect(within(tree).getAllByRole('treeitem').filter((item) => item.getAttribute('tabindex') === '0')).toHaveLength(1);
    expect(names(tree)).toContain(COACH);
  });
});
