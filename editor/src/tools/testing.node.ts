/**
 * Node only (tests of the tools): the example pack (CC0) opened in memory with its journal,
 * and the shell's state a tool host is wired to — signals as app/store has them, the
 * journal's dispatch, the view's own state (view3d `ViewState`: overlays, camera, dragger,
 * picks, without a drawing) — and, where a test needs what a click on the screen does, the
 * view's drawing without a canvas over them ({@link drawing}).
 */

import { signal, type Signal } from '@preact/signals';
import type { CameraView, Command, Link, LoadedModel, Vec3 } from '../core/contracts';
import { Journal } from '../core/journal';
import { Pack } from '../core/pack';
import { EXAMPLE_PACK, MemorySource, readTree } from '../core/pack/testing.node';
import { ViewState } from '../view3d/state';
import { ViewScene, type ClickKeys, type ViewHit } from '../view3d/viewScene';
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

/** The view's drawing over a bench's view and selection, as a user clicks it. */
export interface Drawing {
  readonly scene: ViewScene;
  /** A click on the screen where a point of the OBJ frame is drawn: the view picks what is there, tells the tools, selects. */
  click(point: Vec3, keys?: ClickKeys): ViewHit;
  stop(): void;
}

/** The view's drawing without a canvas (view3d `ViewScene`) over the bench's view and selection, `model` shown, from `camera`. */
export function drawing(b: Bench, model: LoadedModel, camera: CameraView = 'top'): Drawing {
  const scene = new ViewScene(b.view, b.selection);
  const stop = scene.start();
  scene.setAspect(16 / 9);
  b.view.show(model);
  b.view.setCamera(camera);
  return {
    scene,
    click(point, keys = {}) {
      const at = scene.project(point);
      return scene.clickAt(at.x, at.y, keys);
    },
    stop() {
      stop();
      scene.dispose();
    },
  };
}
