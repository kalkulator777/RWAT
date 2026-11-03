/**
 * Meta-test of the TypeScript golden runners (docs/proposals/editor.md §4.4–4.5,
 * fixtures/golden/README.md): every folder of fixtures/golden/ whose `ports.json` names
 * the `ts` port has a runner in the editor, or is listed here as waiting for the stage
 * that ports its logic. A runner is a test under src/ that declares
 * `const FOLDER = …fixtures/golden/<folder>` (as core/json/golden.test.ts and
 * core/schema/golden.test.ts do), which is how this test finds it.
 *
 * It is green now and turns red when a folder with a `ts` port appears with neither a
 * runner nor a line below, when a folder in the list gets its runner (take it off the
 * list), or when a folder disappears or drops its `ts` port. So no golden folder can
 * be forgotten, and the list is the plan of M2.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GOLDEN_DIR } from '../src/testing/repo.node';

/** Folders that name `ts` in ports.json and whose port is not written yet: ждёт M2 (docs/proposals/editor.md §7, M2). */
const WAITING_FOR_M2 = [
  'door_leaves', // ждёт M2: door leaves
];

/** Folders whose port comes with the 3D stage: ждёт M3 (docs/proposals/editor.md §7, M3). */
const WAITING_FOR_M3 = [
  'lights', // ждёт M3: lit parts and lamps
  'model_parts', // ждёт M3: model parts (modelParts.ts)
];

const WAITING = [...WAITING_FOR_M2, ...WAITING_FOR_M3];

const RUNNER = /^const FOLDER = .*fixtures\/golden\/([a-z0-9_]+)/m;

function folders(): string[] {
  return readdirSync(GOLDEN_DIR)
    .filter((name) => statSync(join(GOLDEN_DIR, name)).isDirectory())
    .sort();
}

function ports(folder: string): string[] {
  const parsed = JSON.parse(readFileSync(join(GOLDEN_DIR, folder, 'ports.json'), 'utf8')) as { ports: string[] };
  return parsed.ports;
}

/** The golden folder each test file under dir declares as its FOLDER. */
function runners(dir: string, found = new Map<string, string>()): Map<string, string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) runners(path, found);
    else if (/\.test\.tsx?$/.test(name)) {
      const folder = RUNNER.exec(readFileSync(path, 'utf8'))?.[1];
      if (folder !== undefined) found.set(folder, path);
    }
  }
  return found;
}

const tsFolders = folders().filter((folder) => ports(folder).includes('ts'));
const withRunner = runners(join(import.meta.dirname, '..', 'src'));

describe('golden runners of the TypeScript port', () => {
  it('finds the runners it knows and the folders that name the ts port', () => {
    expect(tsFolders.length).toBeGreaterThan(0);
    expect([...withRunner.keys()].sort()).toEqual(expect.arrayContaining(['json_dump', 'validate']));
  });

  it('has a runner for every folder with a ts port, or the folder is listed as waiting for M2 or M3', () => {
    const missing = tsFolders.filter((folder) => !withRunner.has(folder) && !WAITING.includes(folder));
    expect(missing, 'a golden folder names the ts port but has no runner and is not in WAITING_FOR_M2 or WAITING_FOR_M3').toEqual([]);
  });

  it('lists as waiting only folders that name the ts port and have no runner yet', () => {
    const stale = WAITING.filter((folder) => !tsFolders.includes(folder) || withRunner.has(folder));
    expect(stale, 'WAITING_FOR_M2/M3 names a folder that is gone, has no ts port, or already has its runner').toEqual([]);
  });

  it('has no runner for a folder that does not name the ts port', () => {
    const stray = [...withRunner].filter(([folder]) => !tsFolders.includes(folder)).map(([folder, path]) => `${folder} (${path})`);
    expect(stray).toEqual([]);
  });
});
