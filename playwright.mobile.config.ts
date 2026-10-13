import { defineConfig, devices } from '@playwright/test';

// Мобильные спеки (e2e/mobile/*.spec.ts). Нужен локальный стенд: мобильный макет
// открывается по праву аккаунта (MB-1), а право даёт база — значит нужен вход под
// админским аккаунтом стенда. Стенд поднимает scripts/stand/up.sh, webServer здесь
// нет.
//
// npx playwright test -c playwright.mobile.config.ts
export default defineConfig({
  testDir: './e2e',
  testMatch: 'mobile/**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    // Стенд отвечает на STAND_URL из scripts/stand/.env.stand; по умолчанию :3000.
    baseURL: process.env.STAND_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    // Снимок падения — то же доказательство «до», что и зелёный прогон на ветке.
    screenshot: 'only-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
  },
  projects: [
    { name: 'Mobile Chrome', use: { ...devices['Pixel 5'] } },
    { name: 'Mobile Safari', use: { ...devices['iPhone 12'] } },
  ],
});
