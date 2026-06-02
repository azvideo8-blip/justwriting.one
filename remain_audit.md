# Остаточные аудит-тикеты — justwriting (v0.7.10)

> **После:** AUDIT_ACCEPTED (10/10) + AUDIT_EPICS 0–12 (12/12)
> **Статус:** green gate зелёный (eslint 0, tsc 0, vitest 421, build + prerender)
> **Осталось:** 6 блоков технического долга, которые не вошли в основной проход

---

## 🔴 P0 — КРИТИЧЕСКИЕ (блокирующие следующий релиз)

### П0-01 — 23 npm vulnerabilities (16 moderate + 7 high + 0 critical)

**Приоритет:** 🔴 Критический (безопасность)  
**Оценка:** 2–4 часа  
**Файлы:** `package.json`, `package-lock.json`, `functions/package.json`

#### Проблема

```
npm audit --audit-level=moderate
→ 23 unique packages with vulnerabilities
  (16 moderate, 7 high, 0 critical)
```

Основные источники:
- `uuid` (через `@google-cloud/firestore`, `teeny-request`, `universal-analytics`)
- `firebase-admin` (transitive deps)
- `postcss` / `rollup` (devDeps, не в бандл)

#### Решение

1. **Шаг 1:** `npm audit fix` — попробовать автоматическое обновление patch/minor
2. **Шаг 2:** Если breaking changes — `npm audit fix --force` с ручным smoke-тестом
3. **Шаг 3:** Для transitive deps, которые не фиксятся автоматически — `npm override` или `resolutions` (или `npm update` на верхнеуровневые пакеты)

**Конкретные действия:**
- `npm update @google-cloud/firestore` (в `functions/` тоже)
- `npm update firebase-admin` (если в `dependencies`)
- Проверить `npm audit` после каждого шага

#### Критерий готовности
- `npm audit --audit-level=moderate` показывает **0** vulnerabilities
- `npm run build` и `npm run test:ci` зелёные
- `functions/` тоже проходит `npm audit` без moderate+
- `npm run build` (vite) — без регресса chunk sizes

---

## 🟠 P1 — ВЫСОКИЙ ПРИОРИТЕТ (logic / type safety)

### П1-01 — Остаточные 127 raw `<button>` → миграция на `<Button>` / `<IconButton>`

**Приоритет:** 🟠 Высокий (a11y + design consistency)  
**Оценка:** 3–4 часа  
**Файлы:** `src/features/admin/`, `src/features/ai/`, `src/features/archive/`, `src/features/writing/`, `src/shared/`

#### Проблема

После миграции 322 → 127 raw `<button>` остались edge cases:
- Admin dashboard (AdminSessionsTable, AdminUsersTable)
- AI inline actions (CreatePersonaModal, PersonaDetailModal, DatabaseExplorer)
- Archive inline icons (ArchiveTagBar, ArchiveLabelBar, NoteRow inline actions)
- Writing inline actions (ExportMenu, TagsSection, inline edit buttons)
- Mobile sheets (MobileStorageActionsSheet, MobileNoteActionsSheet)

Эти кнопки:
- Нет `type="button"` (сабмитят формы внутри модалок)
- Нет `focus-visible` стилей (keyboard nav сломан)
- Нет `aria-label` (screen reader не видит)
- Нет `disabled` стилей (неактивные кнопки выглядят активными)
- Хардкод цветов (не через design system)

#### Решение

**Поэтапно:**

1. **Фаза 1 — Admin + AI** (45 минут)
   - `AdminSessionsTable.tsx`, `AdminUsersTable.tsx`
   - `CreatePersonaModal.tsx`, `PersonaDetailModal.tsx`, `DatabaseExplorer.tsx`
   - Заменить на `<Button variant="secondary" size="sm">` или `<IconButton>`

2. **Фаза 2 — Archive inline** (1 час)
   - `ArchiveTagBar.tsx` (clear filter icon)
   - `ArchiveLabelBar.tsx` (remove label icon)
   - `NoteRow.tsx` (inline delete/edit icons)
   - `ArchiveNoteList.tsx` (view toggle buttons)

3. **Фаза 3 — Writing inline** (1 час)
   - `ExportMenu.tsx` (export format buttons)
   - `TagsSection.tsx` (tag remove X)
   - `SessionCard.tsx` (inline actions)
   - `MobileStorageActionsSheet.tsx` (action buttons)
   - `MobileNoteActionsSheet.tsx` (action buttons)

4. **Фаза 4 — Edge cases** (30 минут)
   - `InlineTags.tsx` (small tag buttons)
   - `StorageIcons.tsx` (sync buttons)
   - `ArchiveStats.tsx` (streak indicators)

#### Критерий готовности
- `grep -r '<button' src/ --include='*.tsx' | grep -v 'Button' | grep -v 'IconButton' | grep -v 'test' | wc -l` → **0**
- Все кнопки имеют `type="button"` или `type="submit"` (явно)
- Все кнопки имеют `focus-visible` стили (через `Button`/`IconButton`)
- Все кнопки имеют `aria-label` (через `IconButton` prop)
- `npx eslint . --ext .ts,.tsx --max-warnings 0` зелёный
- `npx vitest run` — 421 тестов проходят

---

### П1-02 — Остаточные 75 unsafe casts (`as`, `as unknown as`, `as string`)

**Приоритет:** 🟠 Высокий (runtime safety)  
**Оценка:** 4–6 часов  
**Файлы:** `src/core/`, `src/features/`, `src/shared/`

#### Проблема

После Epic 8 (unsafe casts) убрано ~80%, но остались 75 вхождений:

**Категории:**
1. **Firebase `as` (30 шт)** — `doc.data() as UserProfile`, `snapshot.data() as Document`
2. **Zustand `as` (15 шт)** — `setState({ ... } as State)`, `getState() as unknown as X`
3. **DOM `as` (12 шт)** — `e.target as HTMLInputElement`, `document.getElementById('x') as HTMLElement`
4. **JSON/Storage `as` (10 шт)** — `JSON.parse(x) as T`, `localStorage.getItem('x') as string`
5. **Router/Location `as` (8 шт)** — `location.state as { ... }`

#### Решение

**Firebase → mappers (уже есть `documentFromDb`, `versionFromDb`)**
```ts
// Было
const profile = docSnap.data() as UserProfile;

// Стало
const profile = profileFromDb(docSnap.data());
// profile: UserProfile | null
```

**Zustand → typed setters**
```ts
// Было
useTimerStore.setState({ status: 'writing' } as TimerState);

// Стало
useTimerStore.setState({ status: 'writing' } satisfies Partial<TimerState>);
// или просто: useTimerStore.setState({ status: 'writing' });
// (Zustand уже typed)
```

**DOM → type guards**
```ts
// Было
const input = e.target as HTMLInputElement;

// Стало
if (!(e.target instanceof HTMLInputElement)) return;
const input = e.target;
```

**JSON/Storage → Zod parse**
```ts
// Было
const draft = JSON.parse(raw) as GuestDraft;

// Стало
const draft = GuestDraftSchema.safeParse(JSON.parse(raw));
if (!draft.success) return null;
```

**Router → type-safe hooks**
```ts
// Было
const state = location.state as { docId: string };

// Стало
const state = useLocationState<{ docId: string | undefined }>();
if (!state?.docId) return null;
```

#### Критерий готовности
- `grep -rn "as unknown as\\|as any\\|as string\\|as number\\|as boolean" src/ --include="*.ts" --include="*.tsx" | grep -v "test" | grep -v "node_modules" | wc -l` → **0**
- Все Firebase reads используют typed mappers (`documentFromDb`, `versionFromDb`, `profileFromDb`)
- Все Zustand stores typed без `as`
- Все DOM events проверяются через `instanceof` или type guards
- `npx tsc --noEmit` зелёный
- `npx vitest run` — 421 тестов проходят

---

### П1-03 — [ОТМЕНЁН] ~~31 `any` в production code~~

**Приоритет:** ❌ Ложный тикет (не выполнять)  
**Причина отмены:** `grep -rn "any"` считает подстроку внутри слов (`many`, `company`, `anyway`, `anything`, `anywhere` и т.д.). Реальных `any` как типа в проде — **0**, потому что `eslint.config.js` уже содержит `'@typescript-eslint/no-explicit-any': 'error'` и `npx eslint` показывает 0 ошибок.

> **Важно:** критерий готовности `grep ... | wc -l → 0` был **недостижим в принципе** — невозможно убрать подстроку `any` из слов `many`, `company`, `anyhow` и т.д. в translations и prompts.

---

## 🟡 P2 — СРЕДНИЙ ПРИОРИТЕТ (code health, visual consistency)

### П2-01 — 279 inline styles → utility classes / design tokens

**Приоритет:** 🟡 Средний (визуальная консистентность, SSR)  
**Оценка:** 6–8 часов  
**Файлы:** `src/`, `src/index.css`

#### Проблема

После Epic 11 остались 279 inline styles:

**Категории:**
1. **Mobile safe-area (40 шт)** — `style={{ paddingBottom: 'env(safe-area-inset-bottom, 16px)' }}`
2. **Dynamic colors (60 шт)** — `style={{ background: label.color }}`, `style={{ color: stat.color }}`
3. **Animation / motion (30 шт)** — `style={{ animationDelay: `${i * 60}ms` }}`, `style={{ transitionDelay: ... }}`
4. **Dynamic width / height (50 шт)** — `style={{ width: `${progress}%` }}`, `style={{ height: '100%' }}`
5. **Layout / flex (30 шт)** — `style={{ display: 'flex', gap: 6 }}`, `style={{ flexDirection: 'column' }}`
6. **Grid / border (40 шт)** — `style={{ gridTemplateColumns: '72px 1fr auto' }}`, `style={{ borderBottom: ... }}`
7. **Font / text (20 шт)** — `style={{ fontSize: 11, fontFamily: 'JetBrains Mono' }}`, `style={{ textWrap: 'pretty' }}`
8. **Theme / z-index (9 шт)** — `style={{ zIndex: 0, background: config.base }}`

#### Решение

**Поэтапно:**

1. **Фаза 1 — Safe-area (40 шт)** (1 час)
   - Добавить CSS utility: `.pb-safe { padding-bottom: env(safe-area-inset-bottom, 16px); }`
   - Добавить `.pb-safe-nav { padding-bottom: calc(env(safe-area-inset-bottom, 0px) + var(--bottom-nav-height, 72px) + 8px); }`
   - Заменить все inline safe-area на utility-классы

2. **Фаза 2 — Dynamic colors (60 шт)** (1.5 часа)
   - Для `label.color` — использовать `style={{ backgroundColor: label.color }}` (это **динамический** цвет, inline style здесь оправдан)
   - Но для `stat.color` — создать `Badge` variant: `<Badge variant="streak" />`
   - Для `accent-danger` — уже мигрировано ✅

3. **Фаза 3 — Dynamic width / height (50 шт)** (1.5 часа)
   - Progress bar: `style={{ width: `${progress}%` }}` → оставить inline (динамический), но использовать `w-full` + `style={{ width: ... }}` (минимизировать inline)
   - `height: '100%'` → `className="h-full"` (Tailwind)
   - `min-height: 48px` → `min-h-[48px]` (Tailwind arbitrary)

4. **Фаза 4 — Layout / flex (30 шт)** (1 час)
   - `display: 'flex', gap: 6` → `className="flex gap-1.5"`
   - `flexDirection: 'column'` → `className="flex flex-col"`
   - `flex: 1` → `className="flex-1"`

5. **Фаза 5 — Grid / border (40 шт)** (1 час)
   - `gridTemplateColumns: '72px 1fr auto'` → `className="grid grid-cols-[72px_1fr_auto]"` (Tailwind grid-cols arbitrary)
   - `borderBottom: '1px solid var(--color-border-subtle)'` → `className="border-b border-border-subtle"`

6. **Фаза 6 — Font / text (20 шт)** (1 час)
   - `fontSize: 11, fontFamily: 'JetBrains Mono'` → `className="text-[11px] font-mono"`
   - `textWrap: 'pretty'` → `className="text-pretty"` (Tailwind v4)
   - `letterSpacing: '.06em'` → `className="tracking-[0.06em]"` (Tailwind arbitrary)

7. **Фаза 7 — Theme / z-index (9 шт)** (30 минут)
   - `style={{ zIndex: 0, background: config.base }}` → `className="z-0" style={{ background: config.base }}` (минимизировать)

#### Критерий готовности
- `grep -rn "style={{" src/ --include="*.tsx" | grep -v "\.test\." | grep -v "node_modules" | wc -l` → **< 100** (только динамические: progress bar width, label color, animation delay)
- Все static layout styles (flex, grid, gap, padding, border) переведены на utility-классы
- `npx tsc --noEmit` зелёный
- `npx vitest run` — 421 тестов проходят
- Визуально без регресса (mobile safe-area, label colors, animations)

---

### П2-02 — Cross-imports: `core` → `shared` (нарушение границы слоёв)

**Приоритет:** 🟡 Средний (архитектурный долг)  
**Оценка:** 3–4 часа  
**Файлы:** `src/shared/`, `src/core/`

#### Проблема

`shared` не должен зависеть от `core` (shared — самый низкий уровень, core — бизнес-логика):

```
src/shared/components/GoalToast.tsx           → import { useLanguage } from '../../core/i18n'
src/shared/components/CancelConfirmModal.tsx  → import { useLanguage } from '../../core/i18n'
src/shared/components/ConfirmModal.tsx        → import { useLanguage } from '../../core/i18n'
src/shared/components/LoadingSpinner.tsx    → import { useLanguage } from '../../core/i18n'
src/shared/components/LoadingSkeleton.tsx     → import { useLanguage } from '../../core/i18n'
src/shared/components/StreakDots.tsx          → import { useLanguage } from '../../core/i18n'
src/shared/components/ErrorBoundary.tsx       → import { reportError } from '../../core/errors/reportError'
src/shared/components/ErrorBoundary.tsx       → import { translations } from '../../core/i18n'
src/shared/hooks/useUserId.ts                → import { getOrCreateGuestId } from '../../core/storage/localDb'
src/shared/hooks/useServiceAction.ts         → import { useLanguage } from '../../core/i18n'
src/shared/hooks/useServiceAction.ts         → import { reportError } from '../../core/errors/reportError'
src/shared/hooks/useLocalStorage.ts         → import { reportError } from '../../core/errors/reportError'
```

#### Решение

**Принцип:** `shared` может иметь **peer-dependency** на `core`, но не прямой import.

**Вариант A — Inversion (рекомендуется)**
Переместить `useLanguage` и `reportError` в `shared`:

```
src/core/i18n/          → src/shared/i18n/          (переместить)
src/core/errors/        → src/shared/errors/        (переместить)
src/core/storage/localDb.ts → src/shared/storage/localDb.ts (переместить)
```

**Вариант B — Props injection**
Компоненты в `shared` принимают `t` и `reportError` как props:

```ts
// Было (shared → core)
function ConfirmModal() {
  const { t } = useLanguage();
  // ...
}

// Стало (shared → no deps)
function ConfirmModal({ t }: { t: (key: string) => string }) {
  // ...
}

// Вызывающий (core)
<ConfirmModal t={useLanguage().t} />
```

**Вариант C — Context provider (re-export)**
Создать thin wrapper в `shared`:

```ts
// src/shared/contexts/i18n.ts
export { useLanguage } from '../../core/i18n';
// Это не решает проблему, просто скрывает import
```

**Рекомендация:** Вариант A — переместить `i18n`, `errors`, `localDb` в `shared` (они фундаментальные, не бизнес-логика).

#### Критерий готовности
- `grep -rn "from '../../core/" src/shared/ --include="*.ts" --include="*.tsx" | grep -v "test" | grep -v "node_modules" | wc -l` → **0**
- `shared` не импортирует из `core`
- `npx tsc --noEmit` зелёный
- `npx vitest run` — 421 тестов проходят
- `npx eslint . --ext .ts,.tsx --max-warnings 0` зелёный

---

## 🟢 P3 — НИЗКИЙ ПРИОРИТЕТ (опционально)

### П3-01 — `noUncheckedIndexedAccess` (TypeScript строгость)

**Приоритет:** 🟢 Низкий (type safety, ~182 ошибки)  
**Оценка:** 8–12 часов  
**Файлы:** `tsconfig.json` + весь `src/`

#### Проблема

```json
// tsconfig.json
"noUncheckedIndexedAccess": false
```

При включении всплывает **~182 ошибки**:
```ts
// arr[0] — тип T, но на самом деле T | undefined
const first = sessions[0]; // sessions[0] должно быть Session | undefined
first.id; // ❌ runtime error если массив пустой
```

#### Решение

**Поэтапно (1 файл за раз):**

1. Включить в `tsconfig.json`:
   ```json
   "noUncheckedIndexedAccess": true
   ```

2. Для каждой ошибки:
   ```ts
   // Было
   const first = sessions[0];
   first.id;
   
   // Стало
   const first = sessions[0];
   if (first == null) return; // или throw
   first.id;
   ```

3. Или использовать `.at()`:
   ```ts
   const first = sessions.at(0);
    if (first == null) return;
    first.id;
    ```

#### Критерий готовности
- `"noUncheckedIndexedAccess": true` в `tsconfig.json`
- `npx tsc --noEmit` показывает **0** ошибок
- `npx vitest run` — 421 тестов проходят
- Нет runtime регресса (все проверки `if (x == null)` корректны)

---

### П3-02 — Bundle-size budget и CI gate

**Приоритет:** 🟢 Низкий (performance monitoring)  
**Оценка:** 1–2 часа  
**Файлы:** `.github/workflows/ci.yml`, `vite.config.ts`

#### Проблема

- `chunkSizeWarningLimit: 300` — но chunks > 300 KB не фейлят CI
- `vendor-firebase-firestore` (448 KB gzip: 111 KB) — не бьётся тревогой
- `vendor-analytics` (189 KB gzip: 63 KB) — тоже без gate

#### Решение

1. **Budget gate в CI:**
   ```bash
   # .github/workflows/ci.yml
   - name: Bundle size budget
     run: |
       MAX_INDEX=600000  # 600 KB
       MAX_VENDOR=500000  # 500 KB
       for f in dist/assets/index-*.js; do
         size=$(stat -f%z "$f")
         if [ $size -gt $MAX_INDEX ]; then
           echo "❌ $f exceeds budget: $size > $MAX_INDEX"
           exit 1
         fi
       done
       for f in dist/assets/vendor-*.js; do
         size=$(stat -f%z "$f")
         if [ $size -gt $MAX_VENDOR ]; then
           echo "⚠️ $f exceeds vendor budget: $size > $MAX_VENDOR"
           # не фейлим, но warning
         fi
       done
   ```

2. **HTML report в CI:**
   ```bash
   npm run build
   npx bundlesize  # или custom script
   ```

#### Критерий готовности
- CI фейлится если `index-*.js` > 600 KB
- CI выдаёт warning если `vendor-*.js` > 500 KB
- `npx vitest run` — 421 тестов проходят

---

## 📋 Порядок работы

| Эпик | Приоритет | Оценка | Блокеры |
|------|-----------|--------|---------|
| П0-01 | 🔴 | 2–4 ч | Нет |
| П1-01 | 🟠 | 3–4 ч | П0-01 (npm audit) |
| П1-02 | 🟠 | 4–6 ч | Нет |
| П2-01 | 🟡 | 6–8 ч | Нет |
| П2-02 | 🟡 | 3–4 ч | Нет |
| П3-01 | 🟢 | 8–12 ч | Нет |
| П3-02 | 🟢 | 1–2 ч | Нет |

**Рекомендация:**
1. **Неделя 1:** П0-01 + П1-01 + П1-02 (начало)
2. **Неделя 2:** П1-02 (окончание) + П2-01 (начало)
3. **Неделя 3:** П2-01 (окончание) + П2-02
4. **Неделя 4:** П3-01 (по 1 файлу за день) + П3-02

---

## 🎯 Definition of Done (все тикеты)

```bash
npx eslint . --ext .ts,.tsx --max-warnings 0 --ignore-pattern "public/**"
npx tsc --noEmit
npx vitest run
npm --prefix functions run build
npm run build
npm audit --audit-level=moderate
```

Все команды зелёные. ✅