/**
 * MVP through the bridge's Python side (./python.ts) on Pyodide in Node: `packs/mvp.json`
 * with its per-type files and the two IR zips converts to the pack `python3 -I
 * tools/ir2rwat.py packs/mvp.json` writes, file by file, and the test prints how long it
 * took and how much memory it used (docs/proposals/editor.md M6: MVP once, measured).
 * Then the layers: `derive` once, and every type's override merged on its derived layer
 * by ./recipe/merge.ts (with `floorFor` where the generator runs) is the type and model
 * declaration that conversion wrote.
 *
 * It takes minutes (about 30 s in CPython, several times that in wasm, and the reference
 * run besides), so it runs only when asked: `RWAT_MVP=1 npx vitest run src/ir/python.mvp`.
 * Without the zips (they leave the repository after phase 2, D3, R12) or without python3
 * it says it is skipped (E9). Nothing of MVP is written anywhere but a temporary folder.
 */

import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../testing/repo.node';
import { effectiveOverride, floorRuns, mergeOverride } from './recipe/merge';
import { havePython, nodePython, readFolder, runTool } from './testing.node';

const RECIPE = join(REPO_ROOT, 'packs', 'mvp.json');
const recipe = existsSync(RECIPE) ? (JSON.parse(await readFile(RECIPE, 'utf8')) as { overrides_dir: string; sources: { zip: string }[] }) : null;
const zips = recipe?.sources.map((source) => join(REPO_ROOT, 'packs', source.zip)) ?? [];
const present = recipe !== null && zips.length > 0 && zips.every((zip) => existsSync(zip));
const asked = process.env.RWAT_MVP === '1';

const MB = 2 ** 20;

describe('MVP through Pyodide', () => {
  it.skipIf(!present || !havePython || !asked)('converts to the pack python3 writes, file by file (time and memory printed)', async () => {
    if (recipe === null) return;
    const overrides: Record<string, Uint8Array> = {};
    const folder = join(REPO_ROOT, 'packs', recipe.overrides_dir);
    for (const name of (await readdir(folder)).filter((n) => n.endsWith('.json'))) {
      overrides[name.slice(0, -'.json'.length)] = new Uint8Array(await readFile(join(folder, name)));
    }
    const sources: Record<string, Uint8Array> = {};
    for (const [i, source] of recipe.sources.entries()) sources[source.zip] = new Uint8Array(await readFile(zips[i]!));

    const api = nodePython();
    const loadStarted = performance.now();
    expect((await api.start({})).ok).toBe(true);
    const loadMs = performance.now() - loadStarted;
    const rssBefore = process.resourceUsage().maxRSS * 1024;
    const started = performance.now();
    let types = 0;
    const answer = await api.convert(
      { recipe: new Uint8Array(await readFile(RECIPE)), recipeName: 'mvp.json', overrides, sources, output: 'files' },
      (line) => {
        if (line.startsWith('  ') && !line.startsWith('  WARNING') && !line.startsWith('  ERROR')) types++;
      },
    );
    const ms = performance.now() - started;
    const peakRss = process.resourceUsage().maxRSS * 1024;
    const heap = await api.memory();
    if (!answer.ok) throw new Error(`${answer.error.type}: ${answer.error.message}\n${answer.error.traceback}`);
    const result = answer.value;
    const files = result.pack?.kind === 'files' ? result.pack.files : [];
    const size = files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
    console.info(
      `MVP in Pyodide (Node): load ${loadMs.toFixed(0)} ms, conversion ${(ms / 1000).toFixed(1)} s, ${types} lines of types and rails, ` +
        `${files.length} files, ${(size / MB).toFixed(0)} MiB written; wasm heap ${(heap / MB).toFixed(0)} MiB, ` +
        `process peak RSS ${(rssBefore / MB).toFixed(0)} → ${(peakRss / MB).toFixed(0)} MiB (the zips ${(Object.values(sources).reduce((s, b) => s + b.byteLength, 0) / MB).toFixed(0)} MiB in memory)`,
    );

    const scratch = await mkdtemp(join(tmpdir(), 'rwat-mvp-'));
    try {
      const cliStarted = performance.now();
      const cli = runTool('ir2rwat.py', [RECIPE, '--out', scratch]);
      console.info(`MVP in CPython: ${((performance.now() - cliStarted) / 1000).toFixed(1)} s`);
      expect(result.exitCode).toBe(cli.status);
      expect(result.report.warnings).toHaveLength(cli.stdout.split('\n').filter((l) => l.startsWith('  WARNING: ')).length);
      const theirs = await readFolder(join(scratch, 'MatoiVanillaPack'));
      expect(files.map((f) => f.path)).toEqual([...theirs.keys()]);
      const differ = files.filter((f) => !Buffer.from(f.bytes).equals(Buffer.from(theirs.get(f.path)!))).map((f) => f.path);
      expect(differ).toEqual([]);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }

    // the layers: derive once, then each type merged by the port with its floor asked for = what was written
    const recipeBytes = new Uint8Array(await readFile(RECIPE));
    const deriveStarted = performance.now();
    const layers = await api.derive({ recipe: recipeBytes, recipeName: 'mvp.json', sources });
    if (!layers.ok) throw new Error(`${layers.error.type}: ${layers.error.message}\n${layers.error.traceback}`);
    const deriveMs = performance.now() - deriveStarted;
    const written = new Map(files.map((f) => [f.path, new TextDecoder().decode(f.bytes)]));
    const inline = (JSON.parse(new TextDecoder().decode(recipeBytes)) as { overrides?: Record<string, unknown> }).overrides ?? {};
    const parsed = Object.fromEntries(Object.entries(overrides).map(([id, bytes]) => [id, JSON.parse(new TextDecoder().decode(bytes)) as unknown]));
    let floors = 0;
    let floorMs = 0;
    const wrong: string[] = [];
    for (const [id, derived] of Object.entries(layers.value.derived)) {
      const override = effectiveOverride(inline[id], parsed[id]);
      let floor: unknown = null;
      if (floorRuns(derived.category, override)) {
        const asked = performance.now();
        const generated = await api.floorFor(id, override);
        floorMs += performance.now() - asked;
        floors++;
        if (!generated.ok) throw new Error(`${id}: ${generated.error.message}`);
        floor = generated.value.interior;
      }
      const merged = mergeOverride({ derived, floor, inline: inline[id], override: parsed[id], namespace: 'mvp', id });
      if (!isDeepStrictEqual(merged.type, JSON.parse(written.get(`data/mvp/wagon_types/${id}.json`) ?? 'null'))) wrong.push(`${id} type`);
      if (!isDeepStrictEqual(merged.model, JSON.parse(written.get(`assets/mvp/wagon_models/${id}.json`) ?? 'null'))) wrong.push(`${id} model`);
    }
    console.info(
      `MVP layers: derive ${(deriveMs / 1000).toFixed(1)} s for ${Object.keys(layers.value.derived).length} types; ` +
        `floorFor ${floors} types, ${(floorMs / 1000).toFixed(1)} s in all; wasm heap ${((await api.memory()) / MB).toFixed(0)} MiB`,
    );
    expect(Object.keys(layers.value.derived)).toEqual(result.report.stock.map((s) => s.id));
    expect(wrong).toEqual([]);
  }, 30 * 60_000);

  it.skipIf(present && havePython && asked)('is skipped: needs packs/mvp.json with its zips, python3, and RWAT_MVP=1 (minutes long)', () => {
    expect(present && havePython && asked).toBe(false);
  });
});
