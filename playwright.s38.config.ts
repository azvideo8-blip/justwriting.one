import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';

// S-38: прогон слияния диалогов на двух профилях браузера на локальном стенде
// (scripts/stand/up.sh + api/server.ts с заглушкой ИИ через STAND_API_PORT).
// Стендовые спеки — все *.stand.spec.ts: они читают scripts/stand/.env.stand,
// поэтому в обычном наборе (playwright.config.ts) их нет.

// Прежний `process.env.STAND_URL ?? 'http://localhost:3000'` молча уходил на
// чужой сервис, если переменная не экспортирована: тот ронял React
// («Invalid hook call»), страница логина не рендерилась, и падал `beforeAll` —
// прогон выглядел как дефект продукта, а был дефектом окружения.
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
  testMatch: /\.stand\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 240_000,
  use: {
    baseURL: standUrl(),
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
