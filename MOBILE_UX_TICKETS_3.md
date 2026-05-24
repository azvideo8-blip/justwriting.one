# Mobile UX Tickets — Batch 3

Конкретные изменения по скриншотам пользователя. Код написан — копировать и вставлять.

---

## T-01 · Убрать «Life Log» из мобильного меню — оставить только «Заметки»

**Проблема.** BottomNav показывает 5 вкладок: Писать / Life Log / Архив / Я / Админ. Две вкладки (Log и Archive) дублируют друг друга — на мобиле нужна одна.

**Что делать:**

**`src/features/navigation/components/BottomNav.tsx`** — убрать `log`-вкладку из массива `tabs`:

```tsx
// Было:
const tabs = [
  { id: 'write',   path: '/',        label: t('nav_write'),  icon: <PenIcon /> },
  { id: 'log',     path: '/log',     label: t('lifelog_tab_log'), icon: <LogIcon /> },
  { id: 'archive', path: '/archive', label: t('archive_sidebar_title'), icon: <ArchiveIcon /> },
  { id: 'me',      path: '/me',      label: t('nav_me'),     icon: <MeIcon /> },
  ...
];

// Стало (убрать log полностью):
const tabs = [
  { id: 'write',   path: '/',        label: t('nav_write'),          icon: <PenIcon /> },
  { id: 'archive', path: '/archive', label: t('nav_notes_short'),    icon: <ArchiveIcon /> },
  { id: 'me',      path: '/me',      label: t('nav_profile_short'),  icon: <MeIcon /> },
  ...(isAdmin ? [{ id: 'admin', path: '/admin', label: t('nav_admin'), icon: <Shield size={22} strokeWidth={1.6} /> } as const] : []),
];
```

Убрать `LogIcon` — импорт SVG больше не нужен.

**`src/app/AppRoutes.tsx`** — редирект `/log` → `/archive` чтобы старые закладки не ломались:
```tsx
// Добавить перед закрывающим </Routes>:
import { Navigate } from 'react-router-dom';
<Route path="/log" element={<Navigate to="/archive" replace />} />
```

**Критерий.** BottomNav показывает 3 вкладки для обычного юзера: Писать / Заметки / Профиль. Переход по старому `/log` редиректит на `/archive`.

---

## T-02 · Переименовать вкладки — одинаково в мобильном и десктопном

**Проблема.** Сейчас:
- Десктоп Sidebar: `nav_write` / `nav_notes` / `nav_profile` / `nav_admin` — уже правильные ключи, но `nav_notes` = «Мои заметки» (длинно для мобиля).
- BottomNav мобиль: `t('nav_me')` = «Я», `t('archive_sidebar_title')` = «Архив» — не совпадают с десктопом.
- `nav_notes_short` = «Заметки» и `nav_profile_short` = «Профиль» уже есть в переводах — использовать их в BottomNav (сделано выше в T-01).

**`src/core/i18n/translations/common.ts`** — поправить длинные варианты чтоб совпадали с дизайном:
```ts
nav_notes:         { ru: 'Заметки',  en: 'Notes' },    // было: 'Мои заметки'
nav_profile:       { ru: 'Профиль',  en: 'Profile' },   // было: 'Мой профиль'
nav_notes_short:   { ru: 'Заметки',  en: 'Notes' },     // без изменений
nav_profile_short: { ru: 'Профиль',  en: 'Profile' },   // без изменений
```

**Десктоп `Sidebar.tsx`** уже использует `t('nav_notes')` и `t('nav_profile')` — после правки переводов станет «Заметки» и «Профиль».

**MobilePageHeader** в MobileMeScreen — заголовок берётся из `t('nav_me')` = «Я». Поменять:
```tsx
// В MobileMeScreen.tsx, MobilePageHeader:
<MobilePageHeader title={t('nav_profile_short')} titleFont="sans" right={...} />
```

**`src/core/i18n/translations/common.ts`** добавить ключ `nav_me` оставить как есть или обновить:
```ts
nav_me: { ru: 'Профиль', en: 'Profile' },
```

**Критерий.** Вкладки мобиль: «Писать» / «Заметки» / «Профиль» / «Админ». Десктоп: «Писать» / «Заметки» / «Профиль» / «Админ». Совпадают.

---

## T-03 · Добавить кнопку «Новая заметка» в мобильном редакторе

**Проблема.** После завершения сессии пользователь остаётся в редакторе с текстом предыдущей заметки. Нет способа начать новую без перехода на главный экран.

**Куда добавить.** `MobileWriteToolbar` уже передаётся через `WritingPage`, там есть `handleNew`. Нужно прокинуть его до тулбара.

**Шаг 1 — `MobileWriteScreen.tsx`:** добавить проп `onNew`:
```tsx
interface MobileWriteScreenProps {
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onNew?: () => void;           // ← добавить
  saveStatus?: string;
  keystrokeTrackerRef?: React.RefObject<KeystrokeTracker>;
}

export function MobileWriteScreen({
  onPlay, onPause, onStop, onNew, saveStatus, keystrokeTrackerRef  // ← добавить
}: MobileWriteScreenProps) {
```

Прокинуть в `MobileWriteToolbar`:
```tsx
<MobileWriteToolbar
  onPlay={onPlay}
  onPause={onPause}
  onStop={onStop}
  onNew={onNew}           // ← добавить
  onGoalClick={() => setShowGoalSheet(true)}
  ...
/>
```

**Шаг 2 — `WritingPage.tsx`:** прокинуть `handleNew` в `MobileWriteScreen`:
```tsx
// Строка ~253, было:
return <MobileWriteScreen onPlay={handlePlay} onPause={handlePause} onStop={onFinishClick} saveStatus={saveStatus} keystrokeTrackerRef={keystrokeTrackerRef} />;

// Стало:
return <MobileWriteScreen onPlay={handlePlay} onPause={handlePause} onStop={onFinishClick} onNew={handleNew} saveStatus={saveStatus} keystrokeTrackerRef={keystrokeTrackerRef} />;
```

**Шаг 3 — `MobileWriteToolbar.tsx`:** добавить проп `onNew` и кнопку, которая видна только когда `isIdle`:
```tsx
interface MobileWriteToolbarProps {
  // ... существующие пропсы
  onNew?: () => void;   // ← добавить
}

// В JSX после кнопки Stop:
{onNew && isIdle && (
  <button
    onClick={onNew}
    style={{
      width: 40, height: 40,
      borderRadius: 12,
      border: '1px solid var(--border-light)',
      background: 'transparent',
      color: 'var(--text-muted)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: 'pointer',
      marginLeft: 4,
    }}
    title="Новая заметка"
  >
    {/* Plus icon */}
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19"/>
      <line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  </button>
)}
```

**Критерий.** После завершения сессии (status = 'idle') в тулбаре появляется кнопка «+». Тап создаёт новую пустую заметку.

---

## T-04 · Шиты перекрываются нижним баром — исправить padding, убрать «С подсказкой»

**Файл:** `src/features/writing/components/MobileSessionSetupSheet.tsx`

**Проблема 1.** Скролл-контейнер внутри шита имеет `pb-8` (32px), но на устройствах с высоким нижним safe-area и BottomNav (≈80px) последние элементы обрезаются.

**Найти** div с классом `px-6 pb-8 overflow-y-auto` (строка ~141) и поменять `pb-8` → `pb-0`, добавить inline style:
```tsx
<div className="px-6 overflow-y-auto no-scrollbar flex-1"
  style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 88px)' }}>
```

**Проблема 2.** «С подсказкой» (`id: 'prompts'`) — убрать из массива режимов:
```tsx
// Было — массив в JSX (строки ~152-158):
[
  { id: 'stopwatch',     ... },
  { id: 'timer-config',  ... },
  { id: 'words-config',  ... },
  { id: 'finish-by-config', ... },
  { id: 'prompts',       ... },  // ← УДАЛИТЬ эту строку
]
```

Также убрать блок `{setupMode === 'prompts' && (…)}` — он рендерит экран выбора подсказок (строки ~313-340 примерно). И убрать `import { Sparkles }` из lucide если больше не используется.

Убрать из `SetupMode` тип `'prompts'` в `WritingSetup.ts` или аналогичном файле с типами.

**Критерий.** Шит показывает 4 режима. Скрол работает, последний элемент не обрезается. «С подсказкой» нет.

---

## T-05 · MobileNoteActionsSheet: убрать хардкод-заголовок «ARCHIVE_NOTE_ACTIONS»

**Файл:** `src/features/archive/components/MobileNoteActionsSheet.tsx`, строка ~144.

**Проблема.** Заголовок шита рендерится через `t('archive_note_actions') || 'Действия с заметкой'`. Ключ `archive_note_actions` отсутствует в переводах → показывает fallback строку на русском, но на экране отображается как «ARCHIVE_NOTE_ACTIONS» (скорее всего `t()` возвращает сам ключ).

**Добавить ключ в переводы** — `src/core/i18n/translations/archive.ts`:
```ts
archive_note_actions: { ru: 'Действия с заметкой', en: 'Note Actions' },
```

**Также исправить отступ** в скролл-контейнере шита — аналогично T-04:
```tsx
// Найти scrollable div внутри MobileNoteActionsSheet и добавить:
style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 88px)' }}
```

**Критерий.** Заголовок шита показывает «Действия с заметкой» / «Note Actions». Все кнопки видны без обрезания.

---

## T-06 · Архив: шит статистики перекрывается баром

**Файл:** `src/features/archive/components/MobileArchiveSidebarSheet.tsx`

**Проблема.** Аналогично T-04/T-05 — контент шита обрезается снизу.

Найти scrollable-контейнер внутри шита и добавить:
```tsx
style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 88px)' }}
```

**Критерий.** Весь контент статистики (календарь, облако слов, кнопка фильтра) доступен при скролле.

---

## T-07 · Выпадающее меню сортировки сливается с фоном

**Файл:** `src/features/archive/components/ArchiveHeader.tsx`, строка ~123.

**Проблема.** Dropdown использует `bg-bg-main` — этот токен не определён в Tailwind/CSS. Компонент рендерится прозрачным или совпадающим с фоном страницы.

**Заменить** класс `bg-bg-main` на `bg-surface-elevated`:
```tsx
// Было:
<div className="absolute right-0 top-full mt-1 py-1 w-48 bg-bg-main border border-border-subtle rounded-lg shadow-lg z-30">

// Стало:
<div className="absolute right-0 top-full mt-1 py-1 w-48 bg-surface-elevated border border-border-subtle rounded-lg shadow-xl z-30">
```

`shadow-xl` вместо `shadow-lg` — чтобы dropdown визуально «поднимался» над контентом.

**Критерий.** Выпадающее меню сортировки видно на тёмном и светлом фоне. Работает в десктопе и мобильном архиве.

---

## T-08 · Убрать кнопку «Синхронизировать» из профиля — мобиль и десктоп

**Файлы:**
- `src/features/profile/components/ProfileHero.tsx` — кнопка рендерится здесь
- `src/features/writing/components/MobileMeScreen.tsx` — передаёт `onSync`
- `src/features/profile/pages/ProfilePage.tsx` — передаёт `onSync` на десктопе

**Шаг 1.** `ProfileHero.tsx` — убрать кнопку и пропсы:
```tsx
// Убрать из interface:
onSync?: () => void;
syncing?: boolean;

// Убрать из function signature:
export function ProfileHero({ user, profile, isGuest, onStartSession }: ProfileHeroProps) {

// Убрать весь блок (строки ~148-155):
{onSync && (
  <button onClick={onSync} disabled={syncing}
    ...
  >
    ...
  </button>
)}
```

**Шаг 2.** `MobileMeScreen.tsx` — убрать всё связанное с синком:
```tsx
// Убрать импорт:
import { SyncService } from '../services/SyncService';

// Убрать state:
const [syncing, setSyncing] = useState(false);

// Убрать весь useCallback handleSyncBoth (строки ~109-132)

// В ProfileHero убрать пропсы:
<ProfileHero
  user={user}
  profile={profile}
  isGuest={isGuest}
  onStartSession={() => navigate('/')}
  // onSync и syncing — удалить
/>
```

**Шаг 3.** `ProfilePage.tsx` — то же самое: убрать `syncing` state, `handleSyncBoth`, убрать `onSync` и `syncing` из `<ProfileHero />`.

**Критерий.** В профиле нет кнопки «Синхронизировать». `ProfileHero` не принимает `onSync` prop.

---

## T-09 · Убрать вкладку «Письмо» из профиля, добавить шестерёнку на все мобильные экраны

**Файл:** `src/features/writing/components/MobileMeScreen.tsx`

**Проблема.** Вкладка «Письмо» в профиле дублирует настройки, которые уже есть в SettingsPanel.

**Шаг 1.** Убрать вкладку `writing` из секций:
```tsx
// Было:
const sections: { id: Section; label: string }[] = [
  { id: 'stats',   label: t('me_tab_stats') },
  { id: 'writing', label: t('me_tab_writing') },  // ← УДАЛИТЬ
  { id: 'account', label: t('me_tab_account') },
];
type Section = 'stats' | 'writing' | 'account';

// Стало:
const sections: { id: Section; label: string }[] = [
  { id: 'stats',   label: t('me_tab_stats') },
  { id: 'account', label: t('me_tab_account') },
];
type Section = 'stats' | 'account';
```

Убрать `{activeSection === 'writing' && <MeWritingSection />}` и импорт `MeWritingSection`.

**Шаг 2.** Шестерёнка (Settings) уже есть в `MobilePageHeader` MobileMeScreen через `right={}`. Проверить что она там есть — если нет, добавить по образцу из тикета MOB-21.

**Шаг 3.** Добавить шестерёнку в `MobilePageHeader` на экране **Log** (`MobileLogScreen.tsx`):
```tsx
import { Settings } from 'lucide-react';
import { useSettings } from '../../../core/settings/SettingsContext';

// Внутри компонента:
const { openSettings } = useSettings();

// В MobilePageHeader:
<MobilePageHeader
  title={t('lifelog_tab_log')}
  titleFont="serif"
  right={
    <button
      onClick={() => openSettings()}
      style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 10, display: 'flex', alignItems: 'center' }}
      aria-label={t('nav_settings')}
    >
      <Settings size={20} />
    </button>
  }
/>
```

**Добавить шестерёнку на HomeScreen** — в `MobileHomeScreen.tsx` уже есть иконка пользователя справа вверху. Рядом добавить кнопку Settings (или заменить аватар на шестерёнку, если аватар просто ведёт на /me):
```tsx
// Рядом с аватар-кнопкой добавить:
<button
  onClick={() => openSettings()}
  style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--surface-elevated)', border: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', cursor: 'pointer' }}
>
  <Settings size={14} />
</button>
```

**Критерий.** Профиль показывает 2 вкладки: «Статистика» / «Аккаунт». На экранах Log и Home есть иконка шестерёнки, открывающая SettingsPanel.

---

## T-10 · Перевести все строки в MeAccountSection и добавить недостающий i18n-ключ

**Файлы:**
- `src/features/writing/components/MeAccountSection.tsx`
- `src/core/i18n/translations/settings.ts`

**Проблема 1.** Кнопка «Все настройки редактора →» использует `t('settings_all_editor_settings')`, ключ не определён в переводах.

**Добавить в `settings.ts`:**
```ts
settings_all_editor_settings: { ru: 'Все настройки редактора →', en: 'All editor settings →' },
```

**Проблема 2.** Проверить все строки в `MeWritingSection.tsx` на наличие хардкода (после удаления вкладки в T-09 это уже не актуально).

**Проблема 3.** Проверить `MeAccountSection.tsx` — пройти по всем текстовым строкам и убедиться что они через `t()`.

**Критерий.** `t('settings_all_editor_settings')` возвращает переведённую строку. Нет необработанных строк-ключей в UI.

---

## Приоритеты выполнения

| # | Тикет | Усилие | Примечание |
|---|-------|--------|------------|
| T-07 | Dropdown сортировки | XS | Одна строка, максимальный эффект |
| T-05 | archive_note_actions i18n | XS | Одна строка в переводах |
| T-10 | settings_all_editor_settings | XS | Одна строка в переводах |
| T-01 | Убрать Life Log из нав | S | Затрагивает роутер |
| T-02 | Переименовать вкладки | S | Только i18n + 2 файла |
| T-04 | Шит SessionSetup: padding + убрать prompts | S | Найти нужные строки |
| T-05+T-06 | Остальные шиты: padding | XS×2 | Копипаст из T-04 |
| T-08 | Убрать sync button | S | 3 файла, но прямолинейно |
| T-09 | Убрать вкладку Письмо + шестерёнки | M | Несколько экранов |
| T-03 | Кнопка Новая заметка | M | 3 файла, новый UI |
