import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    // env.ts validates at import; provide test values (the real connection is the
    // in-memory server started in setup.ts, so MONGODB_URL here is just a placeholder).
    env: {
      NODE_ENV: 'test',
      MONGODB_URL: 'mongodb://127.0.0.1:27017/enigma-test',
    },
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/server.ts'],
    },
  },
});
