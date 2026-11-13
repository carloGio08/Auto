import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { serviceWorkerPlugin } from './vite-plugins/serviceWorker';

// GitHub Pages serves the site from /<repo-name>/. The deploy workflow sets BASE_PATH from the
// repository name; locally `npm run dev` / `npm run preview` use "/".
const base = process.env.BASE_PATH ?? '/';
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'] },
      },
    },
  },
  plugins: [serviceWorkerPlugin()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
