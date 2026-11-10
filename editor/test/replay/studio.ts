/**
 * The editor as its user drives it, for the replay tests (docs/proposals/editor.md §1.4
 * item 1, §5.1): the shell's state (app/store) and session (app/session) as app/start.ts
 * wires them — the open wagon's model read by the model pipeline (app/openModel
 * `connectModel` over the worker's own code, here in this thread), the markup tools
 * connected to the shell's state — and the panels a user types into, drawn by Preact in
 * happy-dom: the wizard's dialogs of the top bar, the inspector's form, the rename dialog,
 * the names tab, the sounds tab. Each action is what a click or a box typed into and
 * committed does there; the 3D gestures are the markup tools' own (tools/scenarios.node.ts:
 * a drag, a click on the model, a number typed), over the view's state without a drawing,
 * as in the M4 scenario.
 *
 * Every action says how many commands of the journal it makes (one, mostly) and fails when
 * it makes another number or the panel refuses it (an error in the dialog, a box marked
 * invalid): the replay is then a list of commands, each one an action of the user.
 *
 * The test that uses it asks for happy-dom (`// @vitest-environment happy-dom`).
 */

import { signal } from '@preact/signals';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { h, type ComponentType } from 'preact';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { connectModel } from '../../src/app/openModel';
import { useSessionStore } from '../../src/app/save/keep';
import { dispatch, run } from '../../src/app/session';
import { failure, journal, modelLoading, modelProblems, openModel, openWagon, pack, revision, schema, schemaError, selection } from '../../src/app/store';
import type { Op } from '../../src/core/contracts';
import { modelPath, typePath } from '../../src/core/pack';
import { createSchema } from '../../src/core/schema';
import { readSchemaFiles } from '../../src/core/schema/files.node';
import { MemoryStore } from '../../src/core/session';
import { setLang } from '../../src/i18n';
import { createModelApi } from '../../src/model/api';
import { ModelLoader } from '../../src/model/client';
import { fakeBitmap } from '../../src/model/testing.node';
import { InspectorPanel } from '../../src/panels/inspector/InspectorPanel';
import { NamesPanel } from '../../src/panels/names/NamesPanel';
import { NewPackPanel } from '../../src/panels/newpack/NewPackPanel';
import { SoundsPanel } from '../../src/panels/sounds/SoundsPanel';
import { toolHost } from '../../src/tools';
import type { Bench } from '../../src/tools/testing.node';
import { ViewState } from '../../src/view3d/state';

/** The label of a command a step wrote as JSON itself (TODO(gap)): no panel makes it. */
export const GAP_LABEL = 'replay.gap';

/** How long a panel may take to answer an action (a model read, a command run), ms: generous for an instrumented run. */
const WAIT = { timeout: 15_000 };

/** The commands the open pack's journal has applied. */
export function commandCount(): number {
  const state = journal.value?.state();
  return state === undefined ? 0 : state.committed.length + state.done.length;
}

/** The text of the alerts inside an element (a dialog's refusals, a box's error). */
function alerts(root: Element): string {
  return [...root.querySelectorAll('[role="alert"]')].map((el) => el.textContent?.trim() ?? '').join(' | ');
}

/** Lets Preact draw what the last signals changed. */
async function settle(): Promise<void> {
  await act(() => Promise.resolve());
}

/** Types into a box and commits it, as Enter or leaving the box does. */
function type(box: HTMLInputElement, text: string): void {
  fireEvent.input(box, { target: { value: text } });
  fireEvent.change(box, { target: { value: text } });
}

/** Types into a box without committing it (a dialog's boxes are read on submit). */
function fill(box: HTMLInputElement, text: string): void {
  fireEvent.input(box, { target: { value: text } });
}

/** A file of the user's disk as the browser's file picker hands it over. */
function diskFile(path: string): File {
  return new File([new Uint8Array(readFileSync(path))], basename(path));
}

/** Hands files to a file input, as picking them in the browser's dialog does. */
function pick(input: HTMLInputElement, files: readonly File[]): void {
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  fireEvent.change(input);
}

function one<E extends Element>(root: ParentNode, selector: string, what = selector): E {
  const found = root.querySelector<E>(selector);
  if (found === null) throw new Error(`no ${what}`);
  return found;
}

/** The element of a field of a form by its pointer (`[data-pointer]`, which a CSS selector would have to escape). */
function fieldAt(root: ParentNode, at: string): HTMLElement {
  const found = [...root.querySelectorAll<HTMLElement>('[data-pointer]')].find((el) => el.dataset.pointer === at);
  if (found === undefined) throw new Error(`the form shows no field ${at}`);
  return found;
}

/** What the new pack dialog asks. */
export interface NewPackAnswers {
  name: string;
  namespace: string;
  title: string;
  version: string;
  authors: string;
  license: string;
  description: string;
}

/** What the add wagon dialog asks; the files are paths on the disk, picked in the browser's dialog. */
export interface WagonAnswers {
  id: string;
  folder: string;
  files: readonly string[];
  length: string;
  mass: string;
  bogieFront: string;
  bogieRear: string;
  names: { en_us: string; ru_ru: string };
}

/** What the add rail style dialog asks. */
export interface RailAnswers {
  id: string;
  folder: string;
  files: readonly string[];
  tileLength: string;
  names: { en_us: string; ru_ru: string };
}

/** The editor in happy-dom, driven as a user drives it. */
export class Studio {
  /** The view's state (no drawing): what the markup tools put there and what their gestures go through. */
  readonly view = new ViewState();
  private readonly stops: (() => void)[] = [];
  private readonly roots: { bar: HTMLElement; inspector: HTMLElement; names: HTMLElement; sounds: HTMLElement };

  private constructor() {
    for (const s of [journal, pack, schema, schemaError, failure, openWagon, openModel] as const) (s as { value: unknown }).value = null;
    selection.value = [];
    revision.value = 0;
    modelLoading.value = false;
    modelProblems.value = [];
    setLang('en');
    schema.value = createSchema(readSchemaFiles());
    // the session is kept as the page keeps it, in a store in memory instead of IndexedDB
    useSessionStore(new MemoryStore(), { delay: 0 });
    const loader = new ModelLoader(createModelApi((_bytes, path) => Promise.resolve(fakeBitmap(path))));
    this.stops.push(connectModel({ loader, view: this.view, preview: { load: () => undefined }, delayMs: 0 }));
    this.stops.push(toolHost.connect({ pack, revision, openWagon, openModel, selection, dispatch, view: this.view, previewDoors: signal(null) }));
    const draw = (panel: ComponentType): HTMLElement => render(h(panel, null)).container as HTMLElement;
    this.roots = { bar: draw(NewPackPanel), inspector: draw(InspectorPanel), names: draw(NamesPanel), sounds: draw(SoundsPanel) };
  }

  static start(): Studio {
    return new Studio();
  }

  stop(): void {
    toolHost.use(null);
    for (const stop of this.stops.splice(0).reverse()) stop();
    cleanup();
    useSessionStore(null);
  }

  /**
   * Runs an action that makes `commands` commands of the journal and waits until it has
   * made them; what the panel or the shell says to refuse it (`refusal`, the failure
   * banner) fails it at once, with the words.
   */
  private async expectCommands(commands: number, action: () => void | Promise<void>, refusal: () => string = () => ''): Promise<void> {
    const before = commandCount();
    await action();
    let refused = '';
    await waitFor(() => {
      refused = refusal() || (failure.value === null ? '' : `${failure.value.key} ${JSON.stringify(failure.value.params)}`);
      if (refused === '' && commandCount() !== before + commands) throw new Error(`${commandCount() - before} commands made, ${commands} expected`);
    }, WAIT);
    if (refused !== '') throw new Error(`refused: ${refused}`);
    await settle();
    if (commandCount() !== before + commands) throw new Error(`${commandCount() - before} commands made, ${commands} expected`);
  }

  /** What the steps wrote as JSON themselves, one entry a command: the gap each names (TODO(gap)). */
  readonly gaps: string[] = [];

  /**
   * TODO(gap): writes JSON the editor has no way to write, as one command of the journal
   * labelled {@link GAP_LABEL}. Only a step that names its gap (`Step.gap`) may call it; the
   * test counts these commands, and their number may only go down.
   */
  async write(gap: string, ops: Op[]): Promise<void> {
    this.gaps.push(gap);
    await this.expectCommands(1, async () => void (await run({ label: GAP_LABEL, labelParams: { gap }, ops })));
  }

  // ------------------------------------------------------------------ the top bar's dialogs

  /** A button of the top bar, then its dialog filled in and submitted; resolves once it closed (a refusal throws with its text). */
  private async dialog(button: string, testId: string, answer: (dialog: HTMLElement) => void): Promise<void> {
    fireEvent.click(one(this.roots.bar, `[data-testid="${button}"]`));
    const dialog = await waitFor(() => one<HTMLElement>(this.roots.bar, `[data-testid="${testId}"]`), WAIT);
    answer(dialog);
    fireEvent.submit(one<HTMLFormElement>(dialog, 'form'));
    let refused = '';
    await waitFor(() => {
      refused = alerts(dialog);
      if (refused === '' && this.roots.bar.querySelector(`[data-testid="${testId}"]`) !== null) throw new Error(`${testId} is still open`);
    }, WAIT);
    if (refused !== '') throw new Error(`${testId} refused: ${refused}`);
    await settle();
  }

  private static box(dialog: HTMLElement, name: string): HTMLInputElement {
    return one<HTMLInputElement>(dialog, `input[name="${name}"]`, `box ${name}`);
  }

  /** «New pack»: the dialog answered; the pack it makes is the open one, with no command yet. */
  async newPack(answers: NewPackAnswers): Promise<void> {
    await this.dialog('new-pack', 'new-pack-dialog', (dialog) => {
      for (const name of Object.keys(answers) as (keyof NewPackAnswers)[]) fill(Studio.box(dialog, name), answers[name]);
    });
    await waitFor(() => {
      if (pack.value?.source.name !== answers.name) throw new Error('the new pack is not open');
    }, WAIT);
  }

  /** «Add wagon»: the dialog answered, its files picked from the disk; one command. */
  async addWagon(answers: WagonAnswers): Promise<void> {
    await this.expectCommands(1, () =>
      this.dialog('add-wagon', 'add-wagon-dialog', (dialog) => {
        fill(Studio.box(dialog, 'id'), answers.id);
        fill(Studio.box(dialog, 'folder'), answers.folder);
        pick(one(dialog, 'input[type="file"]'), answers.files.map(diskFile));
        fill(Studio.box(dialog, 'length'), answers.length);
        fill(Studio.box(dialog, 'mass_t'), answers.mass);
        fill(Studio.box(dialog, 'bogie_front'), answers.bogieFront);
        fill(Studio.box(dialog, 'bogie_rear'), answers.bogieRear);
        for (const [code, text] of Object.entries(answers.names)) fill(Studio.box(dialog, `name_${code}`), text);
      }),
    );
  }

  /** «Add rail style»: the dialog answered, the tile's files picked; one command. */
  async addRailStyle(answers: RailAnswers): Promise<void> {
    await this.expectCommands(1, () =>
      this.dialog('add-rail', 'add-rail-dialog', (dialog) => {
        fill(Studio.box(dialog, 'id'), answers.id);
        fill(Studio.box(dialog, 'folder'), answers.folder);
        pick(one(dialog, 'input[type="file"]'), answers.files.map(diskFile));
        fill(Studio.box(dialog, 'tile_length'), answers.tileLength);
        for (const [code, text] of Object.entries(answers.names)) fill(Studio.box(dialog, `name_${code}`), text);
      }),
    );
  }

  /** «Add files»: a folder of the pack ('' — its root) and files picked from the disk; one command. */
  async addFiles(folder: string, files: readonly string[]): Promise<void> {
    await this.expectCommands(1, () =>
      this.dialog('add-files', 'add-files-dialog', (dialog) => {
        fill(Studio.box(dialog, 'folder'), folder);
        pick(one(dialog, 'input[type="file"]'), files.map(diskFile));
      }),
    );
  }

  // ------------------------------------------------------------------------- the inspector

  /** Selects a file (a click on it in the tree): the inspector shows its form. */
  async select(file: string): Promise<Form> {
    selection.value = [{ kind: 'file', file }];
    await settle();
    await waitFor(() => one(this.roots.inspector, `[data-testid="inspector"][data-file="${file}"] .schema-form`, `the form of ${file}`), WAIT);
    return new Form(this.roots.inspector, (n, action, refusal) => this.expectCommands(n, action, refusal));
  }

  /** «Rename…» of the wagon whose type is selected, its new id typed: one command (the old id goes into `aliases`). */
  async rename(id: string, to: string): Promise<void> {
    await this.select(typePath(id));
    const inspector = this.roots.inspector;
    await this.expectCommands(1, async () => {
      fireEvent.click(one(inspector, '[data-testid="rename-wagon"]'));
      const dialog = await waitFor(() => one<HTMLElement>(inspector, '[data-testid="rename-dialog"]'), WAIT);
      fill(one(dialog, '#rename-id'), to);
      fireEvent.submit(one<HTMLFormElement>(dialog, 'form'));
    }, () => alerts(inspector));
    await waitFor(() => {
      if (inspector.querySelector('[data-testid="rename-dialog"]') !== null) throw new Error('the rename dialog is still open');
    }, WAIT);
  }

  // ------------------------------------------------------------------------ the open wagon

  /**
   * Opens a wagon (its type picked in the tree) and waits until its model is read as the
   * pack has it now: the markup tools work on it, the sounds tab shows it.
   */
  async openWagon(id: string): Promise<void> {
    selection.value = [{ kind: 'file', file: typePath(id) }];
    await this.modelRead(id);
  }

  /** Waits until the open wagon's model is read again after the last edit (the shell reads it a moment after each). */
  async modelRead(id: string): Promise<void> {
    await act(() => new Promise((done) => setTimeout(done, 0)));
    await waitFor(() => {
      if (openWagon.value !== id) throw new Error(`${id} is not open`);
      if (modelLoading.value || openModel.value?.id !== id) throw new Error(`the model of ${id} is not read yet`);
    }, WAIT);
    const declaration = pack.value?.json(modelPath(id));
    if (openModel.value?.problems.some((p) => p.severity === 'error')) {
      throw new Error(`the model of ${id} has errors: ${JSON.stringify(openModel.value.problems)} (declaration ${JSON.stringify(declaration)})`);
    }
    await settle();
  }

  /**
   * The open wagon's markup tool turned on in the view's bar, its session, and the bench
   * of the shell's state the tools' gestures go through (tools/scenarios.node.ts).
   */
  tool<S>(id: 'floor' | 'doors' | 'seats'): { session: S; bench: Bench } {
    toolHost.use(id);
    const on = toolHost.current.value;
    if (on?.tool.id !== id) throw new Error(`the ${id} tool does not turn on for ${String(openWagon.value)}`);
    const edits = journal.value;
    if (edits === null) throw new Error('no journal');
    const bench: Bench = {
      pack,
      journal: edits,
      revision,
      openWagon,
      openModel,
      selection,
      previewDoors: signal(null),
      view: this.view,
      commands: [],
      wiring: { pack, revision, openWagon, openModel, selection, dispatch, view: this.view, previewDoors: signal(null) },
    };
    return { session: on.session as S, bench };
  }

  /** Every markup tool off: the plain selection. */
  noTool(): void {
    toolHost.use(null);
  }

  /** Runs gestures of a markup tool (a drag, a click on the model, a number typed: a command each, a drag one however long); returns how many commands they made. */
  async gestures(action: () => void): Promise<number> {
    const before = commandCount();
    action();
    await settle();
    const made = commandCount() - before;
    if (made === 0) throw new Error('the gestures made no command');
    return made;
  }

  // ------------------------------------------------------------------------- the names tab

  /** The names tab: a name typed into its row (a wagon's, a rail style's, a light group's that is there). */
  async name(key: string, lang: string, text: string): Promise<void> {
    await settle();
    const row = [...this.roots.names.querySelectorAll<HTMLElement>('tr[data-key]')].find((tr) => tr.dataset.key === key);
    if (row === undefined) throw new Error(`the names tab has no row ${key}`);
    await this.expectCommands(1, () => type(one(row, `input[data-lang="${lang}"]`), text));
  }

  /** The names tab's «light group of a type»: the type chosen, the group as the OBJ spells it, its name in each language; one command. */
  async lightName(typeId: string, group: string, names: { en_us: string; ru_ru: string }): Promise<void> {
    await settle();
    const form = one<HTMLElement>(this.roots.names, '[data-testid="names-add-light"]');
    const choose = one<HTMLSelectElement>(form, 'select');
    fireEvent.change(choose, { target: { value: typeId } });
    await settle();
    const boxes = [...form.querySelectorAll<HTMLInputElement>('input[type="text"]')];
    const [groupBox, ...langBoxes] = boxes;
    if (groupBox === undefined || langBoxes.length < 2) throw new Error('the light group form has no boxes');
    await this.expectCommands(
      1,
      () => {
        fill(groupBox, group);
        for (const box of langBoxes) fill(box, names[(box.closest('label')?.textContent?.trim() ?? '') as keyof typeof names] ?? '');
        fireEvent.click(one(form, 'button'));
      },
      () => alerts(form),
    );
  }

  // ------------------------------------------------------------------------ the sounds tab

  /** The sounds tab of the open wagon. */
  async sounds(id: string): Promise<Sounds> {
    await settle();
    await waitFor(() => one(this.roots.sounds, `[data-testid="sounds"][data-wagon="${id}"]`, `the sounds of ${id}`), WAIT);
    return new Sounds(this.roots.sounds, (n, action, refusal) => this.expectCommands(n, action, refusal));
  }
}

type Expect = (commands: number, action: () => void | Promise<void>, refusal?: () => string) => Promise<void>;

/** The inspector's form of the selected file, typed into field by field. */
export class Form {
  constructor(
    private readonly root: HTMLElement,
    private readonly expect: Expect,
  ) {}

  private field(at: string): HTMLElement {
    return fieldAt(this.root, at);
  }

  private refusal(at: string): () => string {
    return () => {
      const element = [...this.root.querySelectorAll<HTMLElement>('[data-pointer]')].find((el) => el.dataset.pointer === at);
      return element === undefined ? '' : alerts(element);
    };
  }

  /** A number or a text typed into the field's box and committed. */
  async type(at: string, text: string): Promise<void> {
    await this.expect(1, () => type(one(this.field(at), 'input.field-input', `a box at ${at}`), text), this.refusal(at));
  }

  /** An option of the field's list chosen by its text. */
  async choose(at: string, option: string): Promise<void> {
    const select = one<HTMLSelectElement>(this.field(at), 'select.field-select', `a choice at ${at}`);
    const found = [...select.options].find((o) => o.textContent === option);
    if (found === undefined) throw new Error(`${at} offers no ${option}`);
    await this.expect(1, () => void fireEvent.change(select, { target: { value: found.value } }));
  }

  /** Each element of a list of scalars typed into the list's new box, one after the other: a command each. */
  async list(at: string, items: readonly string[]): Promise<void> {
    for (const item of items) {
      await this.expect(1, () => type(one(this.field(at), '.field-list-new input', `the new box of ${at}`), item), this.refusal(at));
    }
  }

  /** Each element of a fixed-size list (a range, a point) typed into its box: a command each. */
  async tuple(at: string, items: readonly string[]): Promise<void> {
    for (const [i, item] of items.entries()) {
      await this.expect(1, () => type(this.field(at).querySelectorAll<HTMLInputElement>('.field-tuple input')[i] as HTMLInputElement, item), this.refusal(at));
    }
  }

  /** An entry of a dictionary (`liveries`, `animations`): its key and its value typed in the row that adds one, then «Add». */
  async entry(at: string, key: string, value: string): Promise<void> {
    const row = one<HTMLElement>(this.field(at), '.field-dict-add', `the row that adds to ${at}`);
    const [keyBox, valueBox] = [...row.querySelectorAll<HTMLInputElement>('input')];
    if (keyBox === undefined || valueBox === undefined) throw new Error(`${at} takes no value with its key`);
    await this.expect(
      1,
      () => {
        fill(keyBox, key);
        fill(valueBox, value);
        fireEvent.click(one(row, 'button'));
      },
      () => alerts(row),
    );
  }
}

/** The sounds tab of the open wagon, typed into section by section. */
export class Sounds {
  constructor(
    private readonly root: HTMLElement,
    private readonly expect: Expect,
  ) {}

  private section(key: string): HTMLElement {
    return one(this.root, `[data-sound="${key}"]`, `the sounds section ${key}`);
  }

  /** A sound reference (`minecraft:…`, an event, an .ogg of the pack) typed into its row and committed. */
  async ref(pointer: string, text: string): Promise<void> {
    const row = [...this.root.querySelectorAll<HTMLElement>('[data-ref]')].find((el) => el.dataset.ref === pointer);
    if (row === undefined) throw new Error(`the sounds tab has no row ${pointer}`);
    await this.expect(1, () => type(one(row, 'input.sounds-ref-input'), text));
  }

  /** «As start, main, stop»: a loop given as one sound becomes `{main}`, which takes the rest. */
  async toObject(key: string): Promise<void> {
    await this.expect(1, () => void fireEvent.click(one(this.section(key), '.sounds-to-object')));
  }

  /** A loop's range (`pitch`, `volume`): its two numbers typed into their boxes, a command each. */
  async range(key: string, range: 'pitch' | 'volume', from: string, to: string): Promise<void> {
    const at = `/sounds/${key}/${range}`;
    for (const [i, text] of [from, to].entries()) {
      const boxes = fieldAt(one(this.section(key), `[data-testid="sounds-ranges-${key}"]`), at).querySelectorAll<HTMLInputElement>('input');
      await this.expect(1, () => type(boxes[i] as HTMLInputElement, text));
    }
  }

  /** A control key typed into «add a control» and added (its `move` and `engage` follow). */
  async addControl(key: string): Promise<void> {
    const add = one<HTMLElement>(this.root, '[data-testid="sounds-add-control"]');
    await this.expect(1, () => {
      fill(one(add, 'input[type="text"]'), key);
      fireEvent.click(one(add, 'button'));
    });
  }
}
