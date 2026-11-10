import { signal } from '@preact/signals';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkPack } from '../checks/pack';
import type { Command } from '../core/contracts';
import { Journal } from '../core/journal';
import { Pack } from '../core/pack';
import { MemorySource, readTree } from '../core/pack/testing.node';
import { formatPointer, getAt, isJsonObject, parsePointer, removeIn, setIn } from '../core/json';
import { createSchema, type SchemaKind } from '../core/schema';
import { readSchemaFiles } from '../core/schema/files.node';
import { setLang } from '../i18n';
import { canRemove, deepMerge, fieldState } from '../ir/recipe';
import { EXAMPLE_PACK, REPO_SCHEMA_DIR } from '../testing/repo.node';
import type { FormLayers } from './context';
import { SchemaForm } from './SchemaForm';

const COACH = 'data/rwat_example/wagon_types/coach.json';
const COACH_MODEL = 'assets/rwat_example/wagon_models/coach.json';
const schema = createSchema(readSchemaFiles());
const typeSchema = JSON.parse(readFileSync(join(REPO_SCHEMA_DIR, 'wagon_type.schema.json'), 'utf8')) as {
  properties: Record<string, { description: string; 'x-description-ru': string }>;
};

let pack: Pack;
let journal: Journal;
const tick = signal(0);

function Form(props: { file: string; kind: SchemaKind; spatialNote?: boolean; readOnly?: boolean }) {
  void tick.value;
  return (
    <SchemaForm
      file={props.file}
      kind={props.kind}
      value={pack.json(props.file)}
      schema={schema}
      problems={checkPack(pack, schema)}
      pack={pack}
      readOnly={props.readOnly}
      spatialNote={props.spatialNote ?? true}
      onCommand={(command: Command) => {
        journal.dispatch(command);
        tick.value++;
      }}
    />
  );
}

function edit(command: Command): void {
  journal.dispatch(command);
  tick.value++;
}

function field(container: Element, at: string): HTMLElement {
  const found = [...container.querySelectorAll<HTMLElement>('[data-pointer]')].find((el) => el.dataset.pointer === at);
  if (found === undefined) throw new Error(`no field ${at}`);
  return found;
}

function input(container: Element, at: string): HTMLInputElement {
  const found = field(container, at).querySelector<HTMLInputElement>('input');
  if (found === null) throw new Error(`no input in ${at}`);
  return found;
}

/** Types into a box and commits it, as Enter or leaving the box does. */
function type(box: HTMLInputElement, text: string): void {
  fireEvent.input(box, { target: { value: text } });
  fireEvent.change(box, { target: { value: text } });
}

beforeEach(async () => {
  pack = await Pack.open(new MemorySource(readTree(EXAMPLE_PACK)));
  journal = new Journal(pack);
  setLang('en');
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('a form built from the schema', () => {
  it("shows a type's fields with units, the engine's values and the schema's descriptions, in the interface language", async () => {
    const { container } = render(<Form file={COACH} kind="wagon_type" />);
    expect(input(container, '/mass_t').value).toBe('42');
    const train = input(container, '/brakes/train_kn');
    expect(train.value).toBe('');
    expect(train.placeholder).toBe('46.2');
    expect(field(container, '/brakes/train_kn').querySelector('.field-default')?.textContent).toBe(
      'If left out, the engine takes 46.2\u00a0kN (kn_per_t(system) · mass_t)',
    );
    expect(field(container, '/mass_t').querySelector('.field-unit')?.textContent).toBe('tonne');
    expect(field(container, '/mass_t').querySelector('.field-help')?.textContent).toBe(typeSchema.properties.mass_t?.description);
    expect(field(container, '/max_speed_kmh').querySelector('.field-default')?.textContent).toBe('If left out: 0\u00a0km/h');

    setLang('ru');
    await waitFor(() => expect(field(container, '/mass_t').querySelector('.field-help')?.textContent).toBe(typeSchema.properties.mass_t?.['x-description-ru']));
    expect(field(container, '/brakes/train_kn').querySelector('.field-default')?.textContent).toBe(
      'Если не задано, движок возьмёт 46.2\u00a0кН (кН/т пресета system · mass_t)',
    );
    expect(field(container, '/mass_t').querySelector('.field-unit')?.textContent).toBe('т');
  });

  it('commits an edit as one command of the journal, which undo and redo take back and forth', async () => {
    const { container } = render(<Form file={COACH} kind="wagon_type" />);
    type(input(container, '/mass_t'), '50');
    expect(pack.json(COACH)).toMatchObject({ mass_t: 50 });
    expect(journal.state().done).toEqual([{ label: 'forms.command.set', labelParams: { field: 'mass_t' }, ops: [{ op: 'set', file: COACH, at: '/mass_t', value: 50 }] }]);
    await waitFor(() => expect(input(container, '/brakes/train_kn').placeholder).toBe('55'));

    journal.undo();
    tick.value++;
    await waitFor(() => expect(input(container, '/mass_t').value).toBe('42'));
    journal.redo();
    tick.value++;
    await waitFor(() => expect(input(container, '/mass_t').value).toBe('50'));
  });

  it('keeps an explicit 0 apart from an empty field, which removes the key; refuses what is not a number', async () => {
    const { container } = render(<Form file={COACH} kind="wagon_type" />);
    type(input(container, '/brakes/train_kn'), '0');
    expect(pack.json(COACH)).toMatchObject({ brakes: { system: 'ep', parking_kn: 18, train_kn: 0 } });
    await waitFor(() => expect(input(container, '/brakes/train_kn').value).toBe('0'));
    type(input(container, '/brakes/train_kn'), '');
    expect((pack.json(COACH) as { brakes: object }).brakes).toEqual({ system: 'ep', parking_kn: 18 });

    type(input(container, '/couplers/front'), '1,5');
    await waitFor(() => expect(field(container, '/couplers/front').querySelector('[role="alert"]')?.textContent).toContain('Not a number'));
    expect(pack.json(COACH)).toMatchObject({ couplers: { front: -0.05 } });
    // a section the file lacks is created by the first edit inside it
    type(input(container, '/traction/ramp_s'), '5');
    expect(pack.json(COACH)).toMatchObject({ traction: { ramp_s: 5 } });
  });

  it('edits an enumeration, a dictionary, a list of scalars and a choice of forms', async () => {
    const { container } = render(<Form file={COACH_MODEL} kind="wagon_model" />);
    // a choice: the wheels' loop from an object to a string carries `main` over
    const wheels = field(container, '/sounds/wheels');
    const radios = wheels.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    expect([...radios].map((r) => r.checked)).toEqual([false, true]);
    fireEvent.click(radios[0] as HTMLInputElement);
    expect((pack.json(COACH_MODEL) as { sounds: { wheels: unknown } }).sounds.wheels).toBe('minecraft:entity.minecart.riding');

    // a dictionary: a new key with its value
    const liveries = field(container, '/liveries');
    const [key, value] = [...liveries.querySelectorAll<HTMLInputElement>('.field-dict-add input')];
    fireEvent.input(key as HTMLInputElement, { target: { value: 'blue' } });
    fireEvent.click(liveries.querySelector('.field-dict-add button') as HTMLElement);
    await waitFor(() => expect(liveries.querySelector('[role="alert"]')).not.toBeNull());
    fireEvent.input(key as HTMLInputElement, { target: { value: 'red' } });
    fireEvent.input(value as HTMLInputElement, { target: { value: 'l_red' } });
    fireEvent.click(liveries.querySelector('.field-dict-add button') as HTMLElement);
    expect((pack.json(COACH_MODEL) as { liveries: unknown }).liveries).toEqual({ blue: 'l_blue', red: 'l_red' });

    // a list of scalars: add one, then remove the first
    await waitFor(() => expect(field(container, '/skip').querySelectorAll('input')).toHaveLength(2));
    type(field(container, '/skip').querySelectorAll<HTMLInputElement>('input')[1] as HTMLInputElement, 'X_');
    expect((pack.json(COACH_MODEL) as { skip: unknown }).skip).toEqual(['GUIDE_', 'X_']);
    await waitFor(() => expect(field(container, '/skip').querySelectorAll('.field-remove')).toHaveLength(2));
    fireEvent.click(field(container, '/skip').querySelector('.field-remove') as HTMLElement);
    expect((pack.json(COACH_MODEL) as { skip: unknown }).skip).toEqual(['X_']);

    cleanup();
    const typeForm = render(<Form file={COACH} kind="wagon_type" />).container;
    const system = field(typeForm, '/brakes/system').querySelector('select') as HTMLSelectElement;
    expect(system.value).toBe('2');
    fireEvent.change(system, { target: { value: '1' } });
    expect(pack.json(COACH)).toMatchObject({ brakes: { system: 'freight' } });
    await waitFor(() => expect(input(typeForm, '/brakes/train_kn').placeholder).toBe('25.2'));
    fireEvent.change(field(typeForm, '/brakes/system').querySelector('select') as HTMLSelectElement, { target: { value: '' } });
    expect((pack.json(COACH) as { brakes: object }).brakes).toEqual({ parking_kn: 18 });
  });

  it('edits flags and fixed tuples, and lists of objects, where the spatial fields are not hidden', async () => {
    const { container } = render(<Form file={COACH} kind="wagon_type" spatialNote={false} />);
    const inner = input(container, '/doors/0/inner');
    expect(inner.type).toBe('checkbox');
    expect(inner.checked).toBe(false);
    fireEvent.change(inner, { target: { checked: true } });
    expect((pack.json(COACH) as { doors: object[] }).doors[0]).toMatchObject({ id: 'door_fl', inner: true });
    await waitFor(() => expect(field(container, '/doors/0/inner').querySelector('.field-action')).not.toBeNull());
    fireEvent.click(field(container, '/doors/0/inner').querySelector('.field-action') as HTMLElement);
    expect((pack.json(COACH) as { doors: object[] }).doors[0]).not.toHaveProperty('inner');

    const min = field(container, '/doors/0/min').querySelectorAll<HTMLInputElement>('input');
    expect(min).toHaveLength(3);
    type(min[1] as HTMLInputElement, '1.5');
    expect((pack.json(COACH) as { doors: { min: number[] }[] }).doors[0]?.min[1]).toBe(1.5);
    expect(field(container, '/doors/0').querySelector('legend')?.textContent).toContain('frame: OBJ frame');
  });

  it('marks statuses and old forms, and shows the spatial markup as a summary', async () => {
    const shunter = 'data/rwat_example/wagon_types/shunter.json';
    const { container } = render(<Form file={shunter} kind="wagon_type" />);
    expect(field(container, '/brakes/dynamic_kn').querySelector('.badge-status')?.textContent).toBe('reserved');
    expect(field(container, '/cab/seats').querySelector('.field-spatial')?.textContent).toContain('Now: 2 items.');
    expect([...container.querySelectorAll<HTMLElement>('[data-pointer]')].map((el) => el.dataset.pointer)).not.toContain('/cab/seat');
    expect(field(container, '/doors').querySelector('.field-spatial')?.textContent).toContain('2 items');

    edit({ label: 'x', ops: [{ op: 'set', file: shunter, at: '/cab', value: { seat: [0, 1, 0] } }] });
    await waitFor(() => expect(field(container, '/cab/seat').querySelector('.badge-deprecated')?.textContent).toBe('Deprecated'));
    setLang('ru');
    await waitFor(() => expect(field(container, '/brakes/dynamic_kn').querySelector('.badge-status')?.textContent).toBe('Зарезервировано'));
  });

  it('shows the findings next to their fields, and renames an unknown key to the nearest known one', async () => {
    const { container } = render(<Form file={COACH} kind="wagon_type" />);
    edit({
      label: 'x',
      ops: [
        { op: 'remove', file: COACH, at: '/length' },
        { op: 'set', file: COACH, at: '/lenght', value: 20 },
        { op: 'set', file: COACH, at: '/max_speed_kmh', value: 'fast' },
      ],
    });
    await waitFor(() => expect(field(container, '/length').classList.contains('field-has-error')).toBe(true));
    expect(field(container, '/length').querySelector('.field-problem')?.textContent).toBe('Error: the required key “length” is missing');
    expect(field(container, '/max_speed_kmh').querySelector('.field-wrong-type')).not.toBeNull();
    expect(input(container, '/max_speed_kmh').value).toBe('fast');
    expect(field(container, '/max_speed_kmh').querySelector('.field-problem')?.textContent).toBe('Error: expected a number, got a string "fast"');

    const unknown = field(container, '/lenght');
    expect(unknown.querySelector('.field-problem')?.textContent).toBe('Error: unknown key “lenght” — did you mean “length”?');
    fireEvent.click(unknown.querySelector('.field-action') as HTMLElement);
    expect(pack.json(COACH)).toMatchObject({ length: 20 });
    expect(pack.json(COACH)).not.toHaveProperty('lenght');
    await waitFor(() => expect(field(container, '/length').classList.contains('field-has-error')).toBe(false));
  });

  it('lists the findings about no field on top, and edits nothing when read-only', () => {
    edit({ label: 'x', ops: [{ op: 'set', file: COACH, at: '', value: [] }] });
    const { container } = render(<Form file={COACH} kind="wagon_type" readOnly />);
    expect(container.querySelector('.form-problems')?.textContent).toContain('expected an object');
    cleanup();
    journal.undo();
    const view = render(<Form file={COACH} kind="wagon_type" readOnly />).container;
    expect(input(view, '/mass_t').disabled).toBe(true);
    expect(view.querySelector('.field-action')).toBeNull();
  });
});

describe('a form over layers (an override on top of what the converter derives)', () => {
  /** What the converter derives, in the shape of an override. */
  const DERIVED = { type: { length: 20, bogies: [7, -7], mass_t: 40, max_speed_kmh: 120, brakes: { system: 'passenger' } }, model: { obj: 'stock/car/car.obj', sway: 1 } };
  const top = signal<Record<string, unknown>>({});
  const calls: string[] = [];

  /** The objects on the way to a place, made where the override has none. */
  function fill(value: Record<string, unknown>, pointer: string): Record<string, unknown> {
    const segments = parsePointer(pointer);
    let root: unknown = value;
    for (let i = 1; i < segments.length; i++) {
      const place = segments.slice(0, i);
      if (!isJsonObject(getAt(root, formatPointer(place)))) root = setIn(root, place, {}).root;
    }
    return root as Record<string, unknown>;
  }

  /** The layers: the override is {@link top}; what the pack gets is the derived value with it merged on top. */
  const layers: FormLayers = {
    view: (pointer) => ({ state: fieldState(top.value, pointer).state, derived: getAt(DERIVED, pointer) }),
    canRemove: (pointer) => canRemove(pointer),
    set: (pointer, value) => {
      calls.push(`set ${pointer} ${JSON.stringify(value)}`);
      top.value = setIn(fill(top.value, pointer), parsePointer(pointer), value).root as Record<string, unknown>;
    },
    reset: (pointer) => {
      calls.push(`reset ${pointer}`);
      top.value = getAt(top.value, pointer) === undefined ? top.value : (removeIn(top.value, parsePointer(pointer)).root as Record<string, unknown>);
    },
    remove: (pointer) => {
      calls.push(`remove ${pointer}`);
      top.value = setIn(fill(top.value, pointer), parsePointer(pointer), null).root as Record<string, unknown>;
    },
  };

  function Layered() {
    const section = (key: 'type' | 'model'): Record<string, unknown> => (isJsonObject(top.value[key]) ? (top.value[key]) : {});
    const merged = { type: deepMerge(DERIVED.type, section('type')), model: deepMerge(DERIVED.model, section('model')) };
    return <SchemaForm file="packs/r/car.json" kind="recipe_override" value={merged} schema={schema} problems={[]} layers={layers} spatialNote onCommand={() => calls.push('command')} />;
  }

  beforeEach(() => {
    top.value = {};
    calls.length = 0;
  });

  const state = (container: Element, pointer: string): string | undefined => field(container, pointer).dataset.layer;
  const badge = (container: Element, pointer: string): string | null | undefined => field(container, pointer).querySelector('.badge-layer')?.textContent;
  const button = (container: Element, pointer: string, action: string): HTMLElement | null => field(container, pointer).querySelector<HTMLElement>(`.field-head [data-action="${action}"]`);

  it('shows what the pack gets, each field derived, set or removed, and the derived value under one that hides it', async () => {
    top.value = { type: { mass_t: 33, max_speed_kmh: null } };
    const { container } = render(<Layered />);
    expect(input(container, '/type/length').value).toBe('20');
    expect(state(container, '/type/length')).toBe('derived');
    expect(badge(container, '/type/length')).toBe('derived');
    expect(input(container, '/type/mass_t').value).toBe('33');
    expect(state(container, '/type/mass_t')).toBe('set');
    expect(badge(container, '/type/mass_t')).toBe('in the override');
    expect(field(container, '/type/mass_t').querySelector('.field-derived')?.textContent).toBe('Derived by the converter: 40 tonne');
    expect(input(container, '/type/max_speed_kmh').value).toBe('');
    expect(state(container, '/type/max_speed_kmh')).toBe('removed');
    expect(badge(container, '/type/max_speed_kmh')).toBe('removed (null)');
    // nothing derived and nothing on top: no badge, the engine's value as in a pack's form
    expect(state(container, '/type/aliases')).toBe('derived');
    expect(badge(container, '/type/aliases')).toBeUndefined();
    // the type's engine values are figured from what the pack gets
    expect(input(container, '/type/brakes/train_kn').placeholder).toBe('33');
    setLang('ru');
    await waitFor(() => expect(badge(container, '/type/max_speed_kmh')).toBe('удалено (null)'));
    expect(badge(container, '/type/length')).toBe('выведено');
  });

  it('puts an edit on top and offers the way back, never as ops of the file', async () => {
    const { container } = render(<Layered />);
    type(input(container, '/type/mass_t'), '50');
    expect(calls).toEqual(['set /type/mass_t 50']);
    await waitFor(() => expect(state(container, '/type/mass_t')).toBe('set'));
    fireEvent.click(button(container, '/type/mass_t', 'reset') as HTMLElement);
    expect(calls.at(-1)).toBe('reset /type/mass_t');
    await waitFor(() => expect(state(container, '/type/mass_t')).toBe('derived'));
    expect(input(container, '/type/mass_t').value).toBe('40');
    // clearing a field is a reset, not "the engine's value"
    type(input(container, '/type/mass_t'), '45');
    await waitFor(() => expect(input(container, '/type/mass_t').value).toBe('45'));
    type(input(container, '/type/mass_t'), '');
    expect(calls.at(-1)).toBe('reset /type/mass_t');
    expect(calls).not.toContain('command');
  });

  it('removes a derived field where null removes it, and brings it back', async () => {
    const { container } = render(<Layered />);
    fireEvent.click(button(container, '/type/max_speed_kmh', 'remove') as HTMLElement);
    expect(calls).toEqual(['remove /type/max_speed_kmh']);
    await waitFor(() => expect(state(container, '/type/max_speed_kmh')).toBe('removed'));
    expect(button(container, '/type/max_speed_kmh', 'remove')).toBeNull();
    fireEvent.click(button(container, '/type/max_speed_kmh', 'reset') as HTMLElement);
    await waitFor(() => expect(state(container, '/type/max_speed_kmh')).toBe('derived'));
    // no "remove" where the converter reads null as "not given": a whole section; nor where nothing is derived
    expect(container.querySelector('[data-pointer="/type"] > legend [data-action="remove"]')).toBeNull();
    expect(button(container, '/type/aliases', 'remove')).toBeNull();
  });

  it('puts a list on top whole: an element typed into, one added, one removed', async () => {
    const { container } = render(<Layered />);
    const boxes = () => field(container, '/type/bogies').querySelectorAll<HTMLInputElement>('input');
    type(boxes()[1] as HTMLInputElement, '-6.5');
    expect(calls).toEqual(['set /type/bogies/1 -6.5']);
    calls.length = 0;
    top.value = { type: { bogies: [7, -6.5] } };
    await waitFor(() => expect(boxes()[1]?.value).toBe('-6.5'));
    // the elements have no state of their own: the list is one value on top
    expect(state(container, '/type/bogies')).toBe('set');
    expect(field(container, '/type/bogies/0').dataset.layer).toBeUndefined();
    type(boxes()[2] as HTMLInputElement, '0');
    expect(calls).toEqual(['set /type/bogies [7,-6.5,0]']);
    fireEvent.click(field(container, '/type/bogies').querySelector('.field-remove') as HTMLElement);
    expect(calls.at(-1)).toBe('set /type/bogies [-6.5,0]');
  });
});
