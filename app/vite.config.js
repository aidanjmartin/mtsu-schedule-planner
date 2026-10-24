import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

// The site is published at https://<owner>.github.io/mtsu-schedule-planner/.
export default defineConfig({
  base: '/mtsu-schedule-planner/',
  plugins: [react()],
  server: {
    // The app imports the planning engine from ../web/engine, outside this folder.
    fs: { allow: [repoRoot] },
  },
  build: {
    chunkSizeWarningLimit: 1800,
  },
  // Component tests run with Vitest in a simulated browser (jsdom). `npm test` runs them.
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{js,jsx}'],
    setupFiles: ['test/setup.js'],
    testTimeout: 30000,
  },
});
