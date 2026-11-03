import { definePanel } from '../../app/registry';
import { PreviewPanel } from './PreviewPanel';

export default definePanel({ id: 'preview', slot: 'bottom', order: 30, title: 'preview.title', component: PreviewPanel });
