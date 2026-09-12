import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import { testDatabaseUrl } from './tests/setup-db.ts';
export default defineConfig({
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['./tests/setup-db.ts'],
    testTimeout: 20000,
    fileParallelism: false,
    env: { NODE_ENV: 'test', DATABASE_URL: testDatabaseUrl },
  },
});
