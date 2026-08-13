import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so `dist/` can be served from any path (or a subfolder on a
  // static host) without rewriting asset URLs.
  base: './',
  build: {
    target: 'es2023',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    open: true,
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
