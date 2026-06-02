# Remain-Audit Tickets — justwriting (после v0.7.11)

Детальные тикеты по остаточному техдолгу (из `remain_audit.md`, верифицировано по коду). Для opencode.

> ## ГЛОБАЛЬНЫЕ ПРАВИЛА (для всех тикетов)
> 1. **Поведение не меняется.** Это рефакторинг/гигиена. Публичные API, onClick-обработчики, тексты, поведение — сохранять 1:1.
> 2. **Один тикет = один PR.** Не смешивать. Внутри — логические коммиты по фазам.
> 3. **После каждого тикета весь гейт зелёный:**
>    `npx eslint . --ext .ts,.tsx --max-warnings 0 --ignore-pattern "public/**"` · `npx tsc --noEmit` · `npx vitest run` (421+) · `npm --prefix functions run build` · `npm run build`.
> 4. **Запрещено глушить ошибки:** никаких `as any`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable` ради «зелёного». Чинить по сути.
> 5. **Не трогать ранее ОТКЛОНЁННОЕ:** `firebase-admin` остаётся в `dependencies`; `@tanstack/react-query` не вводить.
> 6. **СМОУК обязателен в тикетах, помеченных 🔬** (миграция UI). Гейт НЕ ловит мис-врайринг onClick/className — недавно так был сломан save-кнопка. Проверять руками затронутые primary-действия.
> 7. Если тикет всплывает > заявленной оценки или ломает гейт необратимо — остановиться, описать, не «протаскивать».

**Порядок:** T1 (npm audit) → T2 (bundle gate) → T3 (casts) → T4 (buttons 🔬) → T5 (boundary) → T6 (inline styles) → T7 (noUncheckedIndexedAccess) → T8 (any — verify-only).

---

## T1 — npm-уязвимости (П0-01) 🔴
**Оценка:** 2–4 ч. **Файлы:** `package.json`, `package-lock.json`, `functions/package*.json`.
**Факт (verified):** root — **23** (16 moderate, 7 high); `functions/` — **9 moderate**. Источники транзитивные: `uuid`←`@google-cloud/firestore`/`teeny-request`, `firebase-admin`, `postcss`/`rollup` (devDeps, в бандл не идут).

### ⚠️ Критично
**НЕ запускать `npm audit fix --force` вслепую.** `--force` тянет major-апгрейды и **способен сломать `firebase-admin`** (от него зависит serverless `/api/chat`) или сборку. Большинство уязвимостей — build-time/transitive, реальная эксплуатируемость в клиенте низкая.

### Шаги
1. `npm audit fix` (БЕЗ `--force`) в root → прогнать гейт (`npm run build`, `npx vitest run`).
2. То же в `functions/`: `npm --prefix functions audit fix` → `npm --prefix functions run build`.
3. Для оставшихся (не фиксятся без major): по каждому пакету решить точечно через `overrides` в `package.json` (например, форснуть безопасный minor у транзитивного `uuid`/`postcss`), **с прогоном гейта после каждого**. НЕ делать `--force` целиком.
4. Если уязвимость только в **devDep** (postcss/rollup) и в прод-бандл не попадает — допустимо оставить с комментарием в тикете-отчёте (риск минимальный), не ломая мажоры.
5. `npm run build` — сверить, что размеры чанков не изменились скачком.

### Acceptance (реалистичный)
- `npm audit --audit-level=high` → **0 high** (moderate допустимо оставить, если фикс только через breaking major у devDep — задокументировать какие и почему).
- Идеал: `npm audit --audit-level=moderate` → 0, но **не ценой** breaking-апгрейда `firebase-admin`/build.
- Полный гейт зелёный, `/api/chat` не затронут (если менялся `firebase-admin` — **обязательно** проверить сборку functions + смоук чата по возможности).

---

## T2 — Bundle-size budget в CI (П3-02) 🟢
**Оценка:** 1–2 ч. **Файлы:** `.github/workflows/ci.yml`.
**Факт:** `chunkSizeWarningLimit: 300` только warning, гейта по размеру нет.

### Шаги
1. В CI после `npm run build` добавить шаг-бюджет (fail на превышении для главного чанка, warning для вендоров):
   ```yaml
   - name: Bundle size budget
     run: |
       MAX_INDEX=600000   # index-*.js fail-порог (байты)
       MAX_VENDOR=500000  # vendor-*.js warn-порог
       fail=0
       for f in dist/assets/index-*.js; do
         sz=$(stat -c%s "$f" 2>/dev/null || stat -f%z "$f")
         echo "index: $f = $sz"
         [ "$sz" -gt "$MAX_INDEX" ] && { echo "::error::$f > $MAX_INDEX"; fail=1; }
       done
       for f in dist/assets/vendor-*.js; do
         sz=$(stat -c%s "$f" 2>/dev/null || stat -f%z "$f")
         [ "$sz" -gt "$MAX_VENDOR" ] && echo "::warning::$f > $MAX_VENDOR ($sz)"
       done
       exit $fail
   ```
2. Подобрать пороги под текущие реальные размеры (index ~550 КБ → порог 600 КБ с запасом; firestore-вендор ~448 КБ — под warn-порог 500 КБ).

### Acceptance
- CI фейлится при `index-*.js` > порога; warning при вендоре > порога.
- Текущая сборка проходит (пороги выставлены с запасом над сегодняшними размерами).
- `npm run build` зелёный.

---

## T3 — Убрать остаточные unsafe-касты (П1-02) 🟠
**Оценка:** 4–6 ч. **Факт (verified):** ~64 (9 `as unknown as` + 55 `as string|number|boolean`).
**Топ-файлы:** `ai/components/DatabaseExplorer.tsx` (11), `archive/services/archiveCrud.ts` (9), `core/services/CloudSyncService.ts` (8), `ai/services/AISummaryService.ts` (7), `writing/store/storeActions.ts` (4), `core/services/EncryptionMetaService.ts` (4), `settings/hooks/useSyncDiagnostics.tsx` (3), `archive/hooks/useArchiveSessions.ts` (3), `core/analytics/analytics.ts` (3), + хвост по 1–2.

### Паттерны фиксов
- **Firestore-данные** → существующие мапперы (`documentFromDb`/`versionFromDb` в `core/services/mappers.ts`). При нехватке — добавить `profileFromDb`/`summaryFromDb` по тому же образцу (явный маппинг, Zod-схема как источник типа).
- **DOM** (`e.target as HTMLInputElement`) → type-guard: `if (!(e.target instanceof HTMLInputElement)) return;`.
- **JSON/localStorage** (`JSON.parse(x) as T`) → Zod `safeParse` (схемы рядом, как `GuestDraftSchema`); при провале — `null`/дефолт.
- **Zustand** → убрать каст, стор уже типизирован (`setState(partial)` принимает `Partial<State>`).
- **Прагматичные/неустранимые** (узкие DOM-касты, сторонние API без типов) — **оставить** с коротким комментарием почему; НЕ заменять на `any`.

### Шаги (батчами, гейт между)
1. core-сервисы (`CloudSyncService`, `EncryptionMetaService`, `analytics`, `localDb`, `dateUtils`, `LegacyKeyMigration`, `encryptMigration`).
2. archive (`archiveCrud`, `useArchiveSessions`).
3. ai (`DatabaseExplorer`, `AISummaryService`, `AIProfileService`, `useAIPageData`).
4. writing/settings/profile (`storeActions`, `WritingDraftService`, `UnifiedSessionLoader`, `useSyncDiagnostics`, `SessionChart`, `useProfileStats`, `Achievements`).

### Acceptance (реалистичный)
- `as unknown as` → **0** в `src/` (вне тестов).
- `as string|number|boolean` сокращены к минимуму; **каждый оставшийся** имеет однострочный комментарий-обоснование (прагматичный/неустранимый).
- 0 новых `any`/`@ts-ignore`. `tsc` 0, тесты 421.

---

## T4 — Мигрировать остаточные raw `<button>` (П1-01) 🟠🔬
**Оценка:** 3–5 ч. **Факт (verified):** **129** вхождений в ~30 файлах.
**Топ:** `settings/SyncDiagnostics.tsx` (18), `ai/DiagnosticsPage.tsx` (8), `settings/AccountVaultSection.tsx` (6), `settings/AccountTab.tsx` (6), `archive/MobileNoteActionsSheet.tsx` (6), `writing/FinishModalTags.tsx` (4), `settings/AppTab.tsx` (4), `navigation/Sidebar.tsx` (4), `archive/MobileArchiveSidebarSheet.tsx` (4), `archive/GridNoteCard.tsx` (4), `archive/ArchiveHeader.tsx` (4), `ai/DatabaseExplorer.tsx` (4), `ai/AIChatPresentational.tsx` (4), далее по 1–3.

### ⚠️⚠️ ОСОБЫЙ РИСК
Это **ровно тот тип работы, что сломал кнопку «Сохранить»** в finish-модале (onClick перевязали на чужой обработчик + чужой className). Гейт это НЕ ловит.

### Жёсткие правила миграции (на КАЖДУЮ кнопку)
1. `onClick` переносить **дословно** — не путать с соседними кнопками. После замены сверить, что обработчик тот же.
2. `className` сохранять (через `className=` проп `Button`/`IconButton`) — не подменять стилями соседа.
3. Иконочные кнопки (только svg, без текста) → `<IconButton aria-label="...">`; текстовые → `<Button variant=… size=…>`. Подобрать variant под текущий вид (primary/secondary/ghost/danger), не менять визуал.
4. Сохранить `disabled`, `title`/`aria-label`, `type` (если был submit — оставить submit; иначе `Button`/`IconButton` сами дают `type="button"`).

### 🔬 Обязательный смоук после миграции (руками или через preview-инструмент)
Прокликать primary-действия каждой затронутой области и убедиться, что они работают:
- **SyncDiagnostics / DiagnosticsPage** (18+8 — самые крупные): кнопки синхронизации/диагностики, reset-лимита, генерация портрета.
- **Settings AccountTab/AccountVaultSection**: смена пароля, экспорт, lock/unlock сейфа, опасные действия (удаление аккаунта — НЕ нажимать до конца, проверить открытие диалога).
- **Archive** (MobileNoteActionsSheet, GridNoteCard, ArchiveHeader): удалить/редактировать/экспорт заметки, фильтры.
- **AI** (DatabaseExplorer, AIChatPresentational, DiagnosticsPage): инлайн-действия.
- **FinishModalTags**, **MobileWriteToolbar**: добавление/удаление тегов, тулбар письма.
- 0 ошибок в консоли.

### Acceptance (реалистичный)
- `grep -rn "<button" src --include="*.tsx" | grep -v test` → остаются **только** определения самих примитивов (`shared/components/Button.tsx`, `IconButton.tsx`, `Toggle.tsx`, `EmptyState.tsx` — они ЕСТЬ `<button>` внутри) и обоснованные edge-cases с комментарием. Цель ≈ 0 прикладных.
- Все мигрированные кнопки: корректный onClick (сверено), `type` явный, `aria-label` у иконочных, focus-visible (из примитива).
- Гейт зелёный + **смоук пройден** (отчитаться, что именно прокликано).

---

## T5 — Граница слоёв `core → shared` (П2-02) 🟡
**Оценка:** 3–4 ч. **Факт (verified):** **12** импортов `shared → core`:
- `useLanguage` из `core/i18n`: `GoalToast`, `CancelConfirmModal`, `LoadingSpinner`, `LoadingSkeleton`, `StreakDots`, `ConfirmModal`, `useServiceAction`.
- `reportError` из `core/errors/reportError`: `useServiceAction`, `useLocalStorage`, `ErrorBoundary`.
- `translations` из `core/i18n`: `ErrorBoundary`.
- `getOrCreateGuestId` из `core/storage/localDb`: `useUserId`.

### Подход (выбрать ОДИН, согласовать)
`i18n` и `error-reporting` — сквозные concern'ы. Рекомендуемый вариант — **перенести фундамент в `shared`** (а `core` пусть импортит из `shared`):
- `src/core/i18n/` → `src/shared/i18n/`
- `src/core/errors/reportError.ts` (+ `logger`) → `src/shared/errors/`
- `getOrCreateGuestId` (точечно) → `src/shared/storage/` или вынести guest-id helper в `shared/utils`.
Обновить ВСЕ импорты по проекту (их много — это движение графа). Барелы/реэкспорты допустимы для совместимости.

> ⚠️ Это крупное движение импортов. Если риск/объём велик — сделать **только перенос `reportError`+`logger`** (он мельче) и `getOrCreateGuestId`, а `i18n` оставить с пометкой «принятая сквозная зависимость» (тогда обновить ESLint-boundary-исключение, чтобы не светилось). Согласовать перед началом.

### Acceptance
- `grep -rn "from '../../core/" src/shared --include="*.ts" --include="*.tsx" | grep -v test` → **0** (или ровно задокументированные исключения, если выбран частичный вариант).
- Гейт зелёный, поведение i18n/ошибок не изменилось (смоук: переключение языка, тост ошибки).

---

## T6 — Inline styles → utility-классы (П2-01) 🟡
**Оценка:** 6–8 ч. **Факт (verified):** **279** `style={{`.
**Важно:** бóльшая часть **легитимно динамическая** и ДОЛЖНА остаться inline (цвета меток `label.color`, ширина прогресс-баров `width: ${p}%`, `animationDelay`, safe-area с `env()`). Цель — вынести **только статические** layout/typography.

### Шаги (фазами, только статика)
1. **Safe-area**: добавить CSS-утилиты в `index.css` (`.pb-safe`, `.pb-safe-nav`), заменить статические `paddingBottom: env(safe-area-inset-bottom...)`.
2. **Static layout** (`display:flex; gap:6`, `flexDirection:column`, `flex:1`) → `className="flex gap-1.5 flex-col flex-1"`.
3. **Static grid/border** (`gridTemplateColumns:'72px 1fr auto'`, `borderBottom`) → `grid-cols-[72px_1fr_auto]`, `border-b border-border-subtle`.
4. **Static font/text** (`fontSize:11`, `fontFamily`, `letterSpacing`) → `text-[11px] font-mono tracking-[...]`.
5. **Dynamic** (label color, progress width, anim-delay, z-index+config) — **ОСТАВИТЬ inline**, по возможности вынеся статическую часть в className (`className="z-0" style={{background: config.base}}`).

### Acceptance (реалистичный)
- `grep -rn "style={{" src --include="*.tsx" | grep -v test` → **< 120** (только обоснованно динамические).
- Статические layout/typography переведены на utility-классы.
- **Визуально без регресса** (смоук: mobile safe-area, цвета меток, прогресс-бары, анимации) — обязательно.
- Гейт зелёный.

---

## T7 — `noUncheckedIndexedAccess` (П3-01) 🟢 ⚠️объёмный
**Оценка:** 8–12 ч. **Факт (verified):** включение даёт **182 ошибки** (TS2532/TS18048 — `arr[i]`/`obj[key]` возможно `undefined`), ~49 из них в тестах.

### ⚠️ Процесс
Флаг tsconfig — «всё-или-ничего»: после включения `tsc` красный на все 182 до полной починки. Это **один PR**, гейт зелёный только в конце; внутри — логические коммиты по областям. Мониторинг: `npx tsc --noEmit 2>&1 | grep -c "error TS"` (счётчик к 0).

### Паттерны (НЕ глушить)
- `const x = arr[i]; if (x == null) return; x.foo` (guard).
- `arr.at(0)` + null-check.
- Деструктуризация с дефолтом: `const [a = fallback] = arr;`.
- Для `Record`-доступа — guard или `?.`.
- Запрещено `arr[i]!` массово ради тишины — только там, где доказуемо непусто (с комментарием).

### Шаги
1. `"noUncheckedIndexedAccess": true` в `tsconfig.json`.
2. Чинить по областям: core-сервисы → writing → archive → ai/settings → shared → тесты.

### Acceptance
- Флаг включён, `tsc --noEmit` → **0**.
- 0 новых `any`/`@ts-ignore`; массовых `!` нет (точечные — с обоснованием).
- Тесты 421, eslint 0.

---

## T8 — «31 any» (П1-03) ✅ VERIFY-ONLY — фикс НЕ нужен
**Статус:** ❌ **ложное срабатывание исходного аудита.** Реальных `any`-типов в проде **0** (verified: `grep -rEn ':\s*any\b|<any>|any\[\]|as any' src | grep -v test` → 0; `no-explicit-any: error` их не пропустит). «31» — это подстрока «any» в словах (*many/company/Anyway*). Критерий исходника «grep any → 0» **недостижим** (нельзя удалить слово «many»).

### Действие
**Ничего не менять.** Только подтвердить отчётом:
- `grep -rEn ':\s*any\b|<any>|\bany\[\]|\bas any\b' src --include="*.ts" --include="*.tsx" | grep -v test | wc -l` → **0**.
- `grep -rn "no-explicit-any" src | grep -v test | wc -l` → **0** (нет eslint-disable).
Если оба 0 — тикет закрыт без изменений кода. **НЕ** добавлять `any` и **НЕ** трогать строки со словами-подстроками.

---

## Сводка приоритетов

| Тикет | Приоритет | Оценка | Риск | Примечание |
|---|---|---|---|---|
| T1 npm audit | 🔴 | 2–4 ч | средний | без `--force`; беречь firebase-admin/build |
| T2 bundle gate | 🟢 | 1–2 ч | низкий | дёшево, делать рано |
| T3 casts | 🟠 | 4–6 ч | низкий | мапперы/guards/Zod |
| T4 buttons | 🟠 | 3–5 ч | **высокий** 🔬 | обязательный смоук! |
| T5 boundary | 🟡 | 3–4 ч | средний | согласовать объём переноса |
| T6 inline styles | 🟡 | 6–8 ч | средний | только статика, смоук визуала |
| T7 noUncheckedIndexedAccess | 🟢 | 8–12 ч | объём | один PR, по одной области |
| T8 any | — | 0 | — | verify-only, фикса нет |

## Definition of Done (каждый тикет)
```
npx eslint . --ext .ts,.tsx --max-warnings 0 --ignore-pattern "public/**"
npx tsc --noEmit
npx vitest run
npm --prefix functions run build
npm run build
```
+ для T1: `npm audit --audit-level=high` (0 high) · для T4/T6: пройденный смоук.
