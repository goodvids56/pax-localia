import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, '../../.vite/renderer/main_window'),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    strictPort: true,
  },
});
