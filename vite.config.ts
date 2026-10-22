import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // the 3D engine in its own file: it stays in the browser cache across game updates
        manualChunks: { three: ['three'] },
      },
    },
  },
});
