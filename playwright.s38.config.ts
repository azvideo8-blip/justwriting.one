import { defineConfig, devices } from '@playwright/test';

// S-38: прогон слияния диалогов на двух профилях браузера на локальном стенде
// (scripts/stand/up.sh + api/server.ts с заглушкой ИИ через STAND_API_PORT).
export default defineConfig({
  testDir: './e2e',
  testMatch: 'dialogueSync.stand.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 240_000,
  use: {
    baseURL: process.env.STAND_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
