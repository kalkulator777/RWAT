/**
 * The model worker (docs/proposals/editor.md §3.11): parses the open model off the main
 * thread — the OBJ, its MTLs and `.anim`s through the ports, the roles of its parts, the
 * buffers of each object × material pair, the textures decoded — and transfers the result.
 * Everything it does is model/api.ts; started by model/client.ts `startModelWorker`.
 */

import { expose } from 'comlink';
import { createModelApi } from '../model/api';

expose(createModelApi());
