import { computed, effect } from '@preact/signals';
import { h, render } from 'preact';
import { lang, t } from '../i18n';
import { lazyModelWorker, ModelLoader } from '../model/client';
import { preview } from '../preview/store';
import { toolHost } from '../tools';
import { view } from '../view3d/state';
import { connectModel } from './openModel';
import { panels } from './panels';
import { registerServiceWorker } from './pwa';
import { dispatch, installShortcuts, loadSchema } from './session';
import { Shell } from './Shell';
import { openModel, openWagon, pack, revision, selection } from './store';

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
 * `lang` and title, §6.3), the shell is drawn into `root`, the open wagon's model is read
 * in the model worker (started when the first model is) and shown in the 3D view and the
 * preview, the markup tools work on the open wagon, and the built site registers its
 * service worker.
 */
export function start(root: HTMLElement): void {
  effect(() => {
    document.documentElement.lang = lang.value;
    document.title = t('shell.title');
  });
  preview.view.value = view;
  connectModel({ loader: new ModelLoader(lazyModelWorker()), view, preview });
  toolHost.connect({ pack, revision, openWagon, openModel, selection, dispatch, view, previewDoors });
  render(h(Shell, { panels }), root);
  installShortcuts();
  void loadSchema();
  if (import.meta.env.PROD) registerServiceWorker();
}
