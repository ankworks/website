import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Local dev: the Vite dev server serves the frontend and proxies /api to the
// Worker running under `npm run worker:dev` (wrangler dev on port 8787).
const WORKER_DEV_URL = 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
  root: '.',
  publicDir: 'public',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@types': path.resolve(__dirname, './src/types'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@api': path.resolve(__dirname, './src/api'),
    },
  },
  build: {
    // Must match assets.directory in wrangler.jsonc.
    outDir: 'dist',
    emptyOutDir: true,
    // Source maps are not published to production assets.
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
        },
      },
    },
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
    allowedHosts: ['.e2b.app', 'localhost'],
    proxy: {
      '/api': {
        target: WORKER_DEV_URL,
        changeOrigin: false,
      },
    },
  },
  preview: {
    port: 4173,
    host: '0.0.0.0',
  },
});
