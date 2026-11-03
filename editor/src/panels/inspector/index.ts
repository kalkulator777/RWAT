import { definePanel } from '../../app/registry';
import { InspectorPanel } from './InspectorPanel';

export default definePanel({ id: 'inspector', slot: 'inspector', order: 10, title: 'inspector.title', modes: ['2a'], component: InspectorPanel });
