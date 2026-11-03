/**
 * Node only (tests of the tools): the example pack (CC0) opened in memory with its journal,
 * and the shell's state a tool host is wired to — signals as app/store has them, the
 * journal's dispatch, the view's own state (view3d `ViewState`: overlays, camera, dragger,
 * picks, without a drawing).
 */

import { signal, type Signal } from '@preact/signals';
import type { Command, Link, LoadedModel } from '../core/contracts';
import { Journal } from '../core/journal';
import { Pack } from '../core/pack';
import { EXAMPLE_PACK, MemorySource, readTree } from '../core/pack/testing.node';
import { ViewState } from '../view3d/state';
import type { ToolWiring } from './registry';

/** The example pack as the editor opens it, with a journal. */
export async function openExamplePack(): Promise<{ pack: Pack; journal: Journal }> {
  const pack = await Pack.open(new MemorySource(readTree(EXAMPLE_PACK), 'RwatExamplePack'));
  return { pack, journal: new Journal(pack) };
}

/** The shell's state for a tool host, its signals open to the test. */
export interface Bench {
  readonly pack: Signal<Pack | null>;
  readonly journal: Journal;
  readonly revision: Signal<number>;
  readonly openWagon: Signal<string | null>;
  readonly openModel: Signal<LoadedModel | null>;
  readonly selection: Signal<readonly Link[]>;
  readonly previewDoors: Signal<number | null>;
  readonly view: ViewState;
  /** The commands dispatched, refused ones included. */
  readonly commands: Command[];
  readonly wiring: ToolWiring;
}

/** The example pack open, `wagon` open with `model` shown. */
export async function bench(wagon: string | null = 'rwat_example:coach', model: LoadedModel | null = null): Promise<Bench> {
  const { pack, journal } = await openExamplePack();
  const revision = signal(0);
  journal.subscribe(() => {
    revision.value++;
  });
  const commands: Command[] = [];
  const state = {
    pack: signal<Pack | null>(pack),
    journal,
    revision,
    openWagon: signal<string | null>(wagon),
    openModel: signal<LoadedModel | null>(model),
    selection: signal<readonly Link[]>([]),
    previewDoors: signal<number | null>(null),
    view: new ViewState(),
    commands,
  };
  const wiring: ToolWiring = {
    ...state,
    dispatch: (command) => {
      commands.push(command);
      try {
        journal.dispatch(command);
        return true;
      } catch {
        return false;
      }
    },
  };
  return { ...state, wiring };
}
