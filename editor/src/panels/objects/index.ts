import { definePanel } from '../../app/registry';
import { ObjectsPanel } from './ObjectsPanel';

export default definePanel({ id: 'objects', slot: 'bottom', order: 20, title: 'objects.title', component: ObjectsPanel });
