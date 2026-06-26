import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Emulator and rules tests require a running Firestore emulator — exclude from default run
    exclude: ['src/**/__tests__/emulator/**', 'src/**/__tests__/rules.test.ts', 'node_modules/**'],
  },
});
