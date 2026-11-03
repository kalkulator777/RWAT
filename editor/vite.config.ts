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
 *   Pyodide (dist/pyodide/, added in M6) is cached when first used, not on the first visit.
 *
 * Only the conductor changes this file (§7.0), except A6.1 for serving Pyodide and the
 * `?raw` import of tools/*.py.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const editorDir = dirname(fileURLToPath(import.meta.url));
const repoDir = resolve(editorDir, '..');
const schemaDir = resolve(repoDir, 'schema');

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
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: /\/pyodide\//,
            handler: 'CacheFirst',
            options: { cacheName: 'rwat-pyodide' },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
});
