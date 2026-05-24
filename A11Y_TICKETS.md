# Accessibility Tickets (A11Y Sprint)

Tickets derived from accessibility audit. Grouped by severity.

---

## A11Y-01 — SettingsPanel: диалог без семантики, фокус-ловушки и reduced motion

**Severity:** Critical  
**WCAG:** 4.1.2 Name/Role/Value · 2.1.2 No Keyboard Trap · 2.3.3 Animation from Interactions

### Проблемы

1. `motion.div` панели не имеет `role="dialog"`, `aria-modal="true"`, `aria-labelledby` → скринридер не объявляет его как диалог
2. При открытии панели фокус остаётся на кнопке настроек позади overlay → Tab уходит в фон
3. При закрытии фокус не возвращается на triggering button
4. Анимация `x: '100%' → 0` не отключается при `prefers-reduced-motion: reduce`
5. Аналогично: в `DesktopWritingLayout.tsx` fade-in редактора не учитывает `useReducedMotion`

### Файл: `src/features/settings/components/SettingsPanel.tsx`

**Шаг 1.** Добавить `useRef` на панель и скопировать `useFocusTrap` из `WritingFinishModal.tsx` (строки 20–45) в начало файла (или в `src/shared/hooks/useFocusTrap.ts` и импортировать в оба места).

**Шаг 2.** На `<h2>` добавить `id="settings-title"`.

**Шаг 3.** На `motion.div` панели (сейчас строка 80–86) добавить атрибуты:
```tsx
const panelRef = useRef<HTMLDivElement>(null);
useFocusTrap(panelRef, isOpen);

<motion.div
  ref={panelRef}
  role="dialog"
  aria-modal="true"
  aria-labelledby="settings-title"
  ...
>
```

**Шаг 4.** Добавить `useReducedMotion` и убрать анимацию при `reducedMotion === true`:
```tsx
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';

const reducedMotion = useReducedMotion();

<motion.div
  initial={{ x: reducedMotion ? 0 : '100%' }}
  animate={{ x: 0 }}
  exit={{ x: reducedMotion ? 0 : '100%' }}
  ...
>
```

**Шаг 5.** При закрытии вернуть фокус на triggering element. Самый простой способ — сохранить `document.activeElement` перед открытием в `useEffect` и вызвать `.focus()` в `onClose`. Это можно сделать в `SettingsProvider.tsx`:
```tsx
const triggerRef = useRef<Element | null>(null);

const openSettings = (tab?) => {
  triggerRef.current = document.activeElement;
  ...
  setSettingsOpen(true);
};

// В SettingsPanel передать onClose обёрнутый:
const handleClose = () => {
  setSettingsOpen(false);
  (triggerRef.current as HTMLElement)?.focus();
};
```

### Файл: `src/features/writing/pages/DesktopWritingLayout.tsx`

Найти `motion.div` с редактором, у которого есть `initial={{ opacity: 0 }}`. Добавить `useReducedMotion`:
```tsx
const reducedMotion = useReducedMotion();
// На motion.div:
initial={reducedMotion ? false : { opacity: 0 }}
animate={reducedMotion ? false : { opacity: 1 }}
```

---

## A11Y-02 — WritingHeader + BottomStats + AppShell: keyboard access и ARIA labels

**Severity:** Major  
**WCAG:** 4.1.2 Name/Role/Value · 2.1.1 Keyboard · 1.3.1 Info and Relationships · 2.4.1 Bypass Blocks

### A. WritingHeader — все icon-only кнопки без `aria-label`

**Файл:** `src/features/writing/WritingHeader.tsx`

Все кнопки используют только `title`. `title` недоступен для мобильных скринридеров. Нужно добавить `aria-label` (дублируя значение `title`) на каждую кнопку в **обоих** бранчах (`lifeLogEnabled` и обычном).

Кнопки для правки:

| Строки (lifeLog branch) | Строки (normal branch) | Действие |
|---|---|---|
| ~94 | — | `aria-label={t('topbar_new')}` |
| ~98 | — | `aria-label={t('topbar_open')}` |
| ~102 | — | `aria-label={t('topbar_save')}` |
| ~114 | ~166 | `aria-label={t('lifelog_tab_log')}` |
| ~134 | ~184 | `aria-label={t('nav_settings')}` |
| ~140 | ~191 | `aria-label={isFullscreen ? t('header_exit_fullscreen') : t('header_fullscreen')}` |

Если ключ `header_exit_fullscreen` не существует — добавить в `common.ts`:
```ts
header_exit_fullscreen: { ru: 'Выйти из полноэкранного режима', en: 'Exit fullscreen' }
```

**Title input** (строка ~106, только lifeLog branch):
```tsx
<input
  aria-label={t('topbar_title_placeholder')}
  ...
/>
```

**SVG иконки** внутри кнопок (Lucide компоненты) — добавить `aria-hidden="true"` чтобы скринридер не читал имя иконки поверх `aria-label` кнопки. Пример:
```tsx
<FilePlus size={16} aria-hidden="true" />
```
Применить ко всем `<FilePlus>`, `<FolderOpen>`, `<Save>`, `<BookOpen>`, `<Settings>`, `<Maximize>`, `<Minimize>`.

### B. BottomStats — `<div onClick>` вместо `<button>`

**Файл:** `src/features/writing/components/BottomStats.tsx`

Строки 125–164 (word goal trigger) и 171–208 (time trigger): `<div ref={...} onClick={...} className="... cursor-pointer">` — не фокусируется с клавиатуры, не объявляется кнопкой.

Заменить оба `<div>` на `<button>`:
```tsx
// было:
<div ref={wordRef} onClick={() => {...}} className="group flex flex-col cursor-pointer rounded-xl ...">

// стало:
<button
  ref={wordRef as React.RefObject<HTMLButtonElement>}
  onClick={() => { setWordPopupOpen(!wordPopupOpen); setTimePopupOpen(false); }}
  aria-label={t('goal_popup_words_title')}
  aria-expanded={wordPopupOpen}
  aria-haspopup="dialog"
  className="group flex flex-col rounded-xl text-left ..."
>
```

Аналогично для `timeRef` / `timePopupOpen`.

Убрать `cursor-pointer` из className (у `<button>` курсор по умолчанию `default`; если нужен pointer — `cursor-pointer` оставить).

**WPM dot** (строка ~218): пульсирующий div — декоративный элемент. Добавить `aria-hidden="true"`:
```tsx
<div
  aria-hidden="true"
  className={cn("w-2 h-2 rounded-full ...", status === 'writing' && "animate-pulse")}
  ...
/>
```

### C. AppShell — skip link target не focusable

**Файл:** `src/app/AppShell.tsx`

Строка 57: `<main id="main-content" ...>` не имеет `tabIndex={-1}`. Когда фокусируется через `.focus()` (строка 38 в onClick), браузер молча игнорирует вызов, если элемент не focusable.

Исправление — одна строка:
```tsx
<main id="main-content" tabIndex={-1} className={cn(...)}> 
```

`tabIndex={-1}` не добавляет элемент в Tab-порядок, но позволяет вызвать `.focus()` программно.

---

## A11Y-03 — SettingsPanel tabs: ARIA roles и keyboard navigation

**Severity:** Medium sprint  
**WCAG:** 4.1.2 Name/Role/Value · 2.1.1 Keyboard

### Проблемы

Вкладки реализованы как `<button>` в `<div>` — без `role="tablist"` / `role="tab"`. Скринридер не объявляет их как вкладки. Нет навигации стрелками (WAI-ARIA Tabs Pattern).

### Файл: `src/features/settings/components/SettingsPanel.tsx` (функция `SettingsPanelContent`)

**Шаг 1.** На контейнер вкладок добавить `role="tablist"` и `aria-label`:
```tsx
<div
  role="tablist"
  aria-label={t('settings_tabs_label')}  // новый ключ: ru: 'Разделы настроек', en: 'Settings sections'
  className="flex items-center gap-1 px-4 pt-3 pb-2 shrink-0"
  onKeyDown={handleTabKeyDown}
>
```

**Шаг 2.** На каждый `<button>` добавить ARIA атрибуты:
```tsx
<button
  key={tab.id}
  role="tab"
  aria-selected={activeTab === tab.id}
  aria-controls={`settings-panel-${tab.id}`}
  id={`settings-tab-${tab.id}`}
  tabIndex={activeTab === tab.id ? 0 : -1}
  onClick={() => setActiveTab(tab.id)}
  ...
>
```

**Шаг 3.** На каждый контент-div добавить panel роль:
```tsx
// вместо: {activeTab === 'editor' && <EditorTab />}
<div
  id="settings-panel-editor"
  role="tabpanel"
  aria-labelledby="settings-tab-editor"
  hidden={activeTab !== 'editor'}
  className="contents"
>
  <EditorTab />
</div>
```
Аналогично для `app` и `account`. Использовать `hidden` (булев атрибут), не `display:none` — он семантически скрывает от AT.

**Шаг 4.** Arrow key navigation (WAI-ARIA Tabs Pattern):
```tsx
const tabIds: Tab[] = ['editor', 'app', 'account'];

const handleTabKeyDown = (e: React.KeyboardEvent) => {
  const idx = tabIds.indexOf(activeTab);
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    setActiveTab(tabIds[(idx + 1) % tabIds.length]);
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    setActiveTab(tabIds[(idx - 1 + tabIds.length) % tabIds.length]);
  } else if (e.key === 'Home') {
    e.preventDefault();
    setActiveTab(tabIds[0]);
  } else if (e.key === 'End') {
    e.preventDefault();
    setActiveTab(tabIds[tabIds.length - 1]);
  }
};
```

После смены `activeTab` через стрелки — переместить фокус на активную вкладку. Можно через `useEffect` + `document.getElementById(\`settings-tab-${activeTab}\`)?.focus()`.

### Новые i18n ключи

В `src/core/i18n/translations/common.ts`:
```ts
settings_tabs_label: { ru: 'Разделы настроек', en: 'Settings sections' },
header_exit_fullscreen: { ru: 'Выйти из полноэкранного режима', en: 'Exit fullscreen' },
```

---

## Сводная таблица

| Тикет | Severity | Файлы | WCAG |
|---|---|---|---|
| A11Y-01 | Critical | SettingsPanel.tsx, SettingsProvider.tsx, DesktopWritingLayout.tsx | 4.1.2, 2.1.2, 2.3.3 |
| A11Y-02 | Major | WritingHeader.tsx, BottomStats.tsx, AppShell.tsx | 4.1.2, 2.1.1, 1.3.1, 2.4.1 |
| A11Y-03 | Medium sprint | SettingsPanel.tsx | 4.1.2, 2.1.1 |
