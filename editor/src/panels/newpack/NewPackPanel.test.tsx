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

  it('adds files to a folder of the pack in one command, and to its root', async () => {
    expect(screen.getByTestId('add-files').hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByTestId('new-pack'));
    const dialog = await screen.findByTestId('new-pack-dialog');
    fill(dialog, 'name', 'P');
    fill(dialog, 'namespace', 'p');
    fireEvent.submit(dialog.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(pack.value).not.toBeNull());

    const pick = async (folder: string | null, files: File[]): Promise<HTMLElement> => {
      fireEvent.click(screen.getByTestId('add-files'));
      const box = await screen.findByTestId('add-files-dialog');
      if (folder !== null) fill(box, 'folder', folder);
      const picker = box.querySelector('input[type="file"]') as HTMLInputElement;
      expect(picker.hasAttribute('accept')).toBe(false);
      Object.defineProperty(picker, 'files', { value: files, configurable: true });
      fireEvent.change(picker);
      fireEvent.submit(box.querySelector('form') as HTMLFormElement);
      return box;
    };
    // the folder starts at the pack's namespace
    const box = await pick(null, [new File(['x'], 'Steel.png')]);
    await waitFor(() => expect(box.querySelector('[role="alert"]')?.textContent).toContain('assets/p/Steel.png'));
    fill(box, 'folder', 'assets/p/stock/common');
    const picker = box.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(picker, 'files', { value: [new File(['x'], 'steel.png'), new File(['y'], 'wheel.png')], configurable: true });
    fireEvent.change(picker);
    fireEvent.submit(box.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(screen.queryByTestId('add-files-dialog')).toBeNull());
    expect(journal.value?.state().done.map((command) => command.labelParams)).toEqual([{ count: 2, folder: 'assets/p/stock/common' }]);

    await pick('', [new File(['# P\n'], 'README.md')]);
    await waitFor(() => expect(screen.queryByTestId('add-files-dialog')).toBeNull());
    expect(pack.value?.paths()).toEqual(['README.md', 'assets/p/stock/common/steel.png', 'assets/p/stock/common/wheel.png', 'pack.mcmeta']);
    expect(await pack.value?.text('README.md')).toBe('# P\n');
  });

  it('adds a rail style with its tile and names in one command; the tree lists it', async () => {
    expect(screen.getByTestId('add-rail').hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByTestId('new-pack'));
    const dialog = await screen.findByTestId('new-pack-dialog');
    fill(dialog, 'name', 'P');
    fill(dialog, 'namespace', 'p');
    fireEvent.submit(dialog.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(pack.value).not.toBeNull());
    fireEvent.click(screen.getByTestId('add-rail'));
    const rail = await screen.findByTestId('add-rail-dialog');
    expect((rail.querySelector('input[name="namespace"]') as HTMLInputElement).value).toBe('p');
    fill(rail, 'id', 'wooden');
    fill(rail, 'folder', 'track');
    const picker = rail.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(picker, 'files', { value: [new File(['o RAIL_L\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'], 'wooden.obj'), new File(['newmtl a\n'], 'wooden.mtl')], configurable: true });
    fireEvent.change(picker);
    fill(rail, 'tile_length', '0.75');
    fill(rail, 'name_en_us', 'Wooden');
    fireEvent.submit(rail.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(screen.queryByTestId('add-rail-dialog')).toBeNull());
    expect(selection.value).toEqual([{ kind: 'file', file: 'assets/p/rail_models/wooden.json' }]);
    expect(pack.value?.json('assets/p/rail_models/wooden.json')).toEqual({ obj: 'track/wooden.obj', tile_length: 0.75 });
    expect(pack.value?.json('assets/p/lang/en_us.json')).toEqual({ 'rail.p.wooden': 'Wooden' });
    expect(journal.value?.state().done.map((command) => command.label)).toEqual(['newpack.command.addRail']);
    expect(screen.getByTestId('tree').querySelector('[data-file="assets/p/rail_models/wooden.json"]')).not.toBeNull();
  });
});
