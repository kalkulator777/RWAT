/**
 * The model budget of docs/proposals/editor.md §3.11: the largest OBJ of MVP, the TEM2
 * (`mvp_ir_tem2.obj`, about 6 MB), is parsed by the model worker's pipeline within 3 s.
 * Measured here in Node, the same engine (V8) and the same code the worker runs, reading
 * the files from the disk as it goes; the textures are not decoded (Node has no
 * `createImageBitmap`; in the browser they decode off the thread). MVP is in the
 * repository for now (D3, R12): without it the test says it is skipped.
 */

import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../testing/repo.node';
import { createModelApi } from './api';
import type { ModelReader } from './types';

const MVP = join(REPO_ROOT, 'run', 'rwat_packs', 'MatoiVanillaPack');
const DECLARATION = 'assets/mvp/wagon_models/tem2.json';
const present = existsSync(join(MVP, DECLARATION));

/** The budget of §3.11 for the TEM2, ms. */
const BUDGET_MS = 3000;

const disk: ModelReader = {
  read: async (path) => (existsSync(join(MVP, path)) ? new Uint8Array(await readFile(join(MVP, path))) : null),
  has: (path) => Promise.resolve(existsSync(join(MVP, path))),
};

describe('the model budget (§3.11)', () => {
  it.skipIf(!present)(`parses the TEM2 of MVP within ${BUDGET_MS} ms`, async () => {
    const decoded: string[] = [];
    const api = createModelApi((_bytes, path) => {
      decoded.push(path);
      return Promise.resolve(null);
    });
    const declaration = JSON.parse(readFileSync(join(MVP, DECLARATION), 'utf8')) as unknown;
    const started = performance.now();
    const model = await api.load({ id: 'mvp:tem2', file: DECLARATION, declaration }, disk);
    const ms = performance.now() - started;
    const triangles = model.parts.reduce((sum, part) => sum + part.positions.length / 9, 0);
    console.info(`TEM2: ${ms.toFixed(0)} ms, ${model.objects.length} objects, ${model.parts.length} buffers, ${triangles} triangles, ${decoded.length} textures`);
    expect(model.problems).toEqual([]);
    expect(model.objects.length).toBeGreaterThan(100);
    expect(ms).toBeLessThanOrEqual(BUDGET_MS);
  });

  it.skipIf(present)('is skipped: MVP (run/rwat_packs/MatoiVanillaPack) is not in this checkout', () => {
    expect(present).toBe(false);
  });
});
