import { definePanel } from '../../app/registry';
import { TreePanel } from './TreePanel';

export default definePanel({ id: 'tree', slot: 'tree', order: 10, title: 'tree.title', modes: ['2a'], component: TreePanel });
