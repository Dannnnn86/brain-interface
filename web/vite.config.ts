import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  server: {
    port: 4200,
    proxy: {
      '/api': 'http://127.0.0.1:3030',
      '/ingest': 'http://127.0.0.1:3030',
      '/ws': {
        target: 'ws://127.0.0.1:3030',
        ws: true,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
});
