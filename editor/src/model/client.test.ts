/**
 * The model client (./client.ts) against the worker's interface (./api.ts) through comlink
 * over a MessageChannel, as the main thread talks to ../workers/model.worker.ts: the
 * reader proxy, the transfer of the buffers, the cache by the files' stamps, one reading
 * for two requests at once.
 */

import { expose, wrap, type Remote } from 'comlink';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryPack } from '../io';
import { createModelApi } from './api';
import { checkModelFiles, ModelLoader } from './client';
import { sourceFiles, type ModelFiles } from './files';
import type { ModelCheckApi, ModelRequest, ModelWorkerApi } from './types';

const OBJ = ['mtllib m.mtl', 'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'o BODY', 'usemtl paint', 'f 1 2 3', ''].join('\n');

const channels: MessageChannel[] = [];

afterEach(() => {
  for (const channel of channels.splice(0)) {
    channel.port1.close();
    channel.port2.close();
  }
});

/** The worker's interface across a MessageChannel, as in a worker; textures decode to null (Node has no bitmaps). */
function remoteApi(): Remote<ModelWorkerApi & ModelCheckApi> {
  const channel = new MessageChannel();
  channels.push(channel);
  expose(createModelApi(() => Promise.resolve(null)), channel.port2);
  return wrap<ModelWorkerApi & ModelCheckApi>(channel.port1);
}

/** A pack of models `m0`…`m<n−1>` and files that count what the worker reads and can be stamped anew. */
async function pack(models = 1): Promise<{ files: ModelFiles; reads: string[]; bump: (path: string) => void; requests: ModelRequest[] }> {
  const contents: Record<string, string> = { 'assets/t/stock/m.mtl': 'newmtl paint\nmap_Kd paint.png\n', 'assets/t/stock/paint.png': 'png' };
  const requests: ModelRequest[] = [];
  for (let i = 0; i < models; i++) {
    contents[`assets/t/stock/m${i}.obj`] = OBJ;
    requests.push({ id: `t:m${i}`, file: `assets/t/wagon_models/m${i}.json`, declaration: { obj: `stock/m${i}.obj` } });
  }
  const source = await sourceFiles(new MemoryPack('t', contents));
  const reads: string[] = [];
  const bumped = new Map<string, number>();
  const files: ModelFiles = {
    has: (path) => source.has(path),
    read: (path) => {
      reads.push(path);
      return source.read(path);
    },
    stamp: (path) => `${source.stamp(path)}:${bumped.get(path) ?? 0}`,
  };
  return { files, reads, bump: (path) => bumped.set(path, (bumped.get(path) ?? 0) + 1), requests };
}

describe('ModelLoader through a worker', () => {
  it('loads a model, its buffers transferred across', async () => {
    const { files, requests } = await pack();
    const model = await new ModelLoader(remoteApi()).load(files, requests[0]!);
    expect(model.problems).toEqual([]);
    expect(model.objects.map((o) => o.role)).toEqual(['body']);
    expect(model.parts[0]?.positions).toBeInstanceOf(Float32Array);
    expect(Array.from(model.parts[0]!.positions)).toEqual([0, 0, 0, 1, 0, 0, 1, 1, 0]);
    expect(model.textures).toEqual({ 'assets/t/stock/paint.png': null });
  });

  it('transfers the buffers: once across, they are empty on the worker side', async () => {
    const { files, requests } = await pack();
    const inner = createModelApi(() => Promise.resolve(null));
    const sent: ArrayBuffer[] = [];
    const channel = new MessageChannel();
    channels.push(channel);
    const spy: ModelWorkerApi = {
      async load(request, reader) {
        const model = await inner.load(request, reader);
        for (const part of model.parts) sent.push(part.positions.buffer as ArrayBuffer, part.uvs.buffer as ArrayBuffer);
        return model; // the same object: comlink transfers what api.ts marked
      },
      textures: (paths, reader) => inner.textures(paths, reader),
    };
    expose(spy, channel.port2);
    const model = await new ModelLoader(wrap<ModelWorkerApi>(channel.port1)).load(files, requests[0]!);
    expect(sent.length).toBeGreaterThan(0);
    for (const buffer of sent) expect(buffer.byteLength).toBe(0);
    expect(model.parts[0]!.positions.length).toBe(9);
  });

  it('answers from memory while no file changed, and reads again what an edit touched', async () => {
    const { files, reads, bump, requests } = await pack();
    const loader = new ModelLoader(remoteApi());
    const request = requests[0]!;
    const first = await loader.load(files, request);
    const count = reads.length;
    expect(count).toBeGreaterThan(0);
    expect(await loader.load(files, request)).toBe(first);
    expect(reads.length).toBe(count);
    bump('assets/t/stock/paint.png'); // a texture replaced
    const second = await loader.load(files, request);
    expect(second).not.toBe(first);
    expect(reads.length).toBeGreaterThan(count);
    const edited = await loader.load(files, { ...request, declaration: { obj: 'stock/m0.obj', skip: ['BODY'] } });
    expect(edited.objects[0]?.role).toBe('skip');
    expect(await loader.load(files, request)).not.toBe(edited);
  });

  it('keeps the last three models, and a fourth drops the oldest', async () => {
    const { files, requests } = await pack(4);
    const loader = new ModelLoader(remoteApi());
    for (const request of requests) await loader.load(files, request);
    expect(loader.cached()).toEqual(['assets/t/wagon_models/m1.json', 'assets/t/wagon_models/m2.json', 'assets/t/wagon_models/m3.json']);
    loader.clear();
    expect(loader.cached()).toEqual([]);
  });

  it('reads a model once for two requests at once', async () => {
    const { files, reads, requests } = await pack();
    const loader = new ModelLoader(remoteApi());
    const [a, b] = await Promise.all([loader.load(files, requests[0]!), loader.load(files, requests[0]!)]);
    expect(a).toBe(b);
    expect(reads.filter((path) => path.endsWith('.obj'))).toHaveLength(1);
  });

  it('decodes textures by path in the worker', async () => {
    const { files } = await pack();
    const loader = new ModelLoader(remoteApi());
    expect(await loader.textures(files, ['assets/t/stock/paint.png', 'assets/t/stock/none.png'])).toEqual({
      'assets/t/stock/paint.png': null,
      'assets/t/stock/none.png': null,
    });
  });

  it('remembers a model that cannot be read too, until its files change', async () => {
    const { files, requests } = await pack();
    const loader = new ModelLoader(createModelApi(() => Promise.resolve(null)));
    const request = { ...requests[0]!, declaration: { obj: 'stock/gone.obj' } };
    const model = await loader.load(files, request);
    expect(model.problems.map((p) => p.code)).toEqual(['model.missing']);
    expect(await loader.load(files, request)).toBe(model);
  });

  it('checks a model alone across the channel: the pack check\'s findings, nothing built, every file read through the proxy', async () => {
    const { files, reads, requests } = await pack();
    expect(await checkModelFiles(remoteApi(), files, requests[0]!)).toEqual([]);
    expect(reads).toEqual(['assets/t/stock/m0.obj', 'assets/t/stock/m.mtl']);
    const missing = await checkModelFiles(remoteApi(), files, { ...requests[0]!, declaration: { obj: 'stock/m0.obj', liveries: { red: 'red' } } });
    expect(missing.map((p) => [p.code, p.at])).toEqual([
      ['model.livery-replaces-nothing', [{ kind: 'field', file: 'assets/t/wagon_models/m0.json', at: '/liveries/red' }]],
    ]);
  });
});
