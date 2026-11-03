/**
 * `vite dev` serves the pack schema where the built site has it (schema/ next to the
 * page), straight from the repository: the editor loads it from there in development
 * too (app/session.ts `loadSchema`). Before, the dev server answered index.html, and the
 * editor in development had no schema checks and no forms.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REPO_SCHEMA_DIR } from '../src/testing/repo.node';

const EDITOR = join(import.meta.dirname, '..');
let server: ViteDevServer;
let base: string;

beforeAll(async () => {
  server = await createServer({
    root: EDITOR,
    configFile: join(EDITOR, 'vite.config.ts'),
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: null },
  });
  await server.listen();
  base = server.resolvedUrls?.local[0] ?? '';
}, 30_000);

afterAll(async () => {
  await server?.close();
});

describe('the dev server', () => {
  it('serves every schema file at schema/, byte for byte as JSON', async () => {
    const layout = JSON.parse(readFileSync(join(REPO_SCHEMA_DIR, 'pack-layout.json'), 'utf8')) as { schemas: string[] };
    for (const name of ['pack-layout.json', 'obj-conventions.json', ...layout.schemas]) {
      const response = await fetch(new URL(`schema/${name}`, base));
      expect(response.status, name).toBe(200);
      expect(response.headers.get('content-type'), name).toMatch(/^application\/json/);
      expect(Buffer.from(await response.arrayBuffer()).equals(readFileSync(join(REPO_SCHEMA_DIR, name))), name).toBe(true);
    }
  });

  it('serves nothing else of the repository that way', async () => {
    const response = await fetch(new URL('schema/..%2Fpackage.json', base));
    expect(await response.text()).not.toContain('"rwat-pack-editor"');
  });
});
