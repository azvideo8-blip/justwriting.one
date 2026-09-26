import { defineConfig, devices } from '@playwright/test';

// F-3: сквозной сценарий смены аккаунта на локальном стенде (scripts/stand/up.sh).
// Стенд поднимает скрипт, поэтому webServer здесь нет; только chromium, headless.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'accountSwitch.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  timeout: 90_000,
  use: {
    baseURL: process.env.STAND_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
