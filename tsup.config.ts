import { defineConfig } from 'tsup';

// tsup (esbuild) bundles + resolves path aliases and extensions, emitting runnable
// ESM to dist/. Type-checking is handled separately via `tsc --noEmit` (see CI).
export default defineConfig({
  entry: ['src/server.ts'],
  outDir: 'dist',
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  minify: false,
  splitting: false,
  // Keep dependencies external (node_modules installed at runtime); only our src is bundled.
  skipNodeModulesBundle: true,
});
