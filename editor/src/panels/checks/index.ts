import { definePanel } from '../../app/registry';
import { ChecksPanel } from './ChecksPanel';

export default definePanel({ id: 'checks', slot: 'bottom', order: 10, title: 'checks.title', component: ChecksPanel });
