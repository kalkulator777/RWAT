import { definePanel } from '../../app/registry';
import { HelpButton } from '../../help/Help';

/** «Help» at the end of the top bar's buttons (editor.md §6.1); the help itself is src/help. */
export default definePanel({ id: 'help', slot: 'toolbar', order: 90, title: 'help.title', component: HelpButton });
