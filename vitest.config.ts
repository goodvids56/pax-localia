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
    include: ['tests/unit/**/*.test.ts'],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['packages/{domain,simulation,ai,scenario-sdk}/src/**/*.ts'],
      thresholds: {
        lines: 55,
        functions: 55,
        statements: 55,
        branches: 45,
      },
    },
  },
});
