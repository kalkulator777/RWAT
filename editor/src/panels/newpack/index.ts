import { definePanel } from '../../app/registry';
import { NewPackPanel } from './NewPackPanel';

/** Before the file buttons (order 10): "New pack" and "Add wagon" open the wizard's dialogs. */
export default definePanel({ id: 'newpack', slot: 'toolbar', order: 5, title: 'newpack.title', modes: ['2a'], component: NewPackPanel });
