/**
 * Test helpers of the recipe model (Node only): a recipe in memory, opened with a journal,
 * and the MVP recipe of the repository (packs/mvp.json and packs/mvp/*.json — our markup,
 * no assets).
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from '../../core/contracts';
import { Journal } from '../../core/journal';
import { MemorySource, REPO_ROOT, filesOf, readTree } from '../../core/pack/testing.node';
import type { Derived } from './merge';
import { RecipeWorkspace } from './workspace';

export const RECIPE = 'packs/r.json';

/** A recipe's files: a value is written as JSON with two-space indents, a string as it is. */
export type Texts = Record<string, string | object>;

export interface Opened {
  workspace: RecipeWorkspace;
  journal: Journal;
  source: MemorySource;
  /** Runs a command through the journal. */
  run(command: Command): Promise<void>;
}

export function textsOf(files: Texts): Map<string, Uint8Array> {
  return filesOf(Object.fromEntries(Object.entries(files).map(([path, value]) => [path, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`])));
}

export async function openFiles(files: Map<string, Uint8Array>, recipe = RECIPE): Promise<Opened> {
  const source = new MemorySource(files);
  const workspace = await RecipeWorkspace.open(source, recipe);
  const journal = new Journal(workspace);
  return { workspace, journal, source, run: (command) => journal.run(command) };
}

export function openRecipe(files: Texts, recipe = RECIPE): Promise<Opened> {
  return openFiles(textsOf(files), recipe);
}

/** The MVP recipe's files under `packs/` (with its geometry digests, which are no per-type files), or null when the repository lacks them. */
export function mvpFiles(): Map<string, Uint8Array> | null {
  const folder = join(REPO_ROOT, 'packs');
  if (!existsSync(join(folder, 'mvp.json'))) return null;
  return new Map([...readTree(folder)].map(([path, bytes]) => [`packs/${path}`, bytes]));
}

/** A passenger coach as the converter derives it (the golden recipe_merge's). */
export const COACH: Derived = {
  category: 'passenger',
  name: 'Test Coach',
  type: { length: 20.0, bogies: [7.0, -7.0], mass_t: 40.0, max_speed_kmh: 120, brakes: { system: 'passenger' } },
  doors: [
    { id: 'DOOR_1', min: [-1.0, 0.9, 1.35], max: [0.0, 3.0, 1.45] },
    { id: 'DOOR_3', min: [-4.0, 0.9, -1.45], max: [-3.0, 3.0, -1.35], inner: true },
  ],
  interior: { min: [-5.0, 0.9, -1.4], max: [5.0, 3.4, 1.4] },
  model: {
    obj: 'stock/car/car.obj',
    animations: { door_1: 'stock/car/door1.anim', door_3: 'stock/car/door3.anim' },
    sounds: { horn: 'stock/sounds/horn.ogg', doors: { door_1: 'stock/sounds/door.ogg' } },
  },
  lights: ['FBL', 'IL'],
};

export const FLOOR = [{ min: [-5.0, 0.9, -1.4], max: [5.0, 3.4, 1.4] }];
