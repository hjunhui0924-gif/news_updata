import { defineConfig } from 'vitest/config';

// These configuration/process tests require neither PostgreSQL nor Docker.
export default defineConfig({
  test: {
    include: [
      'tests/config.test.ts',
      'tests/database-safety.test.ts',
      'tests/deployment.unit.test.ts',
      'tests/native-deployment.unit.test.ts',
      'tests/runtime-selection.unit.test.ts',
    ],
    testTimeout: 20000,
    fileParallelism: false,
    env: { NODE_ENV: 'test' },
  },
});
