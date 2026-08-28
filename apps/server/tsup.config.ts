import { defineConfig } from 'tsup';

/**
 * The workspace packages (`@mafia/shared`, `@mafia/game-engine`) ship as
 * TypeScript source, so the server build bundles them in rather than expecting
 * a separate compile step. Runtime dependencies stay external and are resolved
 * from node_modules as usual.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  noExternal: ['@mafia/shared', '@mafia/game-engine'],
  external: ['@prisma/client'],
});
