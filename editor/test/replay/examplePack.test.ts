// @vitest-environment happy-dom
/**
 * The example pack made from scratch in the editor (docs/proposals/editor.md §1.4 item 1,
 * §5.1 "сценарный прогон", M5): the steps of ./examplePack.ts, one test each, in order, on
 * the editor driven as its user drives it (./studio.ts). After each step the places it
 * makes are the repository's (run/rwat_packs/RwatExamplePack, which tools/gen_example_pack.py
 * writes) as JSON values — a step that goes wrong fails by its name, with the difference;
 * the steps after it are skipped. Then the whole pack:
 *
 * - its files are the repository's: every declaration and lang file as a JSON value, every
 *   other file byte for byte, no file more or less;
 * - the pack's checks (the loader's rules, the schema, the floor check, the sounds) find
 *   nothing;
 * - no step more writes JSON itself (`gap`, TODO(gap)) than before;
 * - the journal, serialized as the session keeps it and replayed on the pack the wizard
 *   made, makes the same files byte for byte;
 * - the zip "Save" writes passes `python -I tools/validate_pack.py` (skipped, saying so,
 *   where there is no python3).
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { savePack } from '../../src/app/session';
import { journal, pack, schema } from '../../src/app/store';
import { checkPack } from '../../src/checks/pack';
import { getAt } from '../../src/core/json';
import { classify, MCMETA, type Pack } from '../../src/core/pack';
import { readTree } from '../../src/core/pack/testing.node';
import { parseJournal, serializeJournal } from '../../src/core/journal';
import { replaySession } from '../../src/core/session/replay';
import { openZipSource, readAll } from '../../src/io';
import { newPackSource } from '../../src/panels/newpack/model';
import { EXAMPLE_PACK, TOOLS_DIR } from '../../src/testing/repo.node';
import { FLOOR_TIMING } from '../../src/tools/floor/session';
import { SEATS_TIMING } from '../../src/tools/seats/session';
import { NEW_PACK, STEPS } from './examplePack';
import { commandCount, GAP_LABEL, Studio } from './studio';

/** Steps that write JSON themselves because the editor cannot (TODO(gap)): their number may go down, never up. */
const GAPS = 0;

// the markup tools draw again at once after each edit, however slow an instrumented run is
FLOOR_TIMING.slowMs = Number.POSITIVE_INFINITY;
SEATS_TIMING.slowMs = Number.POSITIVE_INFINITY;
// a step reads models and runs dozens of commands through the panels: seconds under coverage
vi.setConfig({ testTimeout: 120_000 });

const REPOSITORY = readTree(EXAMPLE_PACK);
const decoder = new TextDecoder();

/** True for the files compared as JSON values: the declarations, the lang files, pack.mcmeta. */
function isJson(path: string): boolean {
  return path === MCMETA || classify(path) !== null;
}

function repositoryJson(path: string): unknown {
  const bytes = REPOSITORY.get(path);
  if (bytes === undefined) throw new Error(`the repository has no ${path}`);
  return JSON.parse(decoder.decode(bytes)) as unknown;
}

function openPack(): Pack {
  const open = pack.value;
  if (open === null) throw new Error('no pack is open');
  return open;
}

const python = spawnSync('python3', ['--version'], { encoding: 'utf8' }).status === 0;

describe.sequential('the example pack made from scratch in the editor, step by step', () => {
  let studio: Studio;
  let broken: string | null = null;

  beforeAll(() => {
    studio = Studio.start();
  });
  afterAll(() => studio.stop());

  for (const step of STEPS) {
    it(step.name, async (context) => {
      if (broken !== null) context.skip(`a step before failed: «${broken}»`);
      try {
        const gaps = studio.gaps.length;
        await step.run(studio);
        if (studio.gaps.length > gaps && step.gap === undefined) throw new Error(`«${step.name}» writes JSON itself (Studio.write) but names no gap`);
        for (const [file, at, repository] of step.makes) {
          const made = getAt(openPack().json(file), at);
          expect(made, `«${step.name}» makes ${file}#${at}`).not.toBeUndefined();
          expect(made, `«${step.name}» makes ${file}#${at}`).toEqual(getAt(repositoryJson(repository ?? file), at));
        }
      } catch (error) {
        broken = step.name;
        throw error;
      }
    });
  }

  describe('the pack made', () => {
    it('has the repository’s files: declarations and names as JSON values, the rest byte for byte', async (context) => {
      if (broken !== null) context.skip(`a step failed: «${broken}»`);
      const made = openPack();
      expect(made.paths()).toEqual([...REPOSITORY.keys()].sort());
      for (const path of made.paths()) {
        if (isJson(path)) expect(made.json(path), path).toEqual(repositoryJson(path));
        else expect(Buffer.from(await made.bytes(path)).equals(Buffer.from(REPOSITORY.get(path) as Uint8Array)), path).toBe(true);
      }
    });

    it('has no findings: loader, schema, floor, sounds', (context) => {
      if (broken !== null) context.skip(`a step failed: «${broken}»`);
      expect(checkPack(openPack(), schema.value)).toEqual([]);
    });

    it('was made by the editor’s commands: no step writes JSON itself beyond the known gaps', (context) => {
      if (broken !== null) context.skip(`a step failed: «${broken}»`);
      const gaps = STEPS.filter((step) => step.gap !== undefined).map((step) => `${step.name}: ${step.gap ?? ''}`);
      expect(gaps.length, gaps.join('\n')).toBeLessThanOrEqual(GAPS);
      const edits = journal.value?.state();
      const commands = [...(edits?.committed ?? []), ...(edits?.done ?? [])];
      expect(commands.filter((command) => command.label === GAP_LABEL)).toHaveLength(studio.gaps.length);
      expect(studio.gaps.length, studio.gaps.join('\n')).toBeLessThanOrEqual(GAPS);
      // every other command is one a panel, a dialog or a markup tool makes
      const labels = new Set(commands.map((command) => command.label));
      expect([...labels].filter((label) => label !== GAP_LABEL && !/^(?:newpack|forms|sounds|names|tools\.[a-z]+|save\.rename)\./.test(label))).toEqual([]);
    });

    it('is made again, byte for byte, by its journal replayed on the pack the wizard made', async (context) => {
      if (broken !== null) context.skip(`a step failed: «${broken}»`);
      const edits = journal.value;
      if (edits === null) throw new Error('no journal');
      const state = parseJournal(serializeJournal(edits.state()));
      expect(state.committed.length + state.done.length).toBe(commandCount());
      const replayed = await replaySession(newPackSource(NEW_PACK), state, { savePoint: null });
      const made = openPack();
      expect(replayed.pack.paths()).toEqual(made.paths());
      for (const path of made.paths()) expect(Buffer.from(await replayed.pack.bytes(path)).equals(Buffer.from(await made.bytes(path))), path).toBe(true);
    });

    it('is saved as a zip of the repository’s files', async (context) => {
      if (broken !== null) context.skip(`a step failed: «${broken}»`);
      let zip: Uint8Array | null = null;
      expect(await savePack((bytes) => void (zip = bytes), 'zip')).toBe(true);
      if (zip === null) throw new Error('no zip');
      const files = await readAll(await openZipSource(zip, 'RwatExamplePack.zip'));
      expect([...files.keys()].sort()).toEqual([...REPOSITORY.keys()].sort());
      for (const [path, bytes] of files) {
        if (isJson(path)) expect(JSON.parse(decoder.decode(bytes)), path).toEqual(repositoryJson(path));
        else expect(Buffer.from(bytes).equals(Buffer.from(REPOSITORY.get(path) as Uint8Array)), path).toBe(true);
      }
      zipBytes = zip;
    });

    it.skipIf(!python)('passes tools/validate_pack.py as a zip (skipped where there is no python3)', (context) => {
      if (zipBytes === null) context.skip('no zip was saved');
      const folder = mkdtempSync(join(tmpdir(), 'rwat-replay-'));
      try {
        const file = join(folder, 'RwatExamplePack.zip');
        writeFileSync(file, zipBytes as Uint8Array);
        const run = spawnSync('python3', ['-I', join(TOOLS_DIR, 'validate_pack.py'), file], { encoding: 'utf8' });
        expect(run.stdout.trim(), run.stderr).toBe('8 file(s) checked: 0 error(s), 0 warning(s)');
        expect(run.status).toBe(0);
      } finally {
        rmSync(folder, { recursive: true, force: true });
      }
    });
  });
});

/** The zip the save wrote, for the validator. */
let zipBytes: Uint8Array | null = null;
