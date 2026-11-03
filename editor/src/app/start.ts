import { effect } from '@preact/signals';
import { h, render } from 'preact';
import { lang, t } from '../i18n';
import { lazyModelWorker, ModelLoader } from '../model/client';
import { preview } from '../preview/store';
import { view } from '../view3d/state';
import { connectModel } from './openModel';
import { panels } from './panels';
import { registerServiceWorker } from './pwa';
import { installShortcuts, loadSchema } from './session';
import { Shell } from './Shell';

/**
 * Starts the editor in the page: the document follows the interface language (its
 * `lang` and title, §6.3), the shell is drawn into `root`, the open wagon's model is read
 * in the model worker (started when the first model is) and shown in the 3D view and the
 * preview, and the built site registers its service worker.
 */
export function start(root: HTMLElement): void {
  effect(() => {
    document.documentElement.lang = lang.value;
    document.title = t('shell.title');
  });
  preview.view.value = view;
  connectModel({ loader: new ModelLoader(lazyModelWorker()), view, preview });
  render(h(Shell, { panels }), root);
  installShortcuts();
  void loadSchema();
  if (import.meta.env.PROD) registerServiceWorker();
}
