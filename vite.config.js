import { defineConfig } from 'vite';
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  build: { rollupOptions: { output: { manualChunks: { three: ['three'] } } } },
});
