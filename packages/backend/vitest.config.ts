import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: './tests/globalSetup.ts',
    include: ['tests/**/*.test.ts'],
    // Integration tests share one disposable database and (per test file) one real
    // listening server -- running files sequentially avoids cross-file races without
    // requiring per-test transactional rollback machinery. Each file's own tests still
    // run in isolation from other files' module state (separate worker per file).
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 20000,
  },
});
