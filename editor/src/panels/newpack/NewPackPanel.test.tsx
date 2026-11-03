import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { panels } from '../../app/panels';
import { savePack } from '../../app/session';
import { Shell } from '../../app/Shell';
import { failure, journal, pack, revision, schema, schemaError, selection } from '../../app/store';
import { createSchema } from '../../core/schema';
import { readSchemaFiles } from '../../core/schema/files.node';
import { setLang } from '../../i18n';
import { openZipSource, readAll } from '../../io';

function reset(): void {
  pack.value = null;
  journal.value = null;
  schema.value = null;
  schemaError.value = null;
  failure.value = null;
  selection.value = [];
  revision.value = 0;
}

function fill(dialog: HTMLElement, name: string, value: string): void {
  const input = dialog.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (input === null) throw new Error(`no box ${name}`);
  fireEvent.input(input, { target: { value } });
}

beforeEach(() => {
  reset();
  setLang('en');
  schema.value = createSchema(readSchemaFiles());
  render(<Shell panels={panels} />);
});

afterEach(() => {
  cleanup();
  reset();
  localStorage.clear();
});

describe('the wizard', () => {
  it('makes a new pack, adds a wagon with its OBJ, and the zip it saves holds them', async () => {
    expect(screen.getByTestId('add-wagon').hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByTestId('new-pack'));
    const dialog = await screen.findByTestId('new-pack-dialog');
    fireEvent.submit(dialog.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('Type the pack name.'));
    fill(dialog, 'name', 'MyTrains');
    fill(dialog, 'namespace', 'my_trains');
    fill(dialog, 'authors', 'Me');
    fill(dialog, 'license', 'CC0-1.0');
    fireEvent.submit(dialog.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(screen.getByTestId('pack-status').textContent).toContain('MyTrains'));
    expect(screen.queryByTestId('new-pack-dialog')).toBeNull();
    expect(selection.value).toEqual([{ kind: 'file', file: 'pack.mcmeta' }]);
    expect(pack.value?.json('pack.mcmeta')).toEqual({
      pack: { pack_format: 34, supported_formats: [34, 48], description: 'MyTrains' },
      rwat: { format: 1, name: 'MyTrains', version: '1.0.0', authors: ['Me'], license: 'CC0-1.0' },
    });
    const inspector = await screen.findByTestId('inspector');
    expect(inspector.getAttribute('data-kind')).toBe('pack_mcmeta_rwat');

    fireEvent.click(screen.getByTestId('add-wagon'));
    const wagon = await screen.findByTestId('add-wagon-dialog');
    expect((wagon.querySelector('input[name="namespace"]') as HTMLInputElement).value).toBe('my_trains');
    fill(wagon, 'id', 'coach');
    const obj = new File(['o BODY\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'], 'coach.obj');
    const picker = wagon.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(picker, 'files', { value: [obj], configurable: true });
    fireEvent.change(picker);
    fill(wagon, 'length', '20');
    fill(wagon, 'mass_t', '40');
    fill(wagon, 'bogie_front', '7');
    fill(wagon, 'bogie_rear', '-7');
    fill(wagon, 'name_ru_ru', 'Вагон');
    fireEvent.submit(wagon.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(screen.queryByTestId('add-wagon-dialog')).toBeNull());
    expect(selection.value).toEqual([{ kind: 'file', file: 'data/my_trains/wagon_types/coach.json' }]);
    expect(screen.getByTestId('tree').querySelector('[data-stock="my_trains:coach"]')).not.toBeNull();
    await waitFor(() => expect(screen.getByTestId('checks-summary').textContent).toBe('No findings.'));
    const train = (await screen.findByTestId('inspector')).querySelector<HTMLInputElement>('[data-pointer="/brakes/train_kn"] input');
    expect(train?.placeholder).toBe('40');

    let saved: { zip: Uint8Array; name: string } | undefined;
    await savePack((zip, name) => {
      saved = { zip, name };
    });
    expect(saved?.name).toBe('MyTrains.zip');
    const files = await readAll(await openZipSource(saved?.zip as Uint8Array, 'MyTrains.zip'));
    expect([...files.keys()]).toEqual([
      'assets/my_trains/lang/ru_ru.json',
      'assets/my_trains/stock/coach/coach.obj',
      'assets/my_trains/wagon_models/coach.json',
      'data/my_trains/wagon_types/coach.json',
      'pack.mcmeta',
    ]);
  });

  it('refuses a wagon whose files Minecraft would not load, saying which', async () => {
    fireEvent.click(screen.getByTestId('new-pack'));
    const dialog = await screen.findByTestId('new-pack-dialog');
    fill(dialog, 'name', 'P');
    fill(dialog, 'namespace', 'p');
    fireEvent.submit(dialog.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(pack.value).not.toBeNull());
    fireEvent.click(screen.getByTestId('add-wagon'));
    const wagon = await screen.findByTestId('add-wagon-dialog');
    fill(wagon, 'id', 'coach');
    const picker = wagon.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(picker, 'files', { value: [new File([''], 'My Coach.obj')], configurable: true });
    fireEvent.change(picker);
    for (const [name, value] of [['length', '20'], ['mass_t', '40'], ['bogie_front', '7'], ['bogie_rear', '-7']]) fill(wagon, name as string, value as string);
    fireEvent.submit(wagon.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(wagon.querySelector('[role="alert"]')?.textContent).toContain('assets/p/stock/coach/My Coach.obj'));
    expect(pack.value?.paths()).toEqual(['pack.mcmeta']);
    fireEvent.click(wagon.querySelector('.dialog-buttons button') as HTMLElement);
    await waitFor(() => expect(screen.queryByTestId('add-wagon-dialog')).toBeNull());
  });
});
