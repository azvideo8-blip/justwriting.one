# AG-B1…B8 — отчёт о реализации

**Дата:** 2026-08-02
**Ветка:** `main` (ahead 9 commits, not pushed)
**Версия:** 0.7.68

---

## B1 — CI после сравнения бандлов тестирует `main`, а не PR

**Что изменено:**
- Удалён шаг `Bundle size comparison` из job `build` в `.github/workflows/ci.yml`.
- Добавлен отдельный job `bundle-size` с `git worktree` для сборки базы в `/tmp/base`.
- YAML парсится: `npx js-yaml .github/workflows/ci.yml > /dev/null` — exit 0.
- `grep -n "git checkout" .github/workflows/ci.yml` — пусто (нет checkout внутри build).

**Шаги job `build` в новом порядке:**
1. Checkout
2. Setup Node
3. Install dependencies
4. Typecheck
5. Lint
6. Test
7. Build
8. Bundle size budget
9. Install Playwright
10. E2E Tests
11. Functions build & test
12. Run rules and emulator tests
13. Audit functions dependencies

**Тест добавлен:** нет (локально CI не воспроизвести).

**Проверка на невакуумность:** не применимо (CI-шаг).

---

## B2 — пороги покрытия не включены, а включать их как есть нельзя

**Что изменено:**
- `package.json`: `"test:ci": "vitest run --coverage"`.
- `vite.config.ts`: пороги заменены на измеренные.

**Тест добавлен:** нет (пороги — конфигурация, не код).

**Проверка:**
```
npx vitest run --coverage
→ exit 1
→ 1 failed | 928 passed (123 files, 929 tests)
→ FAIL src/features/ai/__tests__/peopleResolution.test.ts
  > filters out ignored notes from search results
  > Error: Test timed out in 5000ms (фактически 5064ms)
```

Гейт B2 в текущем виде делает CI периодически красным — см. раздел «Находки гейта B2» ниже.

**Фактические цифры покрытия по каталогам** (сравнение с порогами):

| Каталог | Statements | Branches | Functions | Lines |
|---------|-----------|----------|-----------|-------|
| `src/core/storage/**` (порог) | 85 | 50 | 60 | 88 |
| `src/core/storage/**` (факт) | **88.23** | **52.08** | **62.50** | **91.40** |
| `src/core/crypto/**` (порог) | 70 | 58 | 65 | 74 |
| `src/core/crypto/**` (факт) | **72.32** | **60.84** | **67.50** | **76.84** |
| `src/core/services/**` (порог) | 63 | 54 | 60 | 66 |
| `src/core/services/**` (факт) | **67.54** | **58.22** | **64.35** | **70.47** |

Все три каталога проходят пороги с запасом 2–5 пунктов.

**Глобальное покрытие:**
- Statements: 30.1% (порог 30)
- Branches: 20.64% (порог 20)
- Functions: 22.68% (порог 22)
- Lines: 31.16% (порог 31)

**Известный пробел:** `src/features/auth/**` не включён в каталоговые пороги — там сейчас 39.69/31.03/42.11/39.34, и порог на этом уровне ничего не защищает.

---

## B3 — код функций не линтуется вообще

**Что изменено:**
- Новый `functions/eslint.config.js` с `@eslint/js` + `typescript-eslint`.
- `functions/package.json`: добавлен `"lint": "eslint . --max-warnings 0"`, devDependencies `@eslint/js` и `typescript-eslint` теми же версиями, что в корне.
- `.github/workflows/ci.yml`: шаг `Functions build & test` добавляет `npm run lint`.

**Механические исправления:**
- `functions/src/admin/setUserRole.ts`: удалён неиспользуемый импорт.
- `functions/src/ai/chatWithAI.ts`: удалена неиспользуемая переменная `_dropped` (деструктуризация).
- `functions/src/shared/aiUtils.ts`: удалены неиспользуемые переменные.

**Deliberately not fixed — Functions lint findings:**

В `functions/src` ровно **один** `eslint-disable-next-line`:
- `functions/src/shared/aiUtils.ts:144` — `// eslint-disable-next-line no-irregular-whitespace`

Это не подавление `no-unused-vars`. Правило `no-unused-vars` решается на уровне конфига:
```js
'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
```
Это означает, что переменные, начинающиеся с `_`, игнорируются линтером глобально — отдельных `eslint-disable` в файлах для этого не нужно. Деструктуризация `const _dropped = ...` в `chatWithAI.ts` была удалена, потому что переменная не использовалась и не начиналась с `_` в момент проверки (после удаления `_` префикса в одном из коммитов).

**Проверка:**
```
cd functions && npm run lint → exit 0
npm run lint (из корня) → exit 0
```

---

## B4 — аудит зависимостей даёт ложный зелёный, когда команда падает

**Что изменено:**
- `scripts/prod-audit.mjs`: добавлена проверка пустого stdout и try/catch на JSON.parse.
- `.github/workflows/ci.yml`: добавлен шаг `Audit functions dependencies`.

**Тест добавлен:** нет (скрипт — проверка в CI).

**Проверка:**
```
node scripts/prod-audit.mjs → exit 0 (с текущей базой)
node scripts/prod-audit.mjs (с raw = '') → exit 1, сообщение «не дал вывода»
```

### Находки: `cd functions && npm audit --omit=dev --audit-level=high`

**5 уязвимостей (2 low, 1 moderate, 1 high, 1 critical):**

| # | Пакет | Установлен | Severity | Advisory | Цепочка зависимостей |
|---|-------|-----------|----------|----------|---------------------|
| 1 | **body-parser** | <1.20.6 | low | [GHSA-v422-hmwv-36x6](https://github.com/advisories/GHSA-v422-hmwv-36x6) — DoS через невалидный limit | `firebase-functions@7.2.5 → express@4.22.2 → body-parser@1.20.5` |
| 2 | **dompurify** | <=3.4.11 | low | [GHSA-c2j3-45gr-mqc4](https://github.com/advisories/GHSA-c2j3-45gr-mqc4) — CUSTOM_ELEMENT_HANDLING обходит afterSanitizeElements | `isomorphic-dompurify@3.14.0 → dompurify@3.4.11` |
| 3 | **protobufjs** | 7.5.0–7.6.4 | moderate | [GHSA-j3f2-48v5-ccww](https://github.com/advisories/GHSA-j3f2-48v5-ccww) — DoS через infinite loop в .proto option parsing | `@firebase/rules-unit-testing@5.0.1 → firebase@12.15.0 → @firebase/firestore@4.16.0 → @grpc/proto-loader@0.7.15 → protobufjs@7.6.4` |
| 4 | **undici** | 7.0.0–7.27.2 | high | 7 advisory: TLS bypass (GHSA-vmh5-mc38-953g), HTTP header injection (GHSA-p88m-4jfj-68fv), WebSocket DoS (GHSA-vxpw-j846-p89q), cross-origin routing (GHSA-hm92-r4w5-c3mj), response queue poisoning (GHSA-35p6-xmwp-9g52), SameSite downgrade (GHSA-g8m3-5g58-fq7m), cache info disclosure (GHSA-pr7r-676h-xcf6) | `isomorphic-dompurify@3.14.0 → jsdom@29.1.1 → undici@7.25.0` |
| 5 | **websocket-driver** | <=0.7.4 | critical | [GHSA-mp7j-qc5w-4988](https://github.com/advisories/GHSA-mp7j-qc5w-4988) — resource limit bypass через compression; [GHSA-xv26-6w52-cph6](https://github.com/advisories/GHSA-xv26-6w52-cph6) — message corruption через protocol length headers | `@firebase/rules-unit-testing@5.0.1 → firebase@12.15.0 → @firebase/database@1.1.3 → faye-websocket@0.11.4 → websocket-driver@0.7.4` |

**Ни одна из уязвимостей не является прямой зависимостью.** Все приходят через транзитивные цепочки Firebase SDK и isomorphic-dompurify/jsdom. Исключений не добавлено, `npm audit fix` не запускался, версии зависимостей не менялись.

---

## B5 — два теста не проверяют ничего

**Что изменено:**
- `src/core/services/__tests__/SyncService.integration.test.ts`: оба теста переписаны.
  - Первый: настоящая одновременность через `vi.spyOn` + gate.
  - Второй: проверяет, что дневная задача НЕ удаляется.

**Проверка на невакуумность:**
- Убрал `if (_syncInProgress.get(userId)) return;` в `SyncService.syncPending` → тест «syncPending skips a second run…» упал на `expect(started).toBe(1)` (получил 2). Вернул строку руками.

**Проверка:**
```
npx vitest run src/core/services/__tests__/SyncService.integration.test.ts → exit 0 (7/7)
```

---

## B6 — сравнение бандлов сопоставляет имена с хэшами, поэтому гейт мёртв

**Что изменено:**
- `scripts/bundle-compare.ts`: добавлена функция `stripHash`, сопоставление по имени без хэша.
- `scripts/__tests__/bundleCompare.test.ts`: 3 теста для `stripHash`.

**Осознанное отклонение от тикета:** тикет запрещал «скрипт под тестируемость не переписывай», но добавление `export` на `stripHash` было вынуждено: без экспорта тест не может импортировать функцию. Более существенное отклонение — обёртка CLI в `if (process.argv[1] === fileURLToPath(import.meta.url))`. Без неё `import { stripHash } from '../bundle-compare'` в тесте запускает CLI (скрипт не имеет guard), и тест падает с `exit 1` из-за отсутствия аргументов. Обёртка не меняет поведение CLI: `npx tsx scripts/bundle-compare.ts` без аргументов по-прежнему печатает Usage и выходит с кодом 1. Причина отклонения: тикет предполагал, что `export` не требует изменений структуры скрипта, но `import` в тесте без guard'а запускает побочный код.

**Тесты добавлены:** `scripts/__tests__/bundleCompare.test.ts` (3 теста).

**Проверка на невакуумность:**
- Убрал `stripHash` из `compareChunks` → тест «matches the same chunk across two builds» упал (сравнивал полные имена). Вернул правку руками.

**Проверка:**
```
npx vitest run scripts/__tests__/bundleCompare.test.ts → exit 0 (3/3)
```

---

## B7 — предупреждения не видны в проде

**Что изменено:**
- `src/shared/errors/logger.ts`: условие `if (level === 'error')` заменено на `if (level === 'error' || level === 'warn')` с передачей уровня в `reportError`.
- `src/shared/errors/__tests__/logger.test.ts`: 3 теста.

**Проверка на невакуумность:**
- Вернул `if (level === 'error')` → тест «reports a warning, at warning level» упал (mock не вызван). Плюс «does not report info» упал (info не должен вызывать reportError, но при `if (level === 'error')` это и так не вызывалось — на самом деле упал только первый тест). Вернул правку руками.

**Проверка:**
```
npx vitest run src/shared/errors/__tests__/logger.test.ts → exit 0 (3/3)
```

---

## B8 — флаги не являются аварийными выключателями

**Что изменено:**
- Удалён `src/core/services/featureFlags.ts`.
- `docs/backlog-pre-migration.md`: добавлена запись «Решено (0.7.68)» в пункт B8.

**Проверка:**
```
grep -rn "featureFlags\|ff_ai_enabled\|ff_sync_enabled" src/ e2e/ → пусто
npm run lint && npx tsc --noEmit && npx vitest run → exit 0
```

---

## Находки гейта B2: `peopleResolution.test.ts` таймаут под покрытием

**Файл:** `src/features/ai/__tests__/peopleResolution.test.ts`
**Тест:** `filters out ignored notes from search results` (строка 41)
**Лимит:** 5000ms
**Фактическое время:** 5064ms (первый прогон), 5080ms (второй прогон)

Тест проходит в одиночном запуске (`npx vitest run src/features/ai/__tests__/peopleResolution.test.ts` — exit 0). Падает в полном прогоне с `--coverage`: параллельные воркеры + инструментация покрытия не дают уложиться в 5000ms. Это не разовый флейк — падает стабильно, один и тот же тест, 5050–5080ms при лимите 5000.

**Минимальный вариант решения (не применён):** поднять таймаут именно этому тесту, например `it('...', async () => { ... }, 10_000)`. Файл не входит в список тикета, поэтому тикет запрещает его чинить здесь.

---

## Deliberately not fixed — Functions lint findings

В `functions/src` ровно **один** `eslint-disable-next-line`:
- `functions/src/shared/aiUtils.ts:144` — `// eslint-disable-next-line no-irregular-whitespace`

Правило `no-unused-vars` решается на уровне конфига `functions/eslint.config.js`:
```js
'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
```
`varsIgnorePattern: '^_'` означает, что любая переменная, начинающаяся с `_`, не считается неиспользуемой — это глобальное правило, а не подавление в файле. Деструктуризация `const _dropped = ...` в `chatWithAI.ts` была удалена (переменная не использовалась), поэтому подавление для неё не потребовалось.

---

## Итоговая проверка

```
npx tsc --noEmit → exit 0
npm run lint → exit 0
npx vitest run --coverage → exit 1 (1 failed: peopleResolution.test.ts timeout — см. выше)
npm run build → exit 0
cd functions && npm run lint && npm run build && npm test → exit 0
```

`npx vitest run --coverage` не проходит из-за таймаута `peopleResolution.test.ts` под инструментацией покрытия. Это находка гейта B2, а не сломанный тест — файл не в списке тикета.
