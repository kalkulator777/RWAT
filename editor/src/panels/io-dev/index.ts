import { definePanel } from '../../app/registry';
import * as io from '../../io';
import { IoDevPanel } from './IoDevPanel';

// Temporary (A1.2): the Playwright tests drive the File System Access code through the
// browser's private file system, which no picker can reach.
(globalThis as { rwatIo?: typeof io }).rwatIo = io;

export default definePanel({ id: 'io-dev', slot: 'bottom', order: 900, title: 'iodev.title', component: IoDevPanel });
