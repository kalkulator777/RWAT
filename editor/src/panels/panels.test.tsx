import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openSource } from '../app/session';
import { failure, journal, pack, revision, schema, schemaError, selection } from '../app/store';
import { Shell } from '../app/Shell';
import { panels } from '../app/panels';
import { MemorySource, readTree } from '../core/pack/testing.node';
import { createSchema } from '../core/schema';
import { readSchemaFiles } from '../core/schema/files.node';
import { setLang } from '../i18n';
import { EXAMPLE_PACK } from '../testing/repo.node';

const COACH = 'data/rwat_example/wagon_types/coach.json';
const files = readTree(EXAMPLE_PACK);

function reset(): void {
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
  localStorage.clear();
});

describe('the shell with the real panels', () => {
  it('registers the file buttons, the tree and the checks', () => {
    expect(panels.map((p) => p.id)).toEqual(expect.arrayContaining(['file', 'tree', 'checks']));
    expect(panels.map((p) => p.id)).not.toContain('io-dev');
  });

  it('shows the pack in the tree and the top bar, and its findings in the checks tab', async () => {
    schema.value = createSchema(readSchemaFiles());
    render(<Shell panels={panels} />);
    expect(screen.getByTestId('save').hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('undo').hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('No pack open')).toBeTruthy();

    await openSource(new MemorySource(files, 'RwatExamplePack'));
    await waitFor(() => expect(screen.getByTestId('pack-status').textContent).toContain('RwatExamplePack'));
    const tree = screen.getByTestId('tree');
    const wagons = tree.querySelector('[data-section="wagons"]') as HTMLElement;
    expect([...wagons.querySelectorAll('[data-stock]')].map((li) => li.getAttribute('data-stock'))).toEqual([
      'rwat_example:coach',
      'rwat_example:gondola',
      'rwat_example:shunter',
    ]);
    expect(within(wagons).getAllByText('type')).toHaveLength(3);
    expect(screen.getByTestId('checks-summary').textContent).toBe('No findings.');
    expect(screen.getByTestId('save').hasAttribute('disabled')).toBe(false);

    fireEvent.click(tree.querySelector(`[data-file="${COACH}"]`) as HTMLElement);
    expect(selection.value).toEqual([{ kind: 'file', file: COACH }]);
  });

  it('lists a finding in the checks tab, marks its file in the tree and selects its place on a click; undo clears it', async () => {
    schema.value = createSchema(readSchemaFiles());
    render(<Shell panels={panels} />);
    await openSource(new MemorySource(files, 'RwatExamplePack'));
    await journal.value?.run({ label: 'edit.field', ops: [{ op: 'set', file: COACH, at: '/mass_t', value: 'heavy' }] });

    const checks = await screen.findByTestId('checks');
    await waitFor(() => expect(checks.getAttribute('data-count')).not.toBe('0'));
    const finding = checks.querySelector('.finding') as HTMLElement;
    expect(finding.getAttribute('data-code')).toMatch(/^schema\./);
    expect(finding.textContent).toContain('/mass_t');
    expect(screen.getByTestId('tree').querySelector(`[data-file="${COACH}"] .badge-error`)).not.toBeNull();
    expect(screen.getByTestId('save').textContent).toBe('Save (1)');

    fireEvent.click(finding);
    expect(selection.value).toEqual([{ kind: 'field', file: COACH, at: '/mass_t' }]);

    fireEvent.click(screen.getByTestId('undo'));
    await waitFor(() => expect(screen.getByTestId('checks-summary').textContent).toBe('No findings.'));
    expect(screen.getByTestId('save').textContent).toBe('Save');
    expect(screen.getByTestId('redo').hasAttribute('disabled')).toBe(false);
  });

  it('says why a pack did not open, and that the schema is missing', async () => {
    schemaError.value = 'HTTP 404';
    render(<Shell panels={panels} />);
    expect(screen.getByTestId('schema-error').textContent).toContain('HTTP 404');
    await openSource(new MemorySource(new Map([['x.txt', new Uint8Array()]]), 'nothing'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('not a pack');
    fireEvent.click(within(alert).getByRole('button'));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
