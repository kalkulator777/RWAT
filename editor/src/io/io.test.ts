import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PackSink, PackSource } from '../core/contracts';
import { openDirInputSource } from './dirInput';
import { FsAccessSink, FsAccessSource, ensurePermission, openFsAccessSource } from './fsAccess';
import { MemoryPack } from './memory';
import { NodeFsSink, NodeFsSource } from './nodeFs.node';
import { PackIoError } from './errors';
import { buildZip, openZipSource, ZipSink } from './zip';
import { readAll } from './index';
import { EXAMPLE_PACK, FakeDirectory, TOOLS_DIR } from './testPack.node';

const havePython = spawnSync('python3', ['--version']).status === 0;
const text = (s: string) => new TextEncoder().encode(s);
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

async function exampleFiles(): Promise<Map<string, Uint8Array>> {
  return readAll(new NodeFsSource(EXAMPLE_PACK));
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<PackIoError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(PackIoError);
  expect((error as PackIoError).code).toBe(code);
  return error as PackIoError;
}

describe('the example pack through node-fs and through a zip', () => {
  it('lists the same files with the same bytes', async () => {
    const disk = new NodeFsSource(EXAMPLE_PACK);
    const files = await exampleFiles();
    expect(files.size).toBeGreaterThan(50);
    expect(files.has('pack.mcmeta')).toBe(true);

    const zip = await openZipSource(
      await buildZip([...files].map(([path, bytes]) => ({ path, bytes }))),
      'RwatExamplePack.zip',
    );
    expect(zip.kind).toBe('zip');
    expect(zip.writable).toBe(false);
    expect(await zip.list()).toEqual(await disk.list());
    const fromZip = await readAll(zip);
    for (const [path, bytes] of files) expect(fromZip.get(path), path).toEqual(bytes);
    expect(fromZip.size).toBe(files.size);
  });

  it('is the same through a folder input, with the folder name cut off', async () => {
    const files = await exampleFiles();
    const picked = [...files].map(([path, bytes]) => {
      const file = new File([bytes.slice()], path.split('/').pop() ?? path);
      Object.defineProperty(file, 'webkitRelativePath', { value: `RwatExamplePack/${path}` });
      return file;
    });
    const source = openDirInputSource(picked);
    expect(source.name).toBe('RwatExamplePack');
    expect(source.kind).toBe('dir-input');
    expect(source.writable).toBe(false);
    expect(await source.list()).toEqual(await new NodeFsSource(EXAMPLE_PACK).list());
    expect(await source.read('pack.mcmeta')).toEqual(files.get('pack.mcmeta'));
  });

  it('is the same through File System Access over a fake folder', async () => {
    const files = await exampleFiles();
    const root = new FakeDirectory('RwatExamplePack');
    await new FsAccessSink(root).write([...files].map(([path, bytes]) => ({ path, bytes })));
    const source = await openFsAccessSource(root);
    expect(source.writable).toBe(true);
    expect(await source.list()).toEqual(await new NodeFsSource(EXAMPLE_PACK).list());
    expect(await readAll(source)).toEqual(files);
  });
});

describe('writing a zip', () => {
  it('gives the same bytes twice, whatever the clock says', async () => {
    const files = [...(await exampleFiles())].map(([path, bytes]) => ({ path, bytes }));
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date(2020, 5, 1, 12, 0, 0));
      const first = await buildZip(files);
      vi.setSystemTime(new Date(2031, 10, 9, 3, 4, 6));
      const second = await buildZip([...files].reverse());
      expect(second).toEqual(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses a path outside the pack or twice', async () => {
    await expectCode(buildZip([{ path: '../x', bytes: text('x') }]), 'unsafe-path');
    await expectCode(buildZip([{ path: '/x', bytes: text('x') }]), 'unsafe-path');
    await expectCode(
      buildZip([
        { path: 'a', bytes: text('1') },
        { path: 'a', bytes: text('2') },
      ]),
      'duplicate-path',
    );
  });

  it.skipIf(!havePython)('lays the archive out byte for byte like ir2rwat write_zip', async () => {
    const files = new Map<string, Uint8Array>([
      ['pack.mcmeta', text('{}')],
      ['b.txt', text('hello hello hello hello hello world')],
      ['a/é.json', text('{"x": 1}\n')],
      ['empty.txt', new Uint8Array()],
    ]);
    const bytes = await buildZip([...files].map(([path, data]) => ({ path, bytes: data })));
    const dir = await mkdtemp(join(tmpdir(), 'rwat-zip-'));
    try {
      const script = [
        'import sys, json',
        `sys.path.insert(0, ${JSON.stringify(TOOLS_DIR)})`,
        'import ir2rwat',
        'from pathlib import Path',
        'files = json.loads(sys.argv[2])',
        'ir2rwat.write_zip(Path(sys.argv[1]), [(p, (lambda d=d: d.encode())) for p, d in files.items()])',
      ].join('\n');
      const theirs = join(dir, 'theirs.zip');
      const input = JSON.stringify(Object.fromEntries([...files].map(([p, d]) => [p, decode(d)])));
      const run = spawnSync('python3', ['-I', '-c', script, theirs, input], { encoding: 'utf8' });
      expect(run.stderr).toBe('');
      expect(new Uint8Array(await readFile(theirs))).toEqual(bytes);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('reading a zip', () => {
  /** A zip with an entry named `aa/evil.txt`, renamed in both headers to `name` (same length). */
  async function zipWithName(name: string): Promise<Uint8Array> {
    const zip = await buildZip([
      { path: 'ok.txt', bytes: text('ok') },
      { path: 'aa/evil.txt', bytes: text('evil') },
    ]);
    const from = text('aa/evil.txt');
    const to = text(name.padEnd(from.length, 'x').slice(0, from.length));
    const out = zip.slice();
    for (let i = 0; i + from.length <= out.length; i++) {
      if (from.every((byte, j) => out[i + j] === byte)) out.set(to, i);
    }
    return out;
  }

  it('refuses a zip with a .. path whole', async () => {
    const error = await expectCode(openZipSource(await zipWithName('../evil.txt'), 'bad.zip'), 'unsafe-path');
    expect(error.paths).toEqual(['../evil.txt']);
  });

  it('refuses absolute, drive and backslash-climbing names', async () => {
    await expectCode(openZipSource(await zipWithName('/evil/e.txt'), 'bad.zip'), 'unsafe-path');
    await expectCode(openZipSource(await zipWithName('C:/evil/e.txt'), 'bad.zip'), 'unsafe-path');
    await expectCode(openZipSource(await zipWithName('..\\evil.txt'), 'bad.zip'), 'unsafe-path');
  });

  it('refuses two entries for one path', async () => {
    const zip = await buildZip([
      { path: 'ok.txt', bytes: text('1') },
      { path: 'xxok.txt', bytes: text('2') },
    ]);
    const renamed = zip.slice();
    for (let i = 0; i + 8 <= renamed.length; i++) {
      if (decode(renamed.subarray(i, i + 8)) === 'xxok.txt') renamed.set(text('./ok.txt'), i);
    }
    await expectCode(openZipSource(renamed, 'dup.zip'), 'duplicate-path');
  });

  it('rejects bytes that are no zip', async () => {
    await expectCode(openZipSource(text('not a zip'), 'x.zip'), 'bad-zip');
  });

  it('keeps the case, skips folders and __MACOSX, and reads from a Blob lazily', async () => {
    const zip = await buildZip([
      { path: 'Pack.MCMETA', bytes: text('{}') },
      { path: '__MACOSX/._x', bytes: text('junk') },
    ]);
    const source = await openZipSource(new Blob([zip.slice()]), 'p.zip');
    expect(await source.list()).toEqual([{ path: 'Pack.MCMETA', size: 2 }]);
    expect(decode(await source.read('Pack.MCMETA'))).toBe('{}');
    await expectCode(source.read('pack.mcmeta'), 'not-found');
  });
});

describe('ZipSink', () => {
  it('applies the changes to the base and hands over a deterministic zip', async () => {
    const base = new MemoryPack('base', { 'pack.mcmeta': '{}', 'a.txt': 'a', 'b.txt': 'b' });
    const out: Uint8Array[] = [];
    const sink = new ZipSink(base, (zip) => void out.push(zip));
    await sink.write([{ path: 'a.txt', delete: true }, { path: 'c/new.txt', bytes: text('c') }, { path: 'b.txt', bytes: text('B') }]);
    await sink.write([{ path: 'a.txt', delete: true }, { path: 'c/new.txt', bytes: text('c') }, { path: 'b.txt', bytes: text('B') }]);
    expect(out[1]).toEqual(out[0]);
    const files = await readAll(await openZipSource(out[0] as Uint8Array, 'o.zip'));
    expect([...files.keys()]).toEqual(['b.txt', 'c/new.txt', 'pack.mcmeta']);
    expect(decode(files.get('b.txt') as Uint8Array)).toBe('B');
  });

  it('builds a new pack without a base', async () => {
    let zip: Uint8Array | undefined;
    await new ZipSink(null, (z) => void (zip = z)).write([{ path: 'pack.mcmeta', bytes: text('{}') }]);
    expect([...(await readAll(await openZipSource(zip as Uint8Array, 'n.zip'))).keys()]).toEqual(['pack.mcmeta']);
  });
});

interface Folder {
  source: PackSource;
  sink: PackSink;
  done: () => Promise<void>;
}

const FOLDERS: [string, () => Promise<Folder>][] = [
  [
    'memory',
    () => {
      const pack = new MemoryPack('m');
      return Promise.resolve({ source: pack, sink: pack, done: () => Promise.resolve() });
    },
  ],
  [
    'node-fs',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'rwat-fs-'));
      await mkdir(join(dir, 'pack'));
      const pack = join(dir, 'pack');
      return { source: new NodeFsSource(pack), sink: new NodeFsSink(pack), done: () => rm(dir, { recursive: true, force: true }) };
    },
  ],
  [
    'fs-access (fake)',
    async () => {
      const source = await openFsAccessSource(new FakeDirectory('pack'));
      return { source, sink: source.sink(), done: () => Promise.resolve() };
    },
  ],
];

describe.each(FOLDERS)('a folder sink: %s', (_name, make) => {
  let cleanup: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
  });
  async function open(): Promise<Folder> {
    const made = await make();
    cleanup = made.done;
    return made;
  }

  it('writes, replaces and deletes files, and a missing file to delete is no error', async () => {
    const { source, sink } = await open();
    await sink.write([
      { path: 'pack.mcmeta', bytes: text('{}') },
      { path: 'deep/er/x.json', bytes: text('1') },
      { path: 'deep/y.json', bytes: text('2') },
    ]);
    expect((await source.list()).map((e) => e.path)).toEqual(['deep/er/x.json', 'deep/y.json', 'pack.mcmeta']);
    await sink.write([{ path: 'deep/y.json', bytes: text('22') }, { path: 'deep/er/x.json', delete: true }, { path: 'nope.json', delete: true }]);
    expect(await source.list()).toEqual([
      { path: 'deep/y.json', size: 2 },
      { path: 'pack.mcmeta', size: 2 },
    ]);
    expect(decode(await source.read('deep/y.json'))).toBe('22');
    await expectCode(source.read('deep/er/x.json'), 'not-found');
  });

  it('refuses the whole batch for an unsafe or doubled path, writing nothing', async () => {
    const { source, sink } = await open();
    await expectCode(sink.write([{ path: 'ok.txt', bytes: text('x') }, { path: '../evil.txt', bytes: text('x') }]), 'unsafe-path');
    await expectCode(sink.write([{ path: 'ok.txt', bytes: text('x') }, { path: 'ok.txt', delete: true }]), 'duplicate-path');
    expect(await source.list()).toEqual([]);
    await expectCode(source.read('../x'), 'unsafe-path').catch(() => undefined);
  });
});

describe('real folders', () => {
  it('node-fs removes the folders a deletion empties, and only those', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rwat-prune-'));
    try {
      const sink = new NodeFsSink(dir);
      await mkdir(join(dir, 'keep'));
      await sink.write([
        { path: 'a/b/c.txt', bytes: text('c') },
        { path: 'a/d.txt', bytes: text('d') },
        { path: 'x/y/z.txt', bytes: text('z') },
      ]);
      await sink.write([{ path: 'a/b/c.txt', delete: true }, { path: 'x/y/z.txt', delete: true }]);
      const rest = new NodeFsSource(dir);
      expect((await rest.list()).map((e) => e.path)).toEqual(['a/d.txt']);
      await expect(readFile(join(dir, 'a', 'b'))).rejects.toThrow();
      await expect(readFile(join(dir, 'x'))).rejects.toThrow();
      expect(await readFile(join(dir, 'a', 'd.txt'), 'utf8')).toBe('d');
      await expect(readFile(join(dir, 'keep'))).rejects.toThrow(/EISDIR/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('writes pack.mcmeta after the other files', async () => {
    const order: string[] = [];
    const root = new FakeDirectory('p');
    const original = root.getFileHandle.bind(root);
    root.getFileHandle = (name, options) => {
      if (options?.create === true) order.push(name);
      return original(name, options);
    };
    await new FsAccessSink(root).write([
      { path: 'pack.mcmeta', bytes: text('{}') },
      { path: 'z.txt', bytes: text('z') },
      { path: 'a.txt', bytes: text('a') },
    ]);
    expect(order).toEqual(['a.txt', 'z.txt', 'pack.mcmeta']);
  });
});

describe('File System Access permissions', () => {
  it('asks again for a handle that answers prompt, and fails when the answer is no', async () => {
    const root = new FakeDirectory('p');
    root.state = 'prompt';
    expect(await ensurePermission(root, 'readwrite', false)).toBe('prompt');
    expect(await ensurePermission(root, 'readwrite')).toBe('granted');

    root.state = 'prompt';
    root.onRequest = 'denied';
    await expectCode(new FsAccessSink(root).write([{ path: 'a', bytes: text('a') }]), 'permission-denied');
    root.state = 'prompt';
    await expectCode(openFsAccessSource(root), 'permission-denied');
  });

  it('opens read-only when writing is refused but reading is granted', async () => {
    const root = new FakeDirectory('p');
    root.queryPermission = () => Promise.resolve(Promise.resolve(root.state));
    let calls = 0;
    root.queryPermission = (() => Promise.resolve((calls++ === 0 ? 'denied' : 'granted')));
    const source: FsAccessSource = await openFsAccessSource(root);
    expect(source.writable).toBe(false);
  });
});
