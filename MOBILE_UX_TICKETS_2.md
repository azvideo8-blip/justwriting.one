# Mobile UX Tickets — Batch 2

Что осталось после первого прогона антигравити. Каждый тикет содержит готовый код — ничего придумывать не нужно.

---

## MOB-19 · DocumentPreview на мобиле: анимация снизу, а не справа

**Файл:** `src/features/archive/components/DocumentPreview.tsx`

**Проблема.** На мобиле DocumentPreview открывается с `x: '100%'` — скользит справа налево как десктопный sidebar. На мобиле нативный паттерн — sheet снизу вверх (`y: '100%'`). Плюс панель привязана к `right: 0, top: 0, bottom: 0` — это layout боковой панели, а не мобильного sheet.

**Что менять — только три места в `DocumentPreview.tsx`:**

**1. Анимация (строки ~174-177):**
```tsx
// Было:
initial={{ opacity: 0, x: isMobile ? '100%' : 20 }}
animate={{ opacity: 1, x: 0 }}
exit={{ opacity: 0, x: isMobile ? '100%' : 20 }}
transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}

// Стало:
initial={{ opacity: 0, x: isMobile ? 0 : 20, y: isMobile ? '100%' : 0 }}
animate={{ opacity: 1, x: 0, y: 0 }}
exit={{ opacity: 0, x: isMobile ? 0 : 20, y: isMobile ? '100%' : 0 }}
transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
```

**2. Позиционирование и размер (строки ~179-188):**
```tsx
// Было:
style={{
  position: 'fixed',
  top: 0,
  right: 0,
  bottom: 0,
  width: isMobile ? '100%' : width,
  zIndex: 50,
  display: 'flex',
  flexDirection: 'column',
}}

// Стало:
style={{
  position: 'fixed',
  ...(isMobile ? {
    left: 0,
    right: 0,
    bottom: 0,
    top: 'auto',
    height: '92dvh',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  } : {
    top: 0,
    right: 0,
    bottom: 0,
    width: width,
  }),
  zIndex: 50,
  display: 'flex',
  flexDirection: 'column',
}}
```

**3. Добавить drag handle сверху для мобильного sheet (сразу после открывающего `<motion.div>`, перед `{/* Drag handle (Disabled on mobile) */}`):**
```tsx
{isMobile && (
  <div style={{
    width: 36,
    height: 4,
    borderRadius: 2,
    background: 'rgba(255,255,255,0.15)',
    margin: '10px auto 0',
    flexShrink: 0,
  }} />
)}
```

**Критерий готовности.** Тап по сессии в Log/Archive на мобиле открывает sheet снизу вверх с drag handle сверху. На десктопе — без изменений.

---

## MOB-20 · MobileMeScreen: собственный хедер не убран, paddingTop дублируется

**Файл:** `src/features/writing/components/MobileMeScreen.tsx`

**Проблема.** `MobilePageHeader` добавлен, но root-контейнер оставил `paddingTop: 0` со старым значением `env(safe-area-inset-top, 0px)` в стиле контейнера. Это значит safe-area считается дважды: один раз в `MobilePageHeader` (через `pt-[env(safe-area-inset-top,0px)]` в Tailwind), и, возможно, снова в родительском контейнере.

**Проверить и исправить:** В `MobileMeScreen.tsx` найти root `<div style={{ ... }}>` и убедиться что `paddingTop` равен `0` или отсутствует — не `'env(safe-area-inset-top, 0px)'`.

```tsx
// Должно быть:
<div style={{
  position: 'fixed',
  inset: 0,
  background: 'var(--color-surface-base, #0b0d0c)',
  zIndex: 30,
  display: 'flex',
  flexDirection: 'column',
  // paddingTop убрать, MobilePageHeader сам обрабатывает safe-area
}}>
```

**Критерий готовности.** На iPhone с Dynamic Island нет двойного отступа сверху на экране «Я».

---

## MOB-21 · MobilePageHeader: шрифт заголовка не соответствует экранам

**Файл:** `src/shared/components/MobilePageHeader.tsx`

**Проблема.** Текущая реализация использует `font-serif` (Lora) для всех заголовков. Но `MobileMeScreen` передаёт туда «Я» — короткое слово в serif выглядит странно. `MobileLogScreen` — «Life Log» — тут serif уместен. Нужна возможность задать `variant`.

**Изменение:**
```tsx
// src/shared/components/MobilePageHeader.tsx — заменить целиком:

import React from 'react';
import { cn } from '../../core/utils/utils';

interface MobilePageHeaderProps {
  title: string;
  right?: React.ReactNode;
  className?: string;
  titleFont?: 'serif' | 'sans';
}

export function MobilePageHeader({ title, right, className, titleFont = 'serif' }: MobilePageHeaderProps) {
  return (
    <header
      className={cn(
        "flex items-center justify-between px-5 bg-surface-base border-b border-border-subtle shrink-0 w-full z-10",
        "h-[calc(44px+env(safe-area-inset-top,0px))] pt-[env(safe-area-inset-top,0px)]",
        className
      )}
    >
      <h1 className={cn(
        "text-[18px] font-semibold text-text-main truncate",
        titleFont === 'serif' ? "font-serif" : "font-sans"
      )}>
        {title}
      </h1>
      {right && <div className="flex items-center gap-2 shrink-0">{right}</div>}
    </header>
  );
}
```

**Где использовать:**
- `MobileLogScreen`: `<MobilePageHeader title={t('lifelog_tab_log')} titleFont="serif" />`
- `MobileMeScreen`: `<MobilePageHeader title={t('nav_me')} titleFont="sans" right={<SettingsButton />} />`

**В `MobileMeScreen` убрать весь блок custom header** (div с `justifyContent: 'space-between'` и кнопкой шестерёнки, строки ~207-232) и заменить на:
```tsx
<MobilePageHeader
  title={t('nav_me')}
  titleFont="sans"
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

**Критерий готовности.** Оба экрана (Log, Me) используют `MobilePageHeader`. Стиль заголовка соответствует контексту. Нет дублирующихся header-блоков.

---

## MOB-22 · BottomNav: guest видит недостижимые вкладки без объяснения

**Файл:** `src/features/navigation/components/BottomNav.tsx`

**Проблема.** Guest (незалогиненный пользователь) видит вкладки Archive и Me, тапает — попадает на экраны где либо пусто, либо есть призыв войти. Нет никакого сигнала что это "заблокировано". Плюс добавляется Login-вкладка шестой — становится 6 штук для admin.

**Правило:** если пользователь guest, вкладки Archive и Me — показывать `opacity: 0.4`, при тапе открывать LoginModal вместо навигации.

**Изменение в `handleTabPress`:**
```tsx
const handleTabPress = (tab: Tab) => {
  // Если guest и вкладка требует авторизации — открыть логин
  const authRequired = ['archive', 'me', 'admin'] as const;
  if (isGuest && authRequired.includes(tab.id as typeof authRequired[number])) {
    openLoginModal();
    return;
  }
  if ('action' in tab && tab.action) {
    tab.action();
  } else {
    navigate(tab.path);
  }
};
```

**Убрать Login как отдельную вкладку для guest** (строка `...(isGuest ? [{ id: 'login'... }] : [])`). Вместо этого Me-вкладка при тапе guest открывает LoginModal (уже покрыто правилом выше).

**Стиль для заблокированных вкладок:**
```tsx
className={cn(
  "flex flex-col items-center gap-[3px] py-1 px-2 bg-transparent border-none cursor-pointer transition-colors duration-150",
  active ? "text-text-main" : "text-text-main/30 hover:text-text-main/60",
  isGuest && ['archive', 'me'].includes(tab.id) ? "opacity-40" : ""
)}
```

**Критерий готовности.** Guest видит 4 вкладки (Write, Log, Archive[dim], Me[dim]). Тап на dim-вкладку → LoginModal. Нет отдельной Login-вкладки.

---

## MOB-23 · SessionCard: swipe-to-delete на мобиле никуда не ведёт

**Файл:** `src/features/writing/components/SessionCard.tsx`

**Проблема.** В `handleTouchEnd` есть проверка `if (swipeOffset < -150) { setShowDeleteConfirm(true) }` — свайп влево должен открывать подтверждение удаления. Но `swipeOffset` сбрасывается в 0 до того, как проверка срабатывает из-за порядка вызовов. В итоге свайп влево ничего не делает. Пользователь видит красный фон, отпускает — ничего.

**Проверить** текущий `handleTouchEnd`:
```tsx
const handleTouchEnd = () => {
  if (longPressTimer.current) {
    clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  }
  if (touchStart === null) return;
  if (swipeOffset < -150) {       // ← проверка должна быть ДО сброса
    setShowDeleteConfirm(true);
  }
  setTouchStart(null);
  setSwipeOffset(0);              // ← сброс после проверки — ок
};
```

Если проверка стоит ПОСЛЕ `setTouchStart(null)` — переставить. Также убедиться что `swipeOffset` — ref, а не state (иначе в closure может быть stale-значение).

**Если `swipeOffset` — useState (текущая реализация):** заменить на ref чтобы избежать stale closure:

```tsx
// Заменить:
const [swipeOffset, setSwipeOffset] = useState(0);

// На:
const swipeOffsetRef = useRef(0);
// и везде где setSwipeOffset(x) → swipeOffsetRef.current = x
// В style: transform: `translate3d(${swipeOffsetRef.current}px, 0, 0)` 
// (нужен forceUpdate или использовать motion value)
```

Проще: оставить useState, но убедиться что порядок в handleTouchEnd правильный (проверка ПЕРЕД сбросом).

**Критерий готовности.** Свайп влево на карточке сессии дальше 150px открывает `CancelConfirmModal` с вопросом об удалении.

---

## Приоритеты

| # | Тикет | Приоритет | Усилие | Обоснование |
|---|-------|-----------|--------|-------------|
| MOB-19 | DocumentPreview: sheet снизу | **P1** | S | Самое заметное "десктопное" поведение что осталось |
| MOB-22 | Guest BottomNav | **P1** | S | Пользователь теряется, тапает в никуда |
| MOB-23 | Swipe-to-delete работает | **P2** | S | Анимация есть, действие нет — хуже чем если бы анимации не было |
| MOB-20 | MobileMeScreen paddingTop | **P2** | XS | Двойной отступ на notch |
| MOB-21 | MobilePageHeader variant | **P3** | XS | Полировка типографики |
