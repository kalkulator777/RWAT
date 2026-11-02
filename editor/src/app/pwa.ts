/**
 * Offline (docs/proposals/editor.md §5.5): the service worker precaches the shell — HTML,
 * JS, CSS, fonts, icons, the schema — on the first visit, so the editor opens without a
 * network afterwards. Pyodide is cached when first used (vite.config.ts). A new version
 * of the site waits until the user reloads from the notice (./store.ts `updateReady`).
 */

import { registerSW } from 'virtual:pwa-register';
import { updateReady } from './store';

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  const update = registerSW({
    onNeedRefresh() {
      updateReady.value = () => {
        void update(true);
      };
    },
    onRegisterError(error: unknown) {
      console.warn('The service worker did not register; the editor works but not offline.', error);
    },
  });
}
