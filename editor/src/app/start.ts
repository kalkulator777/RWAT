import { effect } from '@preact/signals';
import { h, render } from 'preact';
import { lang, t } from '../i18n';
import { panels } from './panels';
import { registerServiceWorker } from './pwa';
import { Shell } from './Shell';

/**
 * Starts the editor in the page: the document follows the interface language (its
 * `lang` and title, §6.3), the shell is drawn into `root`, and the built site registers
 * its service worker.
 */
export function start(root: HTMLElement): void {
  effect(() => {
    document.documentElement.lang = lang.value;
    document.title = t('shell.title');
  });
  render(h(Shell, { panels }), root);
  if (import.meta.env.PROD) registerServiceWorker();
}
