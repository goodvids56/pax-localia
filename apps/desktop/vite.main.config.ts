import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    sourcemap: process.env.NODE_ENV !== 'production',
    rollupOptions: {
      external: [
        'electron',
        'better-sqlite3',
        ...builtinModules,
        ...builtinModules.map((id) => `node:${id}`),
      ],
    },
  },
});
