import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { panels } from '../../app/panels';
import { openSource } from '../../app/session';
import { Shell } from '../../app/Shell';
import { failure, journal, pack, revision, schema, schemaError, selection } from '../../app/store';
import { MemorySource, readTree } from '../../core/pack/testing.node';
import { createSchema } from '../../core/schema';
import { readSchemaFiles } from '../../core/schema/files.node';
import { setLang } from '../../i18n';
import { EXAMPLE_PACK } from '../../testing/repo.node';

const COACH = 'data/rwat_example/wagon_types/coach.json';
const files = readTree(EXAMPLE_PACK);
const loaded = createSchema(readSchemaFiles());

function reset(): void {
  pack.value = null;
  journal.value = null;
  schema.value = null;
  schemaError.value = null;
  failure.value = null;
  selection.value = [];
  revision.value = 0;
}

function field(root: Element, at: string): HTMLElement {
  const found = [...root.querySelectorAll<HTMLElement>('[data-pointer]')].find((el) => el.dataset.pointer === at);
  if (found === undefined) throw new Error(`no field ${at}`);
  return found;
}

beforeEach(async () => {
  reset();
  setLang('en');
  schema.value = loaded;
  render(<Shell panels={panels} />);
  await openSource(new MemorySource(files, 'RwatExamplePack'));
});

afterEach(() => {
  cleanup();
  reset();
  localStorage.clear();
});

describe('the inspector', () => {
  it('asks for a file, then shows the form of the one picked in the tree with its names on top', async () => {
    const inspector = screen.getByRole('complementary', { name: 'Inspector' });
    expect(inspector.textContent).toContain('Pick a file in the pack tree');
    fireEvent.click(screen.getByTestId('tree').querySelector(`[data-file="${COACH}"]`) as HTMLElement);
    const panel = await within(inspector).findByTestId('inspector');
    expect(panel.querySelector('.inspector-title')?.textContent).toBe('Wagon type rwat_example:coach');
    const names = panel.querySelectorAll<HTMLInputElement>('.name-fields input');
    expect([...names].map((input) => input.value)).toEqual(['Example coach', 'Пассажирский вагон (пример)']);
    expect(field(panel, '/doors').querySelector('.field-spatial')).not.toBeNull();
  });

  it('commits an edit to the journal: the save counts it, undo takes it back', async () => {
    selection.value = [{ kind: 'file', file: COACH }];
    const panel = await screen.findByTestId('inspector');
    const mass = field(panel, '/mass_t').querySelector('input') as HTMLInputElement;
    fireEvent.input(mass, { target: { value: '50' } });
    fireEvent.change(mass, { target: { value: '50' } });
    await waitFor(() => expect(screen.getByTestId('save').textContent).toBe('Save (1)'));
    fireEvent.click(screen.getByTestId('undo'));
    await waitFor(() => expect((field(panel, '/mass_t').querySelector('input') as HTMLInputElement).value).toBe('42'));
    expect(screen.getByTestId('save').textContent).toBe('Save');
  });

  it('brings the field of a finding clicked in the checks tab into view, the finding said in the interface language', async () => {
    await journal.value?.run({ label: 'x', ops: [{ op: 'set', file: COACH, at: '/bogies/0', value: 11 }] });
    const checks = screen.getByTestId('checks');
    await waitFor(() => expect(checks.getAttribute('data-count')).toBe('1'));
    const finding = checks.querySelector('.finding') as HTMLElement;
    expect(finding.querySelector('.finding-text')?.textContent).toBe('“bogies[0]” = 11 is outside the body: a pivot must lie within ±length/2 = ±10');
    expect(finding.getAttribute('title')).toBe("'bogies[0]' = 11 is outside the body: a pivot must lie within ±length/2 = ±10");
    fireEvent.click(finding);
    const panel = await screen.findByTestId('inspector');
    await waitFor(() => expect(document.activeElement?.closest('[data-pointer]')?.getAttribute('data-pointer')).toBe('/bogies/0'));
    expect(field(panel, '/bogies/0').closest('.field')?.classList.contains('field-has-error')).toBe(false);
    expect(field(panel, '/bogies').querySelector('.field-list-item input')?.getAttribute('aria-invalid')).toBe('true');

    setLang('ru');
    await waitFor(() =>
      expect(screen.getByTestId('checks').querySelector('.finding-text')?.textContent).toBe(
        '«bogies[0]» = 11 — вне кузова: шкворень должен быть в пределах ±length/2 = ±10',
      ),
    );
  });

  it('hides the severities picked in the checks tab', async () => {
    await journal.value?.run({ label: 'x', ops: [{ op: 'set', file: COACH, at: '/bogies/0', value: 11 }, { op: 'set', file: COACH, at: '/brakes/dynamic_kn', value: 1 }] });
    const checks = screen.getByTestId('checks');
    await waitFor(() => expect(checks.querySelectorAll('.finding')).toHaveLength(2));
    fireEvent.click(checks.querySelector('[data-severity="warning"]') as HTMLElement);
    await waitFor(() => expect(checks.querySelectorAll('.finding')).toHaveLength(1));
    expect(checks.querySelector('.finding')?.getAttribute('data-code')).toBe('loader.bogie-outside');
  });
});

describe('the names tab', () => {
  it('lists the lang keys of the pack and writes an edited name into its lang file', async () => {
    const names = screen.getByTestId('names');
    const row = names.querySelector('[data-key="wagon.rwat_example.gondola"]') as HTMLElement;
    const ru = row.querySelector<HTMLInputElement>('input[data-lang="ru_ru"]') as HTMLInputElement;
    expect(ru.value).toBe('Двухосный полувагон (пример)');
    fireEvent.input(ru, { target: { value: 'Полувагон' } });
    fireEvent.change(ru, { target: { value: 'Полувагон' } });
    await waitFor(() => expect(pack.value?.json('assets/rwat_example/lang/ru_ru.json')).toMatchObject({ 'wagon.rwat_example.gondola': 'Полувагон' }));
    expect(journal.value?.state().done.at(-1)?.label).toBe('names.command.set');
  });
});
