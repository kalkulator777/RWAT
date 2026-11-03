import { definePanel } from '../../app/registry';
import { NamesPanel } from './NamesPanel';

/** After the bottom tabs of §6.1 (checks 10 … log 50): the names table is wide, so it lives under the view. */
export default definePanel({ id: 'names', slot: 'bottom', order: 60, title: 'names.title', modes: ['2a'], component: NamesPanel });
