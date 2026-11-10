/**
 * Node only (tests): the Python side of the bridge (./python.ts) on the `pyodide` package
 * in Node, the converter run by the real Python for comparison, and a synthetic IR pack
 * made here, of our own bytes (no file of another pack: CLAUDE.md, licences).
 *
 * The pack is small but has what a foreign IR pack has: a model path with capitals and a
 * space (renamed as it is copied), a texture outside models/ reached through ../, a
 * livery, an animation, sounds, a door named with Blender's .001, a hand-edited
 * definition (a BOM, comments, a trailing comma), a type whose model is missing (an
 * error), a rail style, and a second source zip the recipe reaches through ../.
 */

import { spawnSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { loadPyodide } from 'pyodide';
import { buildZip } from '../io';
import { comparePaths } from '../core/paths';
import { TOOLS_DIR } from '../testing/repo.node';
import type { PythonApi } from './bridge';
import { createPythonApi } from './python';

/** True if `python3` runs here. */
export const havePython = spawnSync('python3', ['--version']).status === 0;

/** The Python side on Pyodide in Node, loaded from the package (what the worker runs, on the same files). */
export function nodePython(): PythonApi {
  return createPythonApi(() => loadPyodide());
}

/** What `python3 -I tools/<script> …args` did. */
export interface CliRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Runs a tool of tools/ with the real Python. */
export function runTool(script: string, args: string[]): CliRun {
  const run = spawnSync('python3', ['-I', join(TOOLS_DIR, script), ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

/** Runs Python code with tools/ on its path; its stdout parsed as JSON. */
export function runPythonJson(code: string, args: string[] = []): unknown {
  const script = `import sys\nsys.path.insert(0, ${JSON.stringify(TOOLS_DIR)})\n${code}`;
  const run = spawnSync('python3', ['-I', '-c', script, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) throw new Error(`python3 failed (${run.status}): ${run.stderr}`);
  return JSON.parse(run.stdout) as unknown;
}

/** Every file under a folder of the disk, by path relative to it, in the order of paths. */
export async function readFolder(folder: string): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  for (const entry of await readdir(folder, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files.set(relative(folder, path).split('\\').join('/'), new Uint8Array(await readFile(path)));
  }
  return new Map([...files].sort(([a], [b]) => comparePaths(a, b)));
}

/** Writes files to a folder of the disk. */
export async function writeFolder(folder: string, files: Record<string, Uint8Array>): Promise<void> {
  for (const [path, bytes] of Object.entries(files)) {
    await mkdir(dirname(join(folder, path)), { recursive: true });
    await writeFile(join(folder, path), bytes);
  }
}

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

/** A JSON file as the tests write one (two-space indents, a newline at the end). */
export const json = (value: unknown): Uint8Array => text(`${JSON.stringify(value, null, 2)}\n`);

/** A 1 × 1 PNG of one colour. */
export function png(r: number, g: number, b: number): Uint8Array {
  const chunk = (kind: string, data: Uint8Array): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(kind, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const pixels = deflateSync(Buffer.from([0, r, g, b]));
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', pixels), chunk('IEND', new Uint8Array())]));
}

type Point = [number, number, number];
type Shape = { corners: Point[]; faces: number[][] };

/** A box in IR space: 8 corners, 6 faces, the top facing up. */
function cuboid([x0, y0, z0]: Point, [x1, y1, z1]: Point): Shape {
  return {
    corners: [
      [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
      [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
    ],
    faces: [[1, 2, 3, 4], [5, 8, 7, 6], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 8, 4], [4, 8, 5, 1]],
  };
}

/** An up-facing floor in IR space. */
function floorQuad(x0: number, x1: number, y: number, z0: number, z1: number): Shape {
  return { corners: [[x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0]], faces: [[1, 2, 3, 4]] };
}

/** OBJ text of named shapes. */
function obj(objects: [string, Shape][], mtllib?: string): Uint8Array {
  const lines = mtllib === undefined ? [] : [`mtllib ${mtllib}`];
  let base = 0;
  for (const [name, { corners, faces }] of objects) {
    lines.push(`o ${name}`, ...corners.map(([x, y, z]) => `v ${x} ${y} ${z}`), 'usemtl body');
    lines.push(...faces.map((face) => `f ${face.map((i) => base + i).join(' ')}`));
    base += corners.length;
  }
  return text(`${lines.join('\n')}\n`);
}

const IR = 'assets/immersiverailroading/';
const COACH_DIR = `${IR}models/rolling_stock/passenger/Test_Coach/`;
const HOPPER_DIR = `${IR}models/rolling_stock/freight/hopper/`;
const FLOOR_Y = 0.9;
/** floorgen.Y_LIFT and ir2rwat.IR_FLOOR_OFFSET: IR's passenger centre_y sits so that the floor is FLOOR_Y. */
const PASSENGER_Y = FLOOR_Y + 0.40625 + 0.03 - 0.1;

/** The synthetic coach's model: a floor, an external door, a widget door with an animation, a door named DOOR_3.001. */
export const COACH_OBJ = obj(
  [
    ['FLOOR', floorQuad(-5, 5, FLOOR_Y, -1.4, 1.4)],
    ['DOOR_1_EXTERNAL', cuboid([-1, FLOOR_Y, 1.35], [0, 3, 1.45])],
    ['WIDGET_2_TOGGLE_CG_DoorA', cuboid([2.95, FLOOR_Y, -0.5], [3.05, 3, 0.5])],
    ['DOOR_3.001', cuboid([-4, FLOOR_Y, -1.45], [-3, 3, -1.35])],
  ],
  'Coach Mats.mtl',
);

/** {entry: bytes} of the synthetic IR pack. */
export function irPackFiles(): Record<string, Uint8Array> {
  const coach = {
    name: 'Test Coach',
    model: 'immersiverailroading:models/rolling_stock/passenger/test_coach/Test Coach.obj',
    properties: { weight_kg: 30000, max_speed_kmh: 100 },
    trucks: { front: 3.0, rear: -3.0 },
    couplers: { front_offset: 0.0, rear_offset: 0.0 },
    passenger: { center_x: 0.0, center_y: PASSENGER_Y, length: 4.5, width: 2.6 },
    tex_variants: { 'Red Line': 'L_Red' },
    animations: [{ control_group: 'DoorA', animatrix: 'immersiverailroading:models/rolling_stock/passenger/test_coach/anim/DoorA.anim' }],
    sounds: { idle: 'immersiverailroading:sounds/Coach/Hum.ogg' },
    era: 'steam',
  };
  return {
    'pack.mcmeta': text('{"pack": {"pack_format": 3, "description": "test"}}'),
    'LICENSE.txt': text('CC0\n'),
    [`${IR}rolling_stock/stock.json`]: text('{"passenger": ["test_coach"]}'),
    [`${IR}rolling_stock/passenger/test_coach.json`]: text(`\ufeff// the test coach\n${JSON.stringify(coach, null, 2)}`),
    [`${COACH_DIR}Test Coach.obj`]: COACH_OBJ,
    [`${COACH_DIR}Coach Mats.mtl`]: text('newmtl body\nmap_Kd ../../../../textures/Coach/Body.png\nnewmtl glass\r\nmap_Kd Glass.PNG\r\n'),
    [`${COACH_DIR}Glass.PNG`]: png(200, 220, 255),
    [`${COACH_DIR}L_Red/Body.png`]: png(200, 0, 0),
    [`${COACH_DIR}anim/DoorA.anim`]: text('O WIDGET_2_TOGGLE_CG_DoorA\n'),
    [`${IR}textures/Coach/Body.png`]: png(0, 90, 40),
    [`${IR}sounds/Coach/Hum.ogg`]: text('OggS not really'),
    [`${IR}rolling_stock/freight/hopper.json`]: text(
      '{\n  "name": "Hopper [ 15-1443 ] car, // not a comment",  // a comment\n' +
        '  "model": "immersiverailroading:models/rolling_stock/freight/hopper/hopper.obj",\n' +
        '  /* a block\n     comment */\n  "properties": {"weight_kg": 20000,},\n' +
        '  "trucks": {"front": 2.5, "rear": -2.5},\n  "tex_variants": {"Green": "l_green"},\n}\n',
    ),
    [`${HOPPER_DIR}hopper.obj`]: obj([['BODY', cuboid([-4, 0.5, -1.4], [4, 2.5, 1.4])]], 'hopper.mtl'),
    [`${HOPPER_DIR}hopper.mtl`]: text('newmtl body\nmap_Kd hopper.png\n'),
    [`${HOPPER_DIR}hopper.png`]: png(90, 90, 90),
    [`${HOPPER_DIR}l_green/hopper.png`]: png(0, 120, 0),
    // a type whose model is not in the zip: an error, the rest is converted
    [`${IR}rolling_stock/freight/no_model.json`]: json({ name: 'No model', model: 'immersiverailroading:models/rolling_stock/freight/nothing/nothing.obj' }),
    [`${IR}track/track.json`]: text('{"track": ["rail_a"]}'),
    [`${IR}track/rail_a.json`]: json({ name: 'Rail A', models: { '>0': 'immersiverailroading:models/track/rail_a/rail_a.obj' } }),
    [`${IR}models/track/rail_a/rail_a.obj`]: obj([
      ['RAIL_LEFT', cuboid([-0.5, 0, -0.8], [0.5, 0.2, -0.7])],
      ['RAIL_RIGHT', cuboid([-0.5, 0, 0.7], [0.5, 0.2, 0.8])],
    ]),
  };
}

/** {entry: bytes} of the second source: a locomotive the first lacks, and the hopper again (the first wins). */
export function secondPackFiles(): Record<string, Uint8Array> {
  return {
    [`${IR}rolling_stock/locomotives/loco.json`]: json({
      name: 'Loco',
      model: 'immersiverailroading:models/rolling_stock/locomotives/loco/loco.obj',
      properties: { weight_kg: 80000, horsepower: 1000, max_speed_kmh: 100 },
      trucks: { front: 4.0, rear: -4.0 },
      era: 'diesel',
      sounds: { idle: 'immersiverailroading:sounds/loco/idle.ogg' },
    }),
    [`${IR}models/rolling_stock/locomotives/loco/loco.obj`]: obj([['BODY', cuboid([-7, 0.5, -1.5], [7, 3.5, 1.5])]], 'loco.mtl'),
    [`${IR}models/rolling_stock/locomotives/loco/loco.mtl`]: text('newmtl body\nmap_Kd loco.png\n'),
    [`${IR}models/rolling_stock/locomotives/loco/loco.png`]: png(30, 60, 160),
    [`${IR}sounds/loco/idle.ogg`]: text('OggS idle'),
    [`${IR}rolling_stock/freight/hopper.json`]: json({ name: 'Hopper 2', model: 'immersiverailroading:models/rolling_stock/freight/hopper/hopper.obj' }),
  };
}

/** A zip of files, laid out as the editor writes one (io/zip.ts `buildZip`). */
export function zipOf(files: Record<string, Uint8Array>): Promise<Uint8Array> {
  return buildZip(Object.entries(files).map(([path, bytes]) => ({ path, bytes })));
}

/** The recipe of the synthetic pack: two sources (the second through ../), per-type files in `tp/`, an unknown key (a warning). */
export function irRecipe(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _comment: 'a note to the reader, never read',
    name: 'Test Pack',
    pack_dir: 'TestPack',
    namespace: 'tp',
    description: 'test',
    license: 'CC0',
    version: '1.0',
    authors: ['tests'],
    id_strip_prefix: '',
    overrides_dir: 'tp',
    copy_root_files: ['LICENSE.txt'],
    sources: [
      { zip: 'test-ir.zip', root: 'stock', label: 'Test' },
      { zip: '../sources/Second IR.zip', root: 'second', label: 'Second' },
    ],
    sound_defaults: { clack: 'sounds/Coach/Hum.ogg' },
    unknown_key: true,
    ...extra,
  };
}

/** The per-type files of the synthetic pack, by type id. */
export function irOverrides(): Record<string, unknown> {
  return {
    test_coach: { _why: 'a comment', name: { ru_ru: 'Тестовый вагон' }, floor: { clearance: 0.1 }, sway: 1.5 },
    hopper: { type: { mass_t: 21 } },
  };
}
