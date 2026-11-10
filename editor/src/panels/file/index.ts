import { definePanel } from '../../app/registry';
import { FilePanel } from './FilePanel';

export default definePanel({ id: 'file', slot: 'toolbar', order: 10, title: 'file.title', component: FilePanel });
