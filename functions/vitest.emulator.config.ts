import { defineConfig } from 'vitest/config';

// Separate config for emulator-backed tests. The default vitest.config.ts
// EXCLUDES these (they need a running Firestore emulator); the test:emulator /
// test:rules scripts use this config so the files are actually picked up.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/emulator/**/*.test.ts', 'src/**/__tests__/rules.test.ts'],
  },
});
