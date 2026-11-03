/**
 * The model worker (docs/proposals/editor.md §3.11): parses the open model off the main
 * thread — the OBJ, its MTLs and `.anim`s through the ports, the roles of its parts, the
 * buffers of each object × material pair, the textures decoded, what the pack check says
 * of its files (ports/modelCheck) — and transfers the result; and checks a model's files
 * alone, one model after another, for "Check all models" (checks/model). Everything it does
 * is model/api.ts; started by model/client.ts `startModelWorker`, one for the page.
 */

import { expose } from 'comlink';
import { createModelApi } from '../model/api';

expose(createModelApi());
