import { defineConfig, devices } from '@playwright/test';

// На VPS-раннере :3000 занят прод-API (justwriting.service): CI задаёт E2E_PORT.
// strictPort — занятый порт роняет прогон, а не пускает тесты в чужой сервер.
const PORT = process.env.E2E_PORT ?? '3000';

export default defineConfig({
  testDir: './e2e',
  // Стендовые спеки (*.stand.spec.ts) гоняются своим конфигом (playwright.s38.config.ts)
  // и читают scripts/stand/.env.stand при загрузке — в обычном наборе их нет.
  // e2e/mobile/ — тоже отдельный прогон (playwright.mobile.config.ts): им нужен
  // стенд, потому что мобильный макет открывается по праву аккаунта из базы (MB-1).
  // Без этой строки обычный `--project=chromium` тащит мобильные спеки на dev-сервер
  // и падает на входе.
  testIgnore: [/accountSwitch\.spec\.ts/, /\.stand\.spec\.ts$/, /mobile[\\/]/],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: 'html',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'Mobile Chrome', use: { ...devices['Pixel 5'] } },
    { name: 'Mobile Safari', use: { ...devices['iPhone 12'] } },
  ],
});
