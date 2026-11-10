/**
 * Build of the editor's static site (docs/proposals/editor.md §3.1, §5.4, §5.5).
 *
 * - `base: './'`: every URL in the build is relative, so the same dist/ works on GitHub
 *   Pages under /RWAT/, from `vite preview` at / and from any other folder.
 * - The site carries the pack schema at schema/*.json, byte for byte as in the
 *   repository: the schemas' `$id` (https://kalkulator777.github.io/RWAT/schema/…) point
 *   there, and the service worker precaches them with the rest. `vite dev` serves the
 *   same files from the repository at the same place.
 * - The service worker (vite-plugin-pwa, Workbox) precaches the shell on the first visit;
 *   Pyodide is cached when first used, not on the first visit.
 * - Pyodide (the `pyodide` package, its version pinned in package.json) is served from the
 *   site at pyodide/<version>/: the interpreter, its script and the standard library, no
 *   other package and nothing from a CDN (§3.12, §5.5). The folder carries the version, so
 *   a new one is new addresses and the service worker's cache-first copy of the old one
 *   can never be mixed with it. `vite dev` serves the same files from node_modules.
 * - tools/ir2rwat.py and tools/floorgen.py come into the Python worker as text (`?raw`,
 *   src/ir/python.ts): the dev server may read tools/.
 *
 * Only the conductor changes this file (§7.0), except A6.1 for serving Pyodide and the
 * `?raw` import of tools/*.py.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const editorDir = dirname(fileURLToPath(import.meta.url));
const repoDir = resolve(editorDir, '..');
const schemaDir = resolve(repoDir, 'schema');

/** The `pyodide` package's folder in node_modules. */
const pyodidePackageDir = dirname(createRequire(import.meta.url).resolve('pyodide/package.json'));
const pyodideVersion = (JSON.parse(readFileSync(resolve(pyodidePackageDir, 'package.json'), 'utf8')) as { version: string }).version;

/**
 * The files of Pyodide the site serves: its loader, the interpreter (script and wasm), the
 * standard library and the lock file it reads at start. Not the UMD script, the source
 * maps, the consoles or the type declarations; no package beyond the standard library
 * (zipfile, zlib, json, re, struct are in it).
 */
const PYODIDE_FILES = ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'];

/** Where Pyodide is next to the page: a folder of its version. */
const PYODIDE_DIR = `pyodide/${pyodideVersion}/`;

/** The MIME type the dev server gives a file of Pyodide (an import, a wasm compiled as it streams). */
function pyodideType(name: string): string {
  if (name.endsWith('.mjs')) return 'text/javascript; charset=utf-8';
  if (name.endsWith('.wasm')) return 'application/wasm';
  if (name.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/zip';
}

/**
 * Pyodide's files at pyodide/<version>/ next to the page, byte for byte from the package:
 * emitted into the build, served by `vite dev` from node_modules. Only {@link PYODIDE_FILES}.
 */
function publishPyodide(): Plugin {
  return {
    name: 'rwat-publish-pyodide',
    configureServer(server) {
      server.middlewares.use(`/${PYODIDE_DIR}`, (request, response, next) => {
        const name = (request.url ?? '').split('?')[0]?.replace(/^\//, '') ?? '';
        if (!PYODIDE_FILES.includes(name)) {
          next();
          return;
        }
        response.setHeader('Content-Type', pyodideType(name));
        response.end(readFileSync(resolve(pyodidePackageDir, name)));
      });
    },
    generateBundle() {
      for (const name of PYODIDE_FILES) {
        this.emitFile({ type: 'asset', fileName: `${PYODIDE_DIR}${name}`, source: readFileSync(resolve(pyodidePackageDir, name)) });
      }
    },
  };
}

/** The schema files: every ../schema/*.json, sorted. */
function schemaFiles(): string[] {
  return readdirSync(schemaDir)
    .filter((name) => name.endsWith('.json'))
    .sort();
}

/**
 * ../schema/*.json at schema/*.json next to the page, unchanged: emitted into the build,
 * and served by `vite dev` straight from the repository (the dev server has no build to
 * serve them from, and its fallback would answer index.html). Only the schema's own file
 * names are served, so nothing else of the repository is reachable this way.
 */
function publishSchema(): Plugin {
  return {
    name: 'rwat-publish-schema',
    configureServer(server) {
      server.middlewares.use('/schema', (request, response, next) => {
        const name = (request.url ?? '').split('?')[0]?.replace(/^\//, '') ?? '';
        if (!schemaFiles().includes(name)) {
          next();
          return;
        }
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.setHeader('Cache-Control', 'no-cache');
        response.end(readFileSync(resolve(schemaDir, name)));
      });
    },
    generateBundle() {
      for (const name of schemaFiles()) {
        this.emitFile({ type: 'asset', fileName: `schema/${name}`, source: readFileSync(resolve(schemaDir, name)) });
      }
    },
  };
}

export default defineConfig({
  base: './',
  define: {
    // src/ir/bridge.ts: where Pyodide is, and its files' sizes for the loading's progress
    __RWAT_PYODIDE__: JSON.stringify({
      dir: PYODIDE_DIR,
      files: Object.fromEntries(PYODIDE_FILES.map((name) => [name, statSync(resolve(pyodidePackageDir, name)).size])),
    }),
  },
  oxc: {
    jsx: { runtime: 'automatic', importSource: 'preact' },
  },
  server: {
    fs: {
      // The editor reads the repository's schema, golden data and pack tools (§3.7, §4.5, §3.12).
      allow: [editorDir, schemaDir, resolve(repoDir, 'fixtures'), resolve(repoDir, 'tools')],
    },
  },
  build: {
    target: 'es2023',
    sourcemap: true,
  },
  plugins: [
    publishSchema(),
    publishPyodide(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      // The icons are in public/ and so in globPatterns already.
      includeManifestIcons: false,
      manifest: {
        name: 'RWAT pack editor',
        short_name: 'RWAT editor',
        description: 'Open, check and save RWAT train packs for Minecraft in the browser, also offline.',
        lang: 'en',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#f4f5f7',
        theme_color: '#1d5bbf',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{html,js,css,woff2,svg,png,json,txt}'],
        globIgnores: ['pyodide/**'],
        // The bundle with three.js is the largest file; Workbox skips anything over its
        // 2 MiB default silently, and a skipped chunk would break the offline editor.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        // The first service worker takes the page it is installed from at once, so that
        // Pyodide used on the first visit is cached as it is fetched, not only from the
        // next visit on. A new version still waits for the notice (registerType 'prompt'):
        // it activates only when the user reloads from it.
        clientsClaim: true,
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // Pyodide, when first used (§5.5): the folder is the version's, so cache first
            // is safe; as many entries as a version has files, so a new version's push out
            // the old one's as they are fetched
            urlPattern: /\/pyodide\/[^/]+\/[^/]+$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'rwat-pyodide',
              expiration: { maxEntries: PYODIDE_FILES.length },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
});
