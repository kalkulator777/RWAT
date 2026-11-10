/**
 * The objects tab in the DOM, on the example pack as the shell opens it: the open wagon's
 * model read by the model pipeline (the worker's own code, in this thread, app/openModel.ts
 * wired as the shell wires it), its objects listed with the engine's roles.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { connectModel } from '../../app/openModel';
import { panels } from '../../app/panels';
import { openSource } from '../../app/session';
import { journal, modelLoading, modelProblems, openModel, openWagon, pack, revision, schema, schemaError, selection } from '../../app/store';
import { MemorySource, readTree } from '../../core/pack/testing.node';
import { setLang } from '../../i18n';
import { createModelApi } from '../../model/api';
import { ModelLoader } from '../../model/client';
import { PreviewController } from '../../preview/controller';
import { recordingView } from '../../preview/testing.node';
import { EXAMPLE_PACK } from '../../testing/repo.node';
import { ObjectsPanel, roleLabel } from './ObjectsPanel';
import { ROLE_ORDER } from './roles';
import { exampleModel } from '../../model/testing.node';

const files = readTree(EXAMPLE_PACK);
const SHUNTER_MODEL = 'assets/rwat_example/wagon_models/shunter.json';
const COACH_MODEL = 'assets/rwat_example/wagon_models/coach.json';

let disconnect: (() => void) | null = null;

function reset(): void {
  disconnect?.();
  disconnect = null;
  pack.value = null;
  journal.value = null;
  schema.value = null;
  schemaError.value = null;
  selection.value = [];
  revision.value = 0;
  openWagon.value = null;
  openModel.value = null;
  modelLoading.value = false;
  modelProblems.value = [];
}

/** The shell's wiring of the open model, its worker in this thread. */
function wire(): void {
  const preview = new PreviewController({ every: () => () => undefined });
  const stop = connectModel({ loader: new ModelLoader(createModelApi(() => Promise.resolve(null))), view: recordingView(), preview, delayMs: 0 });
  disconnect = () => {
    stop();
    preview.dispose();
  };
}

async function openPack(source = files, name = 'RwatExamplePack'): Promise<void> {
  wire();
  await openSource(new MemorySource(source, name));
}

async function openShunter(): Promise<HTMLElement> {
  await openPack();
  render(<ObjectsPanel />);
  selection.value = [{ kind: 'file', file: SHUNTER_MODEL }];
  return screen.findByTestId('objects-table');
}

function rowOf(name: string): HTMLElement {
  const row = [...document.querySelectorAll<HTMLElement>('tr[data-object]')].find((tr) => tr.dataset.object === name);
  if (row === undefined) throw new Error(`no row ${name}`);
  return row;
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

describe('the objects tab', () => {
  it('is registered as the second bottom tab', () => {
    expect(panels.find((p) => p.id === 'objects')).toMatchObject({ slot: 'bottom', order: 20, title: 'objects.title' });
  });

  it('names every wagon role of the schema in both languages', () => {
    for (const lang of ['en', 'ru'] as const) {
      setLang(lang);
      const names = ROLE_ORDER.map(roleLabel);
      expect(names.filter((name, at) => name === ROLE_ORDER[at]), lang).toEqual([]);
      expect(new Set(names).size).toBe(names.length);
    }
    expect(roleLabel('wormhole')).toBe('wormhole');
  });

  it('asks for a pack, then for a wagon', async () => {
    render(<ObjectsPanel />);
    expect(screen.getByText('No pack open.')).toBeTruthy();
    await openPack();
    await screen.findByText(/Pick a wagon/);
    const select = screen.getByTestId<HTMLSelectElement>('objects-wagon');
    expect([...select.options].map((o) => o.value)).toEqual(['', 'rwat_example:coach', 'rwat_example:gondola', 'rwat_example:shunter']);
  });

  it('lists the objects of the wagon the selection points at, with its roles, keys, groups and textures', async () => {
    await openShunter();
    const root = screen.getByTestId('objects');
    expect(root.getAttribute('data-wagon')).toBe('rwat_example:shunter');
    const knob = rowOf('THROTTLE_1_KNOB');
    expect(knob.dataset.role).toBe('control');
    expect(within(knob).getByText('Control')).toBeTruthy();
    expect(within(knob).getByText('THROTTLE_1')).toBeTruthy();
    expect(within(knob).getByText('yes')).toBeTruthy();
    expect(within(rowOf('WIDGET_7_CG_FHL_HIDE_NOTOUCH')).getByText('CG FHL')).toBeTruthy();
    expect(within(rowOf('HEADLIGHT_1_LCG_FHL_0XFFF2CC')).getByText('LCG FHL')).toBeTruthy();
    expect(within(rowOf('GUIDE_FLOOR_0')).getByText('Dropped: skip')).toBeTruthy();
    expect(screen.getByTestId('objects-summary').textContent).toMatch(/^Showing (\d+) of \1$/);
  });

  it('follows the wagon the user picks in its list, and writes the model file to the selection', async () => {
    await openShunter();
    fireEvent.change(screen.getByTestId('objects-wagon'), { target: { value: 'rwat_example:coach' } });
    await waitFor(() => expect(screen.getByTestId('objects').getAttribute('data-wagon')).toBe('rwat_example:coach'));
    expect(selection.value).toEqual([{ kind: 'file', file: COACH_MODEL }]);
    await waitFor(() => expect(document.querySelector('tr[data-object="DOOR_1_TL_0.95_X"]')).not.toBeNull());
    expect(rowOf('DOOR_1_TL_0.95_X').dataset.role).toBe('door_leaf');
  });

  it('finds the controls of the shunter with the legend and the search', async () => {
    await openShunter();
    const total = document.querySelectorAll('tr[data-object]').length;
    fireEvent.click(document.querySelector('.objects-chip[data-role="control"]') as HTMLElement);
    const controls = [...document.querySelectorAll<HTMLElement>('tr[data-object]')];
    expect(controls.length).toBeGreaterThan(5);
    expect(controls.length).toBeLessThan(total);
    expect(controls.every((tr) => tr.dataset.role === 'control')).toBe(true);
    expect(document.querySelector('.objects-chip[data-role="control"]')?.getAttribute('aria-pressed')).toBe('true');

    fireEvent.input(screen.getByTestId('objects-search'), { target: { value: 'throttle_1' } });
    const names = [...document.querySelectorAll<HTMLElement>('tr[data-object]')].map((tr) => tr.dataset.object);
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((name) => name?.includes('THROTTLE_1'))).toBe(true);
    expect(screen.getByTestId('objects-summary').textContent).toBe(`Showing ${names.length} of ${total}`);

    fireEvent.click(screen.getByText('All roles'));
    fireEvent.input(screen.getByTestId('objects-search'), { target: { value: '' } });
    expect(document.querySelectorAll('tr[data-object]').length).toBe(total);
  });

  it('sorts by a column and says which way', async () => {
    await openShunter();
    const header = document.querySelector('th [data-sort="name"]') as HTMLElement;
    fireEvent.click(header);
    expect(header.closest('th')?.getAttribute('aria-sort')).toBe('ascending');
    const asc = [...document.querySelectorAll<HTMLElement>('tr[data-object]')].map((tr) => tr.dataset.object as string);
    expect(asc).toEqual([...asc].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })));
    fireEvent.click(header);
    expect(header.closest('th')?.getAttribute('aria-sort')).toBe('descending');
    expect([...document.querySelectorAll<HTMLElement>('tr[data-object]')].map((tr) => tr.dataset.object)).toEqual([...asc].reverse());
  });

  it('selects an object by a click on its row, adds with Shift, and takes a selection made elsewhere', async () => {
    await openShunter();
    fireEvent.click(within(rowOf('THROTTLE_1_KNOB')).getByRole('button'));
    expect(selection.value).toEqual([{ kind: 'object', model: 'rwat_example:shunter', name: 'THROTTLE_1_KNOB' }]);
    await waitFor(() => expect(rowOf('THROTTLE_1_KNOB').getAttribute('aria-current')).toBe('true'));

    fireEvent.click(within(rowOf('REVERSER_1_KNOB')).getByRole('button'), { shiftKey: true });
    expect(selection.value).toHaveLength(2);
    expect(screen.getByTestId('objects-why').textContent).toContain('Objects selected: 2');
    fireEvent.click(within(rowOf('REVERSER_1_KNOB')).getByRole('button'), { shiftKey: true });
    expect(selection.value).toHaveLength(1);

    // the 3D view (or the checks) selects another object: its row lights up
    selection.value = [{ kind: 'object', model: 'rwat_example:shunter', name: 'TRAIN_BRAKE_1_HANDLE' }];
    await waitFor(() => expect(rowOf('TRAIN_BRAKE_1_HANDLE').getAttribute('aria-current')).toBe('true'));
    expect(rowOf('THROTTLE_1_KNOB').getAttribute('aria-current')).toBeNull();
    expect(screen.getByTestId('objects').getAttribute('data-wagon')).toBe('rwat_example:shunter');
  });

  it('says why the chosen object has its role, in the interface language', async () => {
    await openShunter();
    selection.value = [{ kind: 'object', model: 'rwat_example:shunter', name: 'GUIDE_FLOOR_0' }];
    const why = await screen.findByTestId('objects-why');
    expect(why.getAttribute('data-role')).toBe('skip');
    expect(screen.getByTestId('objects-how').textContent).toContain('“GUIDE_”');
    expect(why.textContent).toContain('Dropped at load');

    selection.value = [{ kind: 'object', model: 'rwat_example:shunter', name: 'WIDGET_1_TOGGLE_CG_FHL_OFFSET_-0.5' }];
    await waitFor(() => expect(screen.getByTestId('objects-why').getAttribute('data-role')).toBe('control'));
    const marks = [...screen.getByTestId('objects-marks').querySelectorAll('li')].map((li) => li.dataset.mark);
    expect(marks).toEqual(['CG', 'OFFSET', 'TOGGLE']);

    setLang('ru');
    await waitFor(() => expect(screen.getByTestId('objects-why').textContent).toContain('Группа управления'));
    expect(screen.getByLabelText('Объекты модели')).toBe(screen.getByTestId('objects-table'));
    expect(screen.getByTestId('objects-how').textContent).toContain('«WIDGET_1»');
  });

  it('lists the model the shell opened and nothing of its own: it reads no OBJ', async () => {
    const shunter = await exampleModel('shunter');
    const frame = shunter.objects.find((o) => o.name === 'FRAME')!;
    await openSource(new MemorySource(files, 'RwatExamplePack'));
    render(<ObjectsPanel />);
    openWagon.value = shunter.id;
    await screen.findByText('Reading the model…');
    openModel.value = { ...shunter, objects: [{ ...frame, role: 'wheelset' }], parts: shunter.parts.filter((p) => p.object === 'FRAME') };
    await screen.findByTestId('objects-table');
    expect(document.querySelectorAll('tr[data-object]')).toHaveLength(1);
    expect(rowOf('FRAME').dataset.role).toBe('wheelset');
    // a model of another wagon is not this wagon's
    openWagon.value = 'rwat_example:coach';
    await screen.findByText('Reading the model…');
  });

  it('says why when the wagon’s model can’t be read, in the words of its finding', async () => {
    const broken = new Map(files);
    // a number Java refuses: the reader's exception (a short line would be an index out of bounds, `model.bad-face-index`)
    broken.set('assets/rwat_example/stock/shunter/shunter.obj', new TextEncoder().encode('v 1 2 x\n'));
    await openPack(broken, 'broken');
    render(<ObjectsPanel />);
    selection.value = [{ kind: 'file', file: SHUNTER_MODEL }];
    const failure = await screen.findByTestId('objects-failure');
    expect(failure.getAttribute('data-code')).toBe('model.unreadable');
    expect(failure.textContent).toContain("model rwat_example:stock/shunter/shunter.obj can't be read");
    setLang('ru');
    await waitFor(() => expect(screen.getByTestId('objects-failure').textContent).toContain('не читается'));
  });

  it('says a wagon without a model has none', async () => {
    const typeOnly = new Map([...files].filter(([path]) => path !== SHUNTER_MODEL));
    await openPack(typeOnly, 'type only');
    render(<ObjectsPanel />);
    selection.value = [{ kind: 'file', file: 'data/rwat_example/wagon_types/shunter.json' }];
    expect((await screen.findByTestId('objects-failure')).textContent).toContain('no model declaration');
  });
});
