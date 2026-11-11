import { definePanel } from '../../app/registry';
import { KeysPanel } from '../../app/keys/KeysButton';

/** The Keys button in the top bar, its window and the live region of the key map; the module is app/keys. */
export default definePanel({ id: 'keys', slot: 'toolbar', order: 90, title: 'keys.title', component: KeysPanel });
