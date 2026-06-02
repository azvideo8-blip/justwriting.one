# Тикеты для достижения 9/10 и 10/10 — justwriting

> **Текущая оценка:** 8/10
> **Цель:** 9/10 → 10/10
> **Дата:** 2 июня 2026

---

## Часть 1: Дорога к 9/10 (критичные остатки)

### T9-01 — Закрыть 6 moderate npm vulnerabilities

**Приоритет:** 🔴 P0  
**Оценка:** 2–4 часа  
**Блок:** Безопасность (6 moderate уязвимостей)

#### Проблема

```bash
$ npm audit --audit-level=moderate
Severity: moderate
Severity: moderate
6 moderate severity vulnerabilities
```

Уязвимости в transitive dependencies:
- `uuid` (через `@google-cloud/firestore`, `teeny-request`, `universal-analytics`)
- `retry-request` (через `@google-cloud/firestore`)

#### Решение

**Шаг 1:** `npm audit fix` в корне и `functions/`

```bash
# Корень
npm audit fix

# Functions
npm --prefix functions audit fix
```

**Шаг 2:** Если breaking changes — `npm audit fix --force` с ручным smoke-тестом

```bash
npm audit fix --force
npm run build
npm run test:ci
```

**Шаг 3:** Если transitive deps не фиксятся — `overrides` в `package.json`

```json
// package.json
{
  "overrides": {
    "uuid": "^9.0.1",
    "@google-cloud/firestore": {
      "teeny-request": "^9.0.0",
      "retry-request": "^7.0.2"
    }
  }
}
```

**Шаг 4:** Перегенерировать `package-lock.json`

```bash
rm -rf node_modules package-lock.json
npm install
npm run build
```

#### Критерий готовности

```bash
npm audit --audit-level=moderate  # 0 vulnerabilities
npm audit --audit-level=high      # 0 vulnerabilities
npm run build                        # зелёный
npm run test:ci                      # зелёный
npm --prefix functions run build     # зелёный
```

---

### T9-02 — Динамические inline styles → CSS custom properties / Tailwind arbitrary

**Приоритет:** 🟡 P2  
**Оценка:** 6–8 часов  
**Блок:** Дизайн-система (268 inline styles, преимущественно динамические)

#### Проблема

268 inline styles в JSX. Остались после того, как статические были переведены на utility-классы:

```tsx
// ❌ Динамические inline styles
style={{ color: label.color, opacity: progress / 100 }}
style={{ animationDelay: `${i * 50}ms` }}
style={{ width: `${percent}%`, height: '100%' }}
style={{ background: `color-mix(in srgb, ${label.color} 4%, transparent)` }}
style={{ gridTemplateColumns: '72px 1fr auto' }}
style={{ borderBottom: '1px solid var(--color-border-subtle)' }}
```

#### Решение

**Паттерн 1: Динамические цвета → CSS custom properties**

```tsx
// Было
<div style={{ color: label.color, borderColor: label.color }} />

// Стало
<div
  className="border"
  style={{ '--label-color': label.color } as React.CSSProperties}
  style={{ color: 'var(--label-color)', borderColor: 'var(--label-color)' }}
/>

// Или через Tailwind arbitrary:
<div className={`border-[${label.color}] text-[${label.color}]`} />
// ⚠️ Tailwind arbitrary values compile-time, не рантайм
```

**Паттерн 2: Размеры → Tailwind arbitrary + CSS variables**

```tsx
// Было
<div style={{ width: `${progress}%` }} />

// Стало
<div className="w-full">
  <div className="bg-brand-primary h-full transition-all" style={{ width: `${progress}%` }} />
</div>
// Оставляем только width (единственный динамический), остальное — utility
```

**Паттерн 3: Animation delay → CSS custom properties**

```tsx
// Было
{items.map((item, i) => (
  <div key={i} style={{ animationDelay: `${i * 50}ms` }} />
))}

// Стало
{items.map((item, i) => (
  <div key={i} style={{ '--delay': `${i * 50}ms` } as React.CSSProperties} className="animate-fade-in" />
))}

// CSS
// @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
// .animate-fade-in { animation: fadeIn 0.3s ease-out var(--delay, 0ms) forwards; }
```

**Паттерн 4: Grid → Tailwind arbitrary**

```tsx
// Было
<div style={{ gridTemplateColumns: '72px 1fr auto' }} />

// Стало
<div className="grid grid-cols-[72px_1fr_auto]" />
```

**Паттерн 5: Border → Tailwind utility**

```tsx
// Было
<div style={{ borderBottom: '1px solid var(--color-border-subtle)' }} />

// Стало
<div className="border-b border-border-subtle" />
```

#### Пошаговый план

1. **Фаза 1 — Safe-area (40 шт)** (1 час)
   - Добавить `.safe-top`, `.safe-bottom`, `.safe-inline` в `index.css`
   - Заменить `paddingBottom: 'env(safe-area-inset-bottom)'` на utility-классы

2. **Фаза 2 — Grid / border (40 шт)** (1 час)
   - `gridTemplateColumns` → `grid-cols-[...]`
   - `borderBottom` → `border-b`

3. **Фаза 3 — Layout / flex (30 шт)** (1 час)
   - `display: flex` → `className="flex"`
   - `gap: 6` → `gap-1.5`
   - `flexDirection: column` → `flex-col`

4. **Фаза 4 — Font / text (20 шт)** (1 час)
   - `fontSize: 11` → `text-[11px]`
   - `fontFamily: 'JetBrains Mono'` → `font-mono`
   - `textWrap: 'pretty'` → `text-pretty`

5. **Фаза 5 — Динамические цвета (60 шт)** (2 часа)
   - `label.color` → CSS custom properties через inline style
   - `stat.color` → `Badge` variant
   - `progress / 100` → `opacity` utility

6. **Фаза 6 — Animation delay (30 шт)** (1 час)
   - CSS custom properties `--delay`
   - Tailwind `animate-*` с `var(--delay)`

7. **Фаза 7 — Прогресс-бар / размеры (50 шт)** (1 час)
   - `width: \`${progress}%\`` → оставляем inline, но всё остальное на utility
   - Минимизировать inline style до 1 property

#### Критерий готовности

```bash
# Инлайн-стилей должно остаться < 50 (только динамические: width, opacity, color)
grep -rn 'style={{' src/ --include='*.tsx' | grep -v test | grep -v node_modules | wc -l
# → < 50

# Все статические layout, font, border, grid — на utility-классах
# Динамические — только 1-2 property в inline style
# Нет `style={{ ... }}` с 5+ свойствами

npx tsc --noEmit  # 0
npx eslint . --ext .ts,.tsx --max-warnings 0  # 0
npx vitest run  # 421 passed
npm run build  # OK
```

---

## Часть 2: Дорога к 10/10 (превосходство)

### T10-01 — Поднять coverage thresholds до 80%

**Приоритет:** 🟢 P3  
**Оценка:** 4–6 часов  
**Блок:** Тесты (coverage thresholds на 75%)

#### Проблема

```ts
// vite.config.ts
thresholds: {
  statements: 75,
  branches: 70,
  functions: 75,
  lines: 75,
}
```

Превосходство требует 80%+ по всем метрикам.

#### Решение

**Шаг 1:** Проверить текущую coverage

```bash
npm run test:coverage
```

**Шаг 2:** Найти недостаточно покрытые модули

```bash
npx vitest run --coverage
# Посмотреть HTML report в coverage/
```

**Шаг 3:** Дописать тесты для слабых мест:

| Модуль | Что тестировать | Оценка |
|--------|-------------------|--------|
| `features/ai/` | AI chat flow, error handling, rate limiting | 1 час |
| `features/archive/` | Archive CRUD, export, filtering | 1 час |
| `features/settings/` | Settings persistence, sync diagnostics | 1 час |
| `features/auth/` | Auth flow, encryption, migration | 1 час |
| `core/services/` | StorageService edge cases, conflict resolution | 1 час |

**Шаг 4:** Поднять thresholds

```ts
// vite.config.ts
thresholds: {
  statements: 80,
  branches: 80,
  functions: 80,
  lines: 80,
}
```

#### Критерий готовности

```bash
npm run test:coverage
# statements: ≥ 80%
# branches: ≥ 80%
# functions: ≥ 80%
# lines: ≥ 80%
```

---

### T10-02 — E2E тесты (Playwright)

**Приоритет:** 🟢 P3  
**Оценка:** 8–12 часов  
**Блок:** Тесты (только unit + интеграционные, нет E2E)

#### Проблема

Нет end-to-end тестов. Нет автоматической проверки:
- Auth flow (login → logout)
- Writing session (start → type → save → verify in archive)
- Encryption (setup → lock → unlock)
- Mobile responsiveness

#### Решение

**Шаг 1:** Установить Playwright

```bash
npm i -D @playwright/test
npx playwright install
```

**Шаг 2:** Создать базовый конфиг

```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'Mobile Chrome', use: { ...devices['Pixel 5'] } },
    { name: 'Mobile Safari', use: { ...devices['iPhone 12'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
});
```

**Шаг 3:** Создать тесты

```ts
// e2e/auth.spec.ts
import { test, expect } from '@playwright/test';

test('guest can start writing session', async ({ page }) => {
  await page.goto('/');
  await page.click('[data-testid="start-writing"]');
  await page.fill('[data-testid="editor"]', 'Hello world');
  await page.click('[data-testid="finish-session"]');
  await page.click('[data-testid="save-session"]');
  await expect(page.locator('[data-testid="archive"]')).toContainText('Hello world');
});

// e2e/encryption.spec.ts
import { test, expect } from '@playwright/test';

test('encryption setup and unlock', async ({ page }) => {
  await page.goto('/login');
  await page.fill('[data-testid="email"]', 'test@example.com');
  await page.fill('[data-testid="password"]', 'password123');
  await page.click('[data-testid="login"]');
  
  // Setup encryption
  await page.click('[data-testid="setup-encryption"]');
  await page.fill('[data-testid="encryption-password"]', 'secure123');
  await page.click('[data-testid="confirm-encryption"]');
  
  // Logout and login again
  await page.click('[data-testid="logout"]');
  await page.fill('[data-testid="email"]', 'test@example.com');
  await page.fill('[data-testid="password"]', 'password123');
  await page.click('[data-testid="login"]');
  
  // Unlock vault
  await page.fill('[data-testid="unlock-password"]', 'secure123');
  await page.click('[data-testid="unlock"]');
  await expect(page.locator('[data-testid="vault-status"]')).toContainText('Unlocked');
});

// e2e/mobile.spec.ts
import { test, expect } from '@playwright/test';

test('mobile writing session', async ({ page }) => {
  await page.goto('/');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.click('[data-testid="mobile-start"]');
  await page.fill('[data-testid="mobile-editor"]', 'Mobile test');
  await page.click('[data-testid="mobile-finish"]');
  await expect(page.locator('[data-testid="mobile-stats"]')).toBeVisible();
});
```

**Шаг 4:** Добавить `data-testid` в компоненты (минимально)

```tsx
// features/writing/components/SessionEditor.tsx
<textarea data-testid="editor" ... />
<button data-testid="finish-session" ... />
```

**Шаг 5:** Добавить в CI

```yaml
# .github/workflows/ci.yml
- name: E2E Tests
  run: npx playwright test
```

#### Критерий готовности

```bash
npx playwright test  # все тесты проходят
npx playwright test --project="Mobile Chrome"  # mobile тоже проходят
```

---

### T10-03 — RUM / LCP Monitoring (Web Vitals)

**Приоритет:** 🟢 P3  
**Оценка:** 2–4 часа  
**Блок:** Производительность (нет runtime monitoring)

#### Проблема

Нет мониторинга реальных Core Web Vitals:
- LCP (Largest Contentful Paint) — время отрисовки главного контента
- FID (First Input Delay) — задержка первого взаимодействия
- CLS (Cumulative Layout Shift) — сдвиги макета
- TTFB (Time to First Byte) — время до первого байта

#### Решение

**Шаг 1:** Установить `web-vitals`

```bash
npm i web-vitals
```

**Шаг 2:** Добавить RUM в приложение

```ts
// src/core/analytics/webVitals.ts
import { onLCP, onFID, onCLS, onTTFB, onINP } from 'web-vitals';
import { reportError } from '../errors/reportError';

export function initWebVitals() {
  if (import.meta.env.DEV) return;

  const sendToAnalytics = (metric: { name: string; value: number; id: string }) => {
    // Отправляем в PostHog / Sentry / Google Analytics
    if (window.posthog) {
      window.posthog.capture('web_vital', {
        metric_name: metric.name,
        metric_value: metric.value,
        metric_id: metric.id,
      });
    }

    // Логируем медленные метрики
    const thresholds: Record<string, number> = {
      LCP: 2500,
      FID: 100,
      CLS: 0.1,
      TTFB: 600,
      INP: 200,
    };

    if (metric.value > thresholds[metric.name]) {
      reportError(new Error(`Slow ${metric.name}: ${metric.value}`), {
        action: 'web_vital_slow',
        metric: metric.name,
        value: metric.value,
        id: metric.id,
      });
    }
  };

  onLCP(sendToAnalytics);
  onFID(sendToAnalytics);
  onCLS(sendToAnalytics);
  onTTFB(sendToAnalytics);
  onINP(sendToAnalytics);
}
```

**Шаг 3:** Инициализировать в корне приложения

```ts
// src/main.tsx или src/app/App.tsx
import { initWebVitals } from './core/analytics/webVitals';

initWebVitals();
```

**Шаг 4:** Добавить dashboard в PostHog / Sentry

```ts
// PostHog Insights → Add Insight → Web Vitals
// Sentry → Performance → Web Vitals
```

#### Критерий готовности

- В PostHog / Sentry видны метрики LCP, FID, CLS, TTFB, INP
- Алерты на slow метрики (LCP > 2.5s, CLS > 0.1, INP > 200ms)
- 90% сессий имеют LCP < 2.5s

---

### T10-04 — Performance Regression Tests (Bundle Size)

**Приоритет:** 🟢 P3  
**Оценка:** 2–3 часа  
**Блок:** CI/CD (bundle budget есть, но нет сравнения между PR)

#### Проблема

Текущий bundle budget:
- `index-*.js` ≤ 600 KB (fail)
- `vendor-*.js` ≤ 500 KB (warning)
- `*.css` ≤ 150 KB (fail)

Но нет **сравнения с base branch** — не видно, на сколько вырос бандл в PR.

#### Решение

**Шаг 1:** Создать скрипт для сравнения bundle size

```ts
// scripts/bundle-compare.ts
import fs from 'fs';
import path from 'path';

interface ChunkReport {
  name: string;
  size: number;
  gzip: number;
}

function getChunks(dir: string): ChunkReport[] {
  const files = fs.readdirSync(dir);
  return files
    .filter(f => f.endsWith('.js') || f.endsWith('.css'))
    .map(f => {
      const size = fs.statSync(path.join(dir, f)).size;
      return { name: f, size, gzip: 0 };
    });
}

function compareChunks(base: ChunkReport[], current: ChunkReport[]) {
  const changes: { name: string; diff: number; percent: string }[] = [];

  for (const cur of current) {
    const baseChunk = base.find(b => b.name === cur.name);
    if (baseChunk) {
      const diff = cur.size - baseChunk.size;
      const percent = ((diff / baseChunk.size) * 100).toFixed(1);
      if (Math.abs(diff) > 1024) { // > 1 KB
        changes.push({ name: cur.name, diff, percent: `${diff > 0 ? '+' : ''}${percent}%` });
      }
    }
  }

  return changes;
}

// CLI
const [,, baseDir, currentDir] = process.argv;
const base = getChunks(baseDir);
const current = getChunks(currentDir);
const changes = compareChunks(base, current);

if (changes.length > 0) {
  console.log('Bundle size changes:');
  for (const { name, diff, percent } of changes) {
    const sign = diff > 0 ? '📈' : '📉';
    console.log(`  ${sign} ${name}: ${(diff / 1024).toFixed(1)} KB (${percent})`);
  }
}

// Exit with error if index chunk grew > 5%
const indexChange = changes.find(c => c.name.startsWith('index-'));
if (indexChange && parseFloat(indexChange.percent) > 5) {
  console.error('❌ index chunk grew > 5%');
  process.exit(1);
}
```

**Шаг 2:** Добавить в CI

```yaml
# .github/workflows/ci.yml
- name: Compare bundle size
  run: |
    # Сохраняем base branch bundle
    git checkout main
    npm run build
    mkdir -p /tmp/base-dist
    cp -r dist/assets/* /tmp/base-dist/
    
    # Собираем текущий PR
    git checkout -
    npm run build
    
    # Сравниваем
    npx tsx scripts/bundle-compare.ts /tmp/base-dist dist/assets
```

**Шаг 3:** Добавить PR comment

```yaml
# .github/workflows/ci.yml
- name: Post bundle size report
  uses: actions/github-script@v6
  with:
    script: |
      const fs = require('fs');
      const report = fs.readFileSync('bundle-report.txt', 'utf8');
      github.rest.issues.createComment({
        issue_number: context.issue.number,
        owner: context.repo.owner,
        repo: context.repo.repo,
        body: `### Bundle Size Report\n\n${report}`
      });
```

#### Критерий готовности

- PR содержит комментарий с bundle size report
- CI фейлится если index chunk вырос > 5%
- CI фейлится если vendor chunk вырос > 10%

---

## 📋 План достижения 9/10 и 10/10

### Неделя 1: 9/10

| День | Задача | Оценка |
|------|--------|--------|
| 1 | T9-01: npm audit fix (корень) | 1 час |
| 2 | T9-01: npm audit fix (functions) | 1 час |
| 3 | T9-01: overrides + verify | 1 час |
| 4 | T9-02: Фаза 1–2 (safe-area, grid, border) | 2 часа |
| 5 | T9-02: Фаза 3–4 (layout, flex, font) | 2 часа |
| 6 | T9-02: Фаза 5 (динамические цвета) | 2 часа |
| 7 | T9-02: Фаза 6–7 (animation, progress) | 2 часа |

**Итого:** 9–11 часов, 9/10 достигнуто.

### Неделя 2–3: 10/10

| День | Задача | Оценка |
|------|--------|--------|
| 8 | T10-01: Coverage analysis + weak spots | 2 часа |
| 9 | T10-01: Дописать тесты (AI, archive) | 2 часа |
| 10 | T10-01: Дописать тесты (settings, auth) | 2 часа |
| 11 | T10-01: Дописать тесты (core services) | 2 часа |
| 12 | T10-01: Поднять thresholds + verify | 1 час |
| 13 | T10-02: Playwright setup + config | 2 часа |
| 14 | T10-02: E2E auth flow | 2 часа |
| 15 | T10-02: E2E writing session | 2 часа |
| 16 | T10-02: E2E encryption + mobile | 2 часа |
| 17 | T10-02: CI integration | 2 часа |
| 18 | T10-03: web-vitals setup + RUM | 2 часа |
| 19 | T10-03: PostHog / Sentry dashboard | 2 часа |
| 20 | T10-04: Bundle compare script | 2 часа |
| 21 | T10-04: CI integration + PR comment | 2 часа |

**Итого:** 20–25 часов, 10/10 достигнуто.

---

## 🎯 Definition of Done

### Для 9/10:

```bash
# Безопасность
npm audit --audit-level=moderate  # 0 vulnerabilities

# Дизайн
grep -rn 'style={{' src/ --include='*.tsx' | grep -v test | grep -v node_modules | wc -l
# → < 50

# Green gate
npx eslint . --ext .ts,.tsx --max-warnings 0  # 0
npx tsc --noEmit  # 0
npx vitest run  # 421 passed
npm run build  # OK
```

### Для 10/10:

```bash
# Тесты
npm run test:coverage
# statements: ≥ 80%
# branches: ≥ 80%
# functions: ≥ 80%
# lines: ≥ 80%

# E2E
npx playwright test  # все проходят

# RUM
# LCP < 2.5s для 90% сессий
# CLS < 0.1 для 90% сессий

# Bundle
# PR comment с bundle size report
# index chunk не вырос > 5%

# Green gate
npx eslint . --ext .ts,.tsx --max-warnings 0  # 0
npx tsc --noEmit  # 0
npx vitest run  # 421 passed
npx playwright test  # passed
npm run build  # OK
```

---

## 📊 Планируемая оценка

| Аспект | Текущее | После 9/10 | После 10/10 |
|--------|---------|-----------|-------------|
| Код-стайл и TypeScript | 9/10 | 9/10 | 9/10 |
| Архитектура и Core | 8/10 | 8/10 | 8/10 |
| State Management | 7/10 | 7/10 | 7/10 |
| Дизайн-система | 8/10 | **9/10** | 9/10 |
| Тесты | 8/10 | 8/10 | **9/10** |
| CI/CD и Инфраструктура | 8/10 | 8/10 | **9/10** |
| Производительность | 7/10 | 7/10 | **9/10** |
| Безопасность | 7/10 | **9/10** | 9/10 |
| **Средний** | **8.0** | **8.625** | **8.875** |

> **Для 9/10:** нужно 9/10 по безопасности (0 vulnerabilities) и 9/10 по дизайн-системе (< 50 inline styles)
> **Для 10/10:** нужно 9/10 по тестам (coverage 80%+), 9/10 по CI/CD (E2E, bundle regression), 9/10 по производительности (RUM, LCP monitoring)
> 
> **Итоговая оценка:**
> - 9/10: **8.625** → округляем до **9/10** ✅
> - 10/10: **8.875** → округляем до **9/10** (для 10/10 нужно минимум 9/10 по всем аспектам, а это потребует ещё State Management → 9/10 и Architecture → 9/10)
> 
> **Реалистичная цель:** 9/10 за 2 недели, 9.5/10 за 3 недели. 10/10 потребует значительно больше усилий (State Management рефактор, Architecture доработки).