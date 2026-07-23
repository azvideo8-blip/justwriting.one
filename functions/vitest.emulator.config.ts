import { defineConfig } from 'vitest/config';

// Separate config for emulator-backed tests. The default vitest.config.ts
// EXCLUDES these (they need a running Firestore emulator); the test:emulator /
// test:rules scripts use this config so the files are actually picked up.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/emulator/**/*.test.ts', 'src/**/__tests__/rules.test.ts'],
    // The per-user daily-limit tests hard-code an expected cap of 3 (aiUtils
    // reads AI_DAILY_LIMIT at import; default is 10). Set it so the runtime cap
    // matches the tests. Applied before test files import aiUtils.
    env: { AI_DAILY_LIMIT: '3' },
  },
});
