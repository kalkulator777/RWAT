/**
 * Node only (tests): the example pack's models as the model worker hands them over — read
 * by the model pipeline (./api.ts `createModelApi`, ./build.ts) from the repository's
 * files, the textures stood in for (Node decodes no images). One place for every module's
 * tests that need a real model: the view's, the preview's, the objects tab's, the shell's.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LoadedModel } from '../core/contracts';
import { NodeFsSource } from '../io/nodeFs.node';
import { EXAMPLE_PACK } from '../testing/repo.node';
import { createModelApi } from './api';
import { sourceFiles } from './files';
import type { ModelCheckApi, ModelReader, ModelWorkerApi } from './types';

/** The example pack's wagons. */
export type ExampleWagon = 'coach' | 'shunter' | 'gondola';

export const EXAMPLE_NAMESPACE = 'rwat_example';

/** `stock/coach/coach.obj` of the example pack's namespace → `assets/rwat_example/stock/coach/coach.obj`. */
export function assetPath(ref: string): string {
  return `assets/${EXAMPLE_NAMESPACE}/${ref}`;
}

/** A pack file's bytes. */
export function packBytes(packPath: string): Buffer {
  return readFileSync(join(EXAMPLE_PACK, ...packPath.split('/')));
}

/** A pack file's text. */
export function packText(packPath: string): string {
  return packBytes(packPath).toString('utf8');
}

/** A stand-in for a decoded texture: tests only tell them apart, by path. */
export function fakeBitmap(packPath: string): ImageBitmap {
  return { path: packPath, width: 1, height: 1, close: () => undefined } as unknown as ImageBitmap;
}

/** The worker's interface in this thread, decoding each texture into a {@link fakeBitmap}. */
export const exampleApi: ModelWorkerApi & ModelCheckApi = createModelApi((_bytes, path) => Promise.resolve(fakeBitmap(path)));

/** The example pack's files as the worker reads them. */
export async function exampleReader(): Promise<ModelReader> {
  const files = await sourceFiles(new NodeFsSource(EXAMPLE_PACK));
  return {
    read: async (path) => ((await files.has(path)) ? files.read(path) : null),
    has: async (path) => files.has(path),
  };
}

/** The example wagon's model declaration's pack path. */
export function exampleDeclaration(name: ExampleWagon): string {
  return assetPath(`wagon_models/${name}.json`);
}

/** The example wagon's model as the model worker hands it over. */
export async function exampleModel(name: ExampleWagon): Promise<LoadedModel> {
  const file = exampleDeclaration(name);
  return exampleApi.load({ id: `${EXAMPLE_NAMESPACE}:${name}`, file, declaration: JSON.parse(packText(file)) as unknown }, await exampleReader());
}
