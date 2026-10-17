import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';

// UG-2: станок съёмки десктопных кадров руководства (e2e/docs-shots.ug2.spec.ts).
// Нужен локальный стенд: аккаунт с сейфом заводится через админ-API GoTrue, а
// приложение берётся из сборки стенда. webServer здесь нет.
//
//   JW_UG_SHOTS=1 npx playwright test -c playwright.docs.config.ts
//
// 1280×800 @2x — тот самый размер, что лежит в public/docs/img (2560×1600).
function standUrl(): string {
  const fromEnv = process.env.STAND_URL;
  if (fromEnv) return fromEnv;
  try {
    const line = readFileSync('scripts/stand/.env.stand', 'utf8')
      .split('\n')
      .find(l => l.startsWith('STAND_URL='));
    if (line) return line.slice('STAND_URL='.length).trim();
  } catch { /* файла нет — стенд не поднят */ }
  throw new Error('STAND_URL не задан и scripts/stand/.env.stand не найден — поднимите стенд: bash scripts/stand/up.sh');
}

export default defineConfig({
  testDir: './e2e',
  testMatch: /docs-shots\.ug2\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 420_000,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  use: {
    baseURL: standUrl(),
    trace: 'off',
    screenshot: 'off',
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
  },
  projects: [
    { name: 'Desktop Chrome', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 } },
  ],
});
