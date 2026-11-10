import { definePanel } from '../../app/registry';
import { SoundsPanel } from './SoundsPanel';

/** After the names table (order 60): the bottom tabs of §6.1 are checks 10, objects 20, preview 30, journal 40, log 50. */
export default definePanel({ id: 'sounds', slot: 'bottom', order: 70, title: 'sounds.title', modes: ['2a'], component: SoundsPanel });
