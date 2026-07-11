import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@pax-localia/domain': path.resolve(__dirname, 'packages/domain/src/index.ts'),
      '@pax-localia/simulation': path.resolve(__dirname, 'packages/simulation/src/index.ts'),
      '@pax-localia/ai': path.resolve(__dirname, 'packages/ai/src/index.ts'),
      '@pax-localia/database': path.resolve(__dirname, 'packages/database/src/index.ts'),
      '@pax-localia/map-data': path.resolve(__dirname, 'packages/map-data/src/index.ts'),
      '@pax-localia/scenario-sdk': path.resolve(__dirname, 'packages/scenario-sdk/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    sequence: {
      concurrent: false,
    },
  },
});
