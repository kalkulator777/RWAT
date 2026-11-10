import { computed, effect } from '@preact/signals';
import { h, render } from 'preact';
import { lang } from '../i18n';
import { lazyModelWorker, ModelLoader } from '../model/client';
import { preview } from '../preview/store';
import { toolHost } from '../tools';
import { view } from '../view3d/state';
import { startIr } from './ir';
import { connectModel } from './openModel';
import { panels } from './panels';
import { registerServiceWorker } from './pwa';
import { startSave } from './save';
import { dispatch, installShortcuts, loadSchema } from './session';
import { Shell } from './Shell';
import { mode, openModel, openWagon, pack, revision, selection } from './store';

/** The doors the preview shows open or opening, as the engine's open-door bits; null with nothing previewed. */
const previewDoors = computed<number | null>(() => {
  const state = preview.state.value;
  if (state === null) return null;
  let bits = 0;
  state.doors.forEach((progress, i) => {
    const heading = state.heading[i];
    if (i < 32 && (heading === 1 || (heading !== 0 && progress > 0))) bits |= 1 << i;
  });
  return bits;
});

/**
 * Starts the editor in the page: the document follows the interface language (its
 * `lang`, §6.3), the shell is drawn into `root`, the open wagon's model is read in the
 * model worker (started when the first model is) and shown in the 3D view and the
 * preview, the markup tools work on the open wagon, saving and the session start (the
 * window's title with the mark of unsaved changes, the restore question: app/save), and
 * the built site registers its service worker. In the IR mode (2b) the IR session's type is
 * shown in the same view and preview (app/ir) and the pack's wiring lets them be; the
 * markup tools work on the pack's wagons only (in 2b they see none).
 */
export function start(root: HTMLElement): void {
  effect(() => {
    document.documentElement.lang = lang.value;
  });
  preview.view.value = view;
  connectModel({ loader: new ModelLoader(lazyModelWorker()), view, preview, active: computed(() => mode.value === '2a') });
  startIr({ loader: new ModelLoader(lazyModelWorker()), view, preview });
  const packOf2a = computed(() => (mode.value === '2a' ? pack.value : null));
  toolHost.connect({ pack: packOf2a, revision, openWagon, openModel, selection, dispatch, view, previewDoors });
  render(h(Shell, { panels }), root);
  installShortcuts();
  startSave();
  void loadSchema();
  if (import.meta.env.PROD) registerServiceWorker();
}
