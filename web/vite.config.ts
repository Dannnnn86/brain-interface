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
    // Windows fs.watch silently drops events under rapid saves, which made
    // Vite serve stale CSS/TS transforms. Polling is reliable; cost is
    // negligible for this small tree and it only affects dev.
    watch: { usePolling: true, interval: 300 },
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
