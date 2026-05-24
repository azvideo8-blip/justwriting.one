# MOBILE_UX_TICKETS_7 — десктоп UX: срочно + средний спринт

---

## UX-01 · Дефолт ширины редактора

**Файл:** `src/features/writing/contexts/WritingSettingsContext.tsx` строка 44

**Проблема:** Дефолт `100` заставляет текст занимать всю ширину на любом мониторе (~1350px на 1440p). Оптимальная строка — 60–75 символов, это ~650–700px. Пользователь не найдёт настройку сам.

```tsx
// БЫЛО
const [editorWidth, setEditorWidth] = useLocalStorage<number>('v3_editorWidth', 100, z.number());

// СТАЛО
const [editorWidth, setEditorWidth] = useLocalStorage<number>('v3_editorWidth', 68, z.number());
```

`68%` на типичном 1440px (контентная область ~1376px) даёт ~935px — с учётом padding редактора выходит ~820px строки, что по верхней границе оптимума. При этом дефолт < 100 уже активирует красивый «карточный» режим (`rounded-2xl`, shadow, glow при фокусе) в `DesktopWritingLayout.tsx` — два улучшения в одной строке.

**Также:** в `EditorTab.tsx` слайдер идёт от 50 до 100. Изменить min до 40, чтобы пользователь мог задать более узкую колонку:

```tsx
// строка ~66
<input type="range" min={40} max={100} step={1} ...
```

---

## UX-02 · GoalPopup — сделать триггеры кликабельными

**Файл:** `src/features/writing/components/BottomStats.tsx`

**Проблема:** Блоки «слова» и «таймер» кликабельны, но выглядят как статичный текст — нет hover-фона, нет иконки, нет подсказки.

### Блок sessionWords (~строка 125)

```tsx
// БЫЛО
className={cn("flex flex-col cursor-pointer",
  compact ? "pr-3 mr-3 px-2 py-1" : "pr-5 mr-5 px-3 py-1.5"
)}

// СТАЛО — добавить hover-фон и rounded
className={cn(
  "flex flex-col cursor-pointer rounded-xl transition-colors hover:bg-text-main/[0.04]",
  compact ? "pr-3 mr-3 px-2 py-1" : "pr-5 mr-5 px-3 py-1.5"
)}
```

Добавить маленькую иконку-подсказку рядом с числом (~строка 132):

```tsx
<div className="flex items-baseline gap-1.5 leading-none">
  <span className={cn("text-lg font-medium leading-none tabular-nums whitespace-nowrap",
    wordDone ? "text-accent-success" : "text-text-main")}>
    {sessionWords}
  </span>
  {wordGoal > 0 && (
    <span className={cn("text-xs", wordDone ? "text-accent-success/60" : "text-text-main/30")}>
      / {wordGoal}
    </span>
  )}
  {/* ↓ новая иконка-подсказка */}
  {!compact && (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
      className="text-text-main/20 group-hover:text-text-main/40 transition-colors self-center mb-0.5">
      <path d="M5 2v4M3 4l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  )}
</div>
```

Добавить `group` в className wrapper-div чтобы иконка реагировала на hover блока.

### Блок sessionTime (~строка 165) — то же самое:

```tsx
// БЫЛО
className={cn("flex flex-col cursor-pointer",
  compact ? "pr-3 mr-3 px-2 py-1" : "pr-5 mr-5 px-3 py-1.5"
)}

// СТАЛО
className={cn(
  "flex flex-col cursor-pointer rounded-xl transition-colors hover:bg-text-main/[0.04]",
  compact ? "pr-3 mr-3 px-2 py-1" : "pr-5 mr-5 px-3 py-1.5"
)}
```

---

## UX-03 · Контраст меток в статус-баре

**Файл:** `src/features/writing/components/BottomStats.tsx`

**Проблема:** Подписи `ВСЕГО СЛОВ`, `СЛ/МИН` и т.д. — `text-text-main/40` + `uppercase` + `tracking-widest`. На тёмном фоне не проходят WCAG AA (~2.5:1). Убрать uppercase и снизить tracking.

Найти все span с `text-[10px] text-text-main/40 uppercase tracking-widest` (~строки 109, 149, 165, 193, 208) и заменить:

```tsx
// БЫЛО
<span className="text-[10px] text-text-main/40 uppercase tracking-widest mt-1 hidden sm:block">

// СТАЛО
<span className="text-[10px] text-text-main/55 tracking-wide mt-1 hidden sm:block">
```

Три места (sessionWords label, sessionTime label, totalWords label). WPM label (~строка 208) — то же:

```tsx
// БЫЛО
<span className="text-[10px] text-text-main/40 uppercase tracking-widest mt-1 hidden sm:block">

// СТАЛО
<span className="text-[10px] text-text-main/55 tracking-wide mt-1 hidden sm:block">
```

---

## UX-04 · Border-radius консистентность в WritingHeader

**Файл:** `src/features/writing/WritingHeader.tsx`

**Проблема:** В блоке `lifeLogEnabled` кнопки используют `rounded-lg`, а в блоке без lifeLog — `rounded-xl`. В одном компоненте два разных радиуса.

Заменить все `rounded-lg` на `rounded-xl` внутри `lifeLogEnabled`-ветки (~строки 94, 98, 102):

```tsx
// БЫЛО (3 кнопки — новый файл/открыть/сохранить)
className="w-9 h-9 rounded-lg flex items-center ..."

// СТАЛО
className="w-9 h-9 rounded-xl flex items-center ..."
```

Также строка ~194 (кнопка fullscreen в не-lifelog ветке):

```tsx
// БЫЛО
className="w-9 h-9 rounded-lg flex items-center ..."

// СТАЛО
className="w-9 h-9 rounded-xl flex items-center ..."
```

---

## UX-05 · Empty state профиля

**Файлы:**
- `src/features/profile/pages/ProfilePage.tsx` (~строка 178)
- `src/features/writing/components/MobileMeScreen.tsx` (~строка 270)

**Проблема:** При нулевых сессиях страница показывает шесть нулей, пустые графики, пустую streak ribbon. Это демотивирует вместо того, чтобы объяснить что будет.

### ProfilePage.tsx — вставить перед `return (` (~строка 178):

```tsx
// ДОБАВИТЬ перед return (
if (!loading && sessions.length === 0) {
  return (
    <div className="min-h-screen bg-surface-base flex flex-col items-center justify-center gap-8 px-6 text-center">
      <ProfileHero user={user} profile={profile} isGuest={isGuest} onStartSession={() => navigate('/')} />
      <div className="max-w-sm space-y-3">
        <p className="text-[15px] text-text-main/50 leading-relaxed">
          {t('profile_empty_desc')}
        </p>
        <p className="text-[13px] text-text-main/30 font-mono uppercase tracking-widest">
          {t('profile_empty_hint')}
        </p>
      </div>
    </div>
  );
}
```

### MobileMeScreen.tsx — в блоке `activeSection === 'stats'` (~строка 270), перед `<ProfileHero`:

```tsx
{activeSection === 'stats' && (
  loadingSessions ? (
    /* skeleton... */
  ) : sessions.length === 0 ? (
    <div className="flex flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <div className="text-[14px] text-text-main/40 leading-relaxed max-w-xs">
        {t('profile_empty_desc')}
      </div>
      <div className="text-[11px] text-text-main/25 font-mono uppercase tracking-widest">
        {t('profile_empty_hint')}
      </div>
    </div>
  ) : (
    /* существующий контент */
  )
)}
```

### Новые i18n ключи — добавить в `src/core/i18n/translations/profile.ts`:

```ts
profile_empty_desc: {
  ru: 'Здесь появится твоя статистика — слова, серии, ритм. Начни первую сессию.',
  en: 'Your stats will appear here — words, streaks, rhythm. Start your first session.',
},
profile_empty_hint: {
  ru: 'вкладка «Писать»',
  en: 'go to the Write tab',
},
```

---

## UX-06 · Sidebar pin-state

**Файл:** `src/features/navigation/components/Sidebar.tsx`

**Проблема:** Сайдбар всегда начинается свёрнутым. Первый пользователь видит только иконки и не понимает структуру. Нужно: при первом визите — развёрнут, после первого схлопывания вручную — запоминать состояние.

**Что изменить (~строки 1–2 и 132):**

Добавить импорт:
```tsx
import { useLocalStorage } from '../../../shared/hooks/useLocalStorage';
```

Заменить `useState(false)`:
```tsx
// БЫЛО
const [expanded, setExpanded] = useState(false);

// СТАЛО
const [pinned, setPinned] = useLocalStorage<boolean>('sidebar_pinned', true, z.boolean());
const [hovered, setHovered] = useState(false);
const expanded = pinned || hovered;
```

Добавить `z` import: `import { z } from 'zod';` (уже может быть в файле — проверить).

На `onMouseLeave` изменить: при `pinned === true` и уходе мыши — не схлопывать (т.е. `setHovered(false)` уже достаточно, `expanded` само останется `true`).

Добавить pin-кнопку в низ сайдбара — рядом с версией (~строка 235):

```tsx
<button
  onClick={() => setPinned(!pinned)}
  title={pinned ? t('sidebar_unpin') : t('sidebar_pin')}
  className={cn(
    "w-full flex items-center gap-3 px-3 py-2 rounded-xl text-text-main/25 hover:text-text-main/50 transition-all",
    expanded ? "opacity-100" : "opacity-0 pointer-events-none"
  )}
>
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
    {pinned
      ? <path d="M7 2v10M4 5h6M4 9h6" strokeLinecap="round"/>   // unpin icon
      : <path d="M5 2l4 4-6 6M9 2l-4 4 6 6" strokeLinecap="round"/>  // pin icon
    }
  </svg>
  <span className="text-[10px] font-mono uppercase tracking-widest">
    {pinned ? t('sidebar_unpin') : t('sidebar_pin')}
  </span>
</button>
```

Новые i18n ключи в `src/core/i18n/translations/common.ts`:
```ts
sidebar_pin:   { ru: 'Закрепить', en: 'Pin sidebar' },
sidebar_unpin: { ru: 'Открепить', en: 'Unpin sidebar' },
```

---

## UX-07 · «О приложении» → footer сайдбара

**Файл:** `src/features/navigation/components/Sidebar.tsx`

**Проблема:** `Info`-иконка занимает ценное место в нижней навигации рядом с Settings и Login, но ведёт на dead-end страницу.

Убрать `SidebarActionItem` с `Info` (~строки 209–213):

```tsx
// УДАЛИТЬ
<SidebarActionItem
  icon={<Info size={20} />}
  label={t('nav_about')}
  expanded={expanded}
  onClick={() => navigate('/about')}
/>
```

Добавить мелкую ссылку в версионный блок (~строки 235–240):

```tsx
// БЫЛО
<div className={cn(
  "px-3 py-2 text-[10px] font-mono text-text-main/25 ...",
  expanded ? "opacity-100 pl-3" : "opacity-0 h-0 p-0 overflow-hidden"
)}>
  {t('common_version')}: {APP_VERSION}
</div>

// СТАЛО
<div className={cn(
  "px-3 py-2 text-[10px] font-mono text-text-main/25 transition-all duration-300 select-none whitespace-nowrap flex items-center gap-2",
  expanded ? "opacity-100 pl-3" : "opacity-0 h-0 p-0 overflow-hidden"
)}>
  <span>{t('common_version')}: {APP_VERSION}</span>
  <span className="text-text-main/15">·</span>
  <button
    onClick={() => navigate('/about')}
    className="hover:text-text-main/50 transition-colors underline underline-offset-2 decoration-dotted"
  >
    {t('nav_about')}
  </button>
</div>
```

Убрать импорт `Info` из lucide если он больше нигде не используется в файле.

---

## UX-08 · Один вход в Settings

**Файл:** `src/features/navigation/components/Sidebar.tsx`

**Проблема:** Settings есть и в сайдбаре, и в WritingHeader — два входа в один overlay создают неопределённость. Шестерёнка в хедере — привычный паттерн, оставить её. Из сайдбара убрать.

Удалить блок (~строки 216–222):

```tsx
// УДАЛИТЬ
{onOpenSettings && (
  <SidebarActionItem
    icon={<Settings size={20} />}
    label={t('nav_settings')}
    expanded={expanded}
    onClick={onOpenSettings}
  />
)}
```

Убрать `onOpenSettings` из `SidebarProps` и из `Sidebar` function props (~строки 128, 131) — если пропс нигде больше не нужен:

```tsx
// БЫЛО
interface SidebarProps {
  isAdmin: boolean;
  inGrid?: boolean;
  onOpenSettings?: () => void;
}
export function Sidebar({ isAdmin, inGrid: inGridProp, onOpenSettings }: SidebarProps)

// СТАЛО
interface SidebarProps {
  isAdmin: boolean;
  inGrid?: boolean;
}
export function Sidebar({ isAdmin, inGrid: inGridProp }: SidebarProps)
```

В `DesktopWritingLayout.tsx` (~строка 116) убрать `onOpenSettings` из пропсов `<Sidebar>`:

```tsx
// БЫЛО
<Sidebar isAdmin={!!profile?.role && profile.role === 'admin'} inGrid onOpenSettings={onOpenSettings} />

// СТАЛО
<Sidebar isAdmin={!!profile?.role && profile.role === 'admin'} inGrid />
```

Убрать импорт `Settings` из lucide если больше не используется.

---

## UX-09 · «Начать» → «Написать сейчас» в ProfileHero

**Файлы:**
- `src/features/profile/components/ProfileHero.tsx` строка 144
- `src/core/i18n/translations/lifelog.ts` строка 35

**Проблема:** Кнопка «Начать» на странице профиля выглядит как primary CTA страницы, хотя пользователь пришёл смотреть статистику. Нужно: другое название + меньший визуальный вес.

### lifelog.ts — добавить новый ключ:

```ts
// ДОБАВИТЬ рядом с home_cta:
profile_cta: { ru: 'Написать сейчас', en: 'Write now' },
```

### ProfileHero.tsx (~строки 138–145):

```tsx
// БЫЛО
<button
  onClick={onStartSession}
  style={{ background: 'var(--flow-pulse-color)' }}
  className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-surface-base w-full sm:w-auto"
>
  <PenLine size={14} />
  {t('home_cta')}
</button>

// СТАЛО — secondary стиль, меньше веса
<button
  onClick={onStartSession}
  className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium text-text-main/60 hover:text-text-main border border-border-subtle hover:border-text-main/30 transition-all w-full sm:w-auto"
>
  <PenLine size={13} />
  {t('profile_cta')}
</button>
```

---

## Порядок реализации

| Тикет | Трудоёмкость |
|-------|---|
| UX-01 дефолт ширины | 2 мин |
| UX-03 контраст меток | 5 мин |
| UX-04 border-radius | 5 мин |
| UX-08 один вход в Settings | 10 мин |
| UX-07 «О приложении» → footer | 15 мин |
| UX-09 «Написать сейчас» | 15 мин |
| UX-02 GoalPopup affordance | 20 мин |
| UX-05 empty state профиля | 30 мин |
| UX-06 sidebar pin-state | 45 мин |
