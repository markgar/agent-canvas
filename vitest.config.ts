import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'apps/canvas/src/**/*.test.ts',
      'apps/canvas/tests/**/*.test.ts',
      '.chainkit/scripts/**/*.test.ts',
    ],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['apps/canvas/src/**/*.ts'],
      // The process entry point is exercised by subprocess integration tests.
      exclude: ['apps/canvas/src/server/main.ts', '**/*.test.ts'],
      reporter: ['text', 'lcov'],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
      },
    },
  },
});
