# TOMORROW_TICKETS — Незакрытые тикеты после коммита ea98472

> Все тикеты с актуальными строками кода на момент ea98472.
> 15 незакрытых тикетов.

---

## P1 — HIGH

---

### T-01 · LifeLogPanel: захардкоженные русские «ч» и «м» — не работают на английском

**Файл**: `src/features/writing/components/LifeLogPanel.tsx:78-80`

**Проблема**: В блоке daily summary буквы «ч» (часы) и «м» (минуты) — hardcoded кириллица. При языке `en` пользователь видит «1ч 30м» вместо «1h 30m».

**БЫЛО** (строка 78-80):
```tsx
{summary.totalMinutes >= 60
  ? `${Math.floor(summary.totalMinutes / 60)}ч ${summary.totalMinutes % 60}м`
  : `${summary.totalMinutes}м`}
```

**СТАЛО**:
```tsx
{summary.totalMinutes >= 60
  ? `${Math.floor(summary.totalMinutes / 60)}${t('unit_hour')} ${summary.totalMinutes % 60}${t('unit_min')}`
  : `${summary.totalMinutes}${t('unit_min')}`}
```

**Добавить в `src/core/i18n/index.tsx`**:
```tsx
unit_hour: { ru: 'ч', en: 'h' },
```
Ключ `unit_min` уже существует: `{ ru: 'м', en: 'm' }`.

**Критерий приёмки**:
- [ ] При языке `en`: «1h 30m», «45m»
- [ ] При языке `ru`: «1ч 30м», «45м»
- [ ] Нет hardcoded кириллицы в LifeLogPanel

---

### T-02 · useModalEscape: ESC в input/textarea закрывает модал вместо очистки поля

**Файл**: `src/shared/hooks/useModalEscape.ts:8-11`

**Проблема**: Хук слушает ESC глобально на `document` без проверки `e.target`. Если фокус в `<input>` (например, ввод пароля в PasswordPromptModal), ESC закрывает модал вместо того чтобы дать полю обработать нажатие нативно.

**БЫЛО**:
```tsx
const handleKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    onClose();
  }
};
```

**СТАЛО**:
```tsx
const handleKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      return;
    }
    onClose();
  }
};
```

**Критерий приёмки**:
- [ ] ESC при фокусе вне input — модал закрывается
- [ ] ESC при фокусе в input/textarea — модал НЕ закрывается
- [ ] GoalPopup input обрабатывает ESC самостоятельно (в своём `onKeyDown`), не конфликтует

---

### T-03 · BetaBottomNav: Life Log кнопка без active-индикатора

**Файл**: `src/features/navigation/components/BetaBottomNav.tsx:55-72`

**Проблема**: Все навигационные кнопки показывают точку `bg-text-main` под иконкой при активном состоянии. Кнопка Life Log — всегда `bg-transparent`. Пользователь не видит, открыт LifeLog или нет.

**БЫЛО** (строка 64-66):
```tsx
<button
  onClick={onOpenLifeLog}
  className={cn(
    "flex flex-col items-center justify-center gap-0.5 p-2.5 rounded-2xl transition-all duration-200 min-w-[48px]",
    "text-text-main/50 hover:text-text-main"     // ← всегда одинаковый цвет
  )}
  aria-label={t('lifelog_tab_log')}
>
  <PanelRight size={20} />
  <div className="w-1 h-1 rounded-full bg-transparent" />   // ← всегда невидимая
</button>
```

**СТАЛО**:
```tsx
// Добавить lifeLogVisible из useWritingSettings:
const { betaLifeLog, lifeLogVisible } = useWritingSettings();

// Кнопка:
<button
  onClick={onOpenLifeLog}
  className={cn(
    "flex flex-col items-center justify-center gap-0.5 p-2.5 rounded-2xl transition-all duration-200 min-w-[48px]",
    lifeLogVisible
      ? "text-text-main"
      : "text-text-main/50 hover:text-text-main"
  )}
  aria-label={t('lifelog_tab_log')}
>
  <PanelRight size={20} />
  <div className={cn(
    "w-1 h-1 rounded-full transition-all duration-200",
    lifeLogVisible ? "bg-text-main" : "bg-transparent"
  )} />
</button>
```

**Критерий приёмки**:
- [ ] Когда LifeLog открыт — точка видна (`bg-text-main`), иконка яркая
- [ ] Когда LifeLog закрыт — точки нет, иконка приглушена
- [ ] Переход анимирован (`transition-all duration-200`)

---

### T-04 · handleBetaStop: визуальный flicker (paused → idle)

**Файл**: `src/features/writing/pages/WritingPage.tsx` — функция `handleBetaStop`

**Проблема**: При нажатии Stop в beta-режиме:
```ts
useWritingStore.getState().setStatus('paused');     // ← UI переключается на paused
await handleBetaSave();                               // ← async задержка
useWritingStore.getState().setStatus('idle');          // ← UI переключается на idle
```
Пользователь видит кратковременную вспышку: кнопка Pause становится disabled, Play — активной, потом всё сбрасывается.

**БЫЛО**:
```ts
const handleBetaStop = async () => {
  if (sessionStatus === 'idle') return;
  useWritingStore.getState().setStatus('paused');
  await handleBetaSave();
  useWritingStore.getState().setStatus('idle');
};
```

**СТАЛО** — убрать промежуточный `'paused'`:
```ts
const handleBetaStop = async () => {
  if (sessionStatus === 'idle') return;
  await handleBetaSave();
  useWritingStore.getState().setStatus('idle');
};
```

**Критерий приёмки**:
- [ ] Нет визуального flicker при нажатии Stop
- [ ] Сессия сохраняется корректно
- [ ] После Stop — статус idle

---

### T-05 · BetaSidebar: неполная клавиатурная навигация — нет ArrowUp/Down и Escape

**Файл**: `src/features/navigation/components/BetaSidebar.tsx`

**Проблема**: В коммите ea98472 добавлен только `onKeyDown Enter` на навигационные кнопки (строка 64). Но:
- Нет ArrowUp/ArrowDown для перемещения между элементами
- Нет Escape для сворачивания sidebar
- Нет `role="menubar"` / `role="menuitem"` для screen readers
- Кнопка Life Log не имеет `onKeyDown` вообще

**БЫЛО** (строка 63-64):
```tsx
<button
  key={item.id}
  onClick={() => navigate(item.path)}
  onKeyDown={(e) => { if (e.key === 'Enter') navigate(item.path); }}
```

**СТАЛО** — заменить инлайн-обработчики на общий `onKeyDown` на `<nav>`:

1. Обновить `<nav>`:
```tsx
<nav
  className="flex-1 flex flex-col gap-1 px-2"
  role="menubar"
  onKeyDown={(e) => {
    const items = Array.from(
      e.currentTarget.querySelectorAll('[role="menuitem"]')
    ) as HTMLElement[];
    const idx = items.indexOf(document.activeElement as HTMLElement);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = items[(idx + 1) % items.length];
      next?.focus();
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = items[(idx - 1 + items.length) % items.length];
      prev?.focus();
    }
    if (e.key === 'Escape') {
      setExpanded(false);
    }
  }}
>
```

2. На каждую nav-кнопку добавить `role="menuitem"` и `tabIndex={0}`:
```tsx
<button
  key={item.id}
  onClick={() => navigate(item.path)}
  role="menuitem"
  tabIndex={0}
  // убрать инлайн onKeyDown — Enter/Space обрабатываются нативно
  aria-current={location.pathname === item.path ? 'page' : undefined}
  className={cn(...)}
>
```

3. На кнопку Life Log — тоже `role="menuitem"`:
```tsx
{betaLifeLog && (
  <button
    onClick={() => setLifeLogVisible(!lifeLogVisible)}
    role="menuitem"
    tabIndex={0}
    aria-label={t('lifelog_tab_log')}
    className={cn(...)}
  >
```

**Критерий приёмки**:
- [ ] ArrowDown перемещает фокус на следующий элемент
- [ ] ArrowUp — на предыдущий
- [ ] Escape сворачивает sidebar
- [ ] Enter/Space активирует навигационную кнопку
- [ ] `role="menubar"` + `role="menuitem"` для accessibility
- [ ] Life Log кнопка включена в навигацию

---

### T-15 · BetaHeaderStats: нет click-outside handler для GoalPopup — РЕГРЕСС

**Файл**: `src/features/writing/components/BetaHeaderStats.tsx`

**Проблема**: В старом WritingHeader был `useEffect` с `document.addEventListener('mousedown')` для закрытия попапов при клике вне word/time блоков. При выносе в BetaHeaderStats этот обработчик **не был перенесён**. Теперь GoalPopup можно закрыть только:
- Кликнув внутрь попапа (preset/custom)
- Нажав ESC (внутри GoalPopup)
- Кликнув на другой stat-block

Но клик в **любое другое место** на странице не закрывает попап.

**Решение** — добавить click-outside handler в BetaHeaderStats:
```tsx
useEffect(() => {
  const handler = (e: MouseEvent) => {
    if (
      wordBlockRef.current && !wordBlockRef.current.contains(e.target as Node) &&
      timeBlockRef.current && !timeBlockRef.current.contains(e.target as Node)
    ) {
      setWordPopupOpen(false);
      setTimePopupOpen(false);
    }
  };
  document.addEventListener('mousedown', handler);
  return () => document.removeEventListener('mousedown', handler);
}, []);
```

**Критерий приёмки**:
- [ ] Клик вне stat-блоков закрывает GoalPopup
- [ ] Клик внутри GoalPopup не закрывает его

---

## P2 — MEDIUM

---

### T-06 · LifeLogPanel: добавить кнопку удаления сессии

**Файл**: `src/features/writing/components/LifeLogPanel.tsx`

**Проблема**: В SessionItem можно только кликнуть для продолжения. Нет способа удалить сессию из LifeLog — нужно идти в Архив.

**Решение**:

1. Обновить SessionItem — добавить `onDelete` и иконку корзины:
```tsx
import { Trash2 } from 'lucide-react';

interface SessionItemProps {
  session: Session;
  isActive: boolean;
  onClick: () => void;
  onDelete?: (session: Session) => void;
  t: (key: string) => string;
  language: string;
}

const SessionItem = ({ session, isActive, onClick, onDelete, t, language }: SessionItemProps) => {
  // ... существующий код ...
  return (
    <div
      onClick={onClick}
      className={cn(
        "group px-3 py-2.5 border-b border-border-subtle cursor-pointer transition-all",
        isActive
          ? "bg-surface-base border-l-2 border-l-text-main pl-[10px]"
          : "hover:bg-surface-base/50"
      )}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[13px] font-medium text-text-main truncate max-w-[130px]">
          {session.title || t('common_untitled')}
        </span>
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-text-main/40 shrink-0">{timeStr}</span>
          {onDelete && session.id && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(session); }}
              className="opacity-0 group-hover:opacity-100 p-1 rounded-lg text-text-main/30 hover:text-red-400 transition-all"
              aria-label={t('session_delete')}
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>
      {/* ... остальной JSX без изменений ... */}
    </div>
  );
};
```

2. В LifeLogPanel — добавить стейт для delete confirm:
```tsx
import { useState } from 'react';
import { CancelConfirmModal } from './modals/CancelConfirmModal';
import { SessionService } from '../services/SessionService';

// Внутри компонента:
const [deleteTarget, setDeleteTarget] = useState<Session | null>(null);
const { sessionGroups, summary, loading, refresh } = useLifeLog(userId);

// В SessionItem внутри маппинга:
<SessionItem
  key={session.id}
  session={session}
  isActive={false}
  onClick={() => onContinueSession(session)}
  onDelete={(s) => setDeleteTarget(s)}
  t={t}
  language={language}
/>

// В конец JSX (перед </motion.div>):
<CancelConfirmModal
  isOpen={!!deleteTarget}
  title={t('session_delete_confirm')}
  description={t('admin_confirm_delete_session')}
  confirmLabel={t('session_delete')}
  cancelLabel={t('common_cancel')}
  onConfirm={async () => {
    if (deleteTarget?.id) {
      await SessionService.deleteSession(deleteTarget.id);
      refresh();
    }
    setDeleteTarget(null);
  }}
  onCancel={() => setDeleteTarget(null)}
/>
```

**Критерий приёмки**:
- [ ] При hover на SessionItem появляется иконка корзины (правый верхний угол)
- [ ] Клик на корзину → CancelConfirmModal
- [ ] Подтверждение → сессия удаляется из Firestore, список обновляется
- [ ] Нет кнопки удаления для unsaved-сессий (без `session.id`)

---

### T-07 · LifeLogPanel: добавить поиск по заметкам

**Файл**: `src/features/writing/components/LifeLogPanel.tsx`

**Проблема**: При большом количестве сессий — только скролл. Нет поиска по заголовку или содержимому.

**Решение**:

1. Добавить стейт и фильтрацию:
```tsx
import { useState, useMemo } from 'react';

// Внутри LifeLogPanel:
const [searchQuery, setSearchQuery] = useState('');

const filteredGroups = useMemo(() => {
  if (!searchQuery.trim()) return sessionGroups;
  const q = searchQuery.toLowerCase();
  return sessionGroups
    .map(group => ({
      ...group,
      sessions: group.sessions.filter(s =>
        (s.title || '').toLowerCase().includes(q) ||
        (s.content || '').toLowerCase().includes(q)
      )
    }))
    .filter(group => group.sessions.length > 0);
}, [sessionGroups, searchQuery]);
```

2. JSX — search bar после header, перед daily summary:
```tsx
{activeTab === 'log' && (
  <div className="flex flex-col h-full overflow-hidden">
    {/* Search */}
    <div className="px-3 py-2 border-b border-border-subtle">
      <input
        type="text"
        value={searchQuery}
        onChange={e => setSearchQuery(e.target.value)}
        placeholder={t('lifelog_search_placeholder')}
        className="w-full bg-surface-base rounded-xl px-3 py-2 text-sm text-text-main placeholder:text-text-main/30 outline-none border border-border-subtle focus:border-text-main/30"
      />
    </div>
    {/* Daily summary — без изменений */}
    {/* Sessions list — заменить sessionGroups на filteredGroups */}
```

3. Заменить `sessionGroups` на `filteredGroups` в рендере списка и в empty-чеке.

4. Добавить i18n-ключ в `src/core/i18n/index.tsx`:
```tsx
lifelog_search_placeholder: { ru: 'Поиск по заметкам...', en: 'Search notes...' },
```

**Критерий приёмки**:
- [ ] Search bar виден в LifeLog под табами
- [ ] Ввод текста фильтрует сессии по title и content
- [ ] Пустой результат → «Нет сессий»
- [ ] Очистка поля → полный список

---

### T-08 · LoadingSpinner: заменить тернарную цепь на маппинг

**Файл**: `src/shared/components/LoadingSpinner.tsx`

**Проблема**: Размер задаётся цепью `size === 10 ? "w-10 h-10" : size === 8 ? ...`. Фоллбэк `w-${size} h-${size}` не работает с Tailwind JIT — динамические классы не генерируются.

**БЫЛО**:
```tsx
export function LoadingSpinner({ size = 10 }: LoadingSpinnerProps) {
  return (
    <div 
      className={cn(
        "border-4 rounded-full animate-spin border-surface-base/10 border-t-text-main",
        size === 10 ? "w-10 h-10" : size === 8 ? "w-8 h-8" : size === 6 ? "w-6 h-6" : size === 5 ? "w-5 h-5" : `w-${size} h-${size}`
      )} 
    />
  );
}
```

**СТАЛО**:
```tsx
const sizeMap: Record<number, string> = {
  4: 'w-4 h-4',
  5: 'w-5 h-5',
  6: 'w-6 h-6',
  8: 'w-8 h-8',
  10: 'w-10 h-10',
  12: 'w-12 h-12',
  16: 'w-16 h-16',
};

export function LoadingSpinner({ size = 10 }: LoadingSpinnerProps) {
  return (
    <div 
      className={cn(
        "border-4 rounded-full animate-spin border-surface-base/10 border-t-text-main",
        sizeMap[size] ?? 'w-10 h-10'
      )} 
    />
  );
}
```

**Критерий приёмки**:
- [ ] Работает для всех предопределённых размеров
- [ ] Фоллбэк — `w-10 h-10` для неизвестных
- [ ] Нет `w-${size}` — динамических Tailwind-классов

---

### T-09 · BetaToolbar: визуальная иерархия — разделить файловые и транспортные кнопки

**Файл**: `src/features/writing/components/BetaToolbar.tsx`

**Проблема**: Все 7 кнопок (New, Open, Save, Play, Pause, Stop, Fullscreen) выглядят одинаково — `w-10 h-10 rounded-xl border border-border-subtle`. Нет визуальной разницы между файловыми операциями и управлением сессией. Активная транспортная кнопка лишь чуть ярче (`border-text-main/30`).

**Решение** — дифференцировать стили:

1. Файловые кнопки (New, Open, Save) — приглушённые:
```tsx
className="w-10 h-10 rounded-xl border border-border-subtle/60 bg-surface-base/30 flex items-center justify-center text-text-main/50 hover:text-text-main hover:border-border-subtle hover:bg-surface-base/50 shadow-sm transition-all"
```

2. Активная Play — белый акцент:
```tsx
className="w-10 h-10 rounded-xl border border-text-main/40 text-text-main bg-text-main/5 hover:bg-text-main/10 shadow-sm transition-all"
```

3. Активная Pause — amber акцент (пауза = внимание):
```tsx
className="w-10 h-10 rounded-xl border border-amber-400/40 text-amber-400 bg-amber-400/5 hover:bg-amber-400/10 shadow-sm transition-all"
```

4. Активная Stop — red акцент (остановка = опасность):
```tsx
className="w-10 h-10 rounded-xl border border-red-400/40 text-red-400 bg-red-400/5 hover:bg-red-400/10 shadow-sm transition-all"
```

5. Disabled транспорт — почти невидимый:
```tsx
className="w-10 h-10 rounded-xl border border-border-subtle/40 text-text-main/15 cursor-not-allowed transition-all"
```

6. Fullscreen — как файловая (приглушённый):
```tsx
className="w-10 h-10 rounded-xl border border-border-subtle/60 bg-surface-base/30 flex items-center justify-center text-text-main/50 hover:text-text-main hover:border-border-subtle hover:bg-surface-base/50 shadow-sm transition-all"
```

**Критерий приёмки**:
- [ ] Файловые кнопки визуально отделены от транспортных
- [ ] Активная Play — белый акцент
- [ ] Активная Pause — amber
- [ ] Активная Stop — red
- [ ] Disabled кнопки почти невидимы (opacity ~15%)
- [ ] Fullscreen выглядит как файловая операция

---

## P3 — LOW

---

### T-10 · BetaSidebar: плавная анимация появления лейблов при раскрытии

**Файл**: `src/features/navigation/components/BetaSidebar.tsx:48-52` (логотип), `68-72` (nav items), `88-92` (Life Log)

**Проблема**: Лейблы навигации появляются через `opacity` transition (200ms), но sidebar расширяется через `width` transition (300ms). Из-за разницы скорости текст появляется до того, как ширина перестала расти — рваная анимация.

**БЫЛО** (пример — лейбл nav item):
```tsx
<span className={cn(
  "text-sm font-medium whitespace-nowrap transition-opacity duration-200",
  expanded ? "opacity-100" : "opacity-0"
)}>
  {item.label}
</span>
```

**СТАЛО** — `max-width` + `overflow-hidden` анимация:
```tsx
<span className={cn(
  "text-sm font-medium whitespace-nowrap overflow-hidden transition-all duration-300",
  expanded ? "opacity-100 max-w-[160px] ml-0" : "opacity-0 max-w-0 ml-[-4px]"
)}>
  {item.label}
</span>
```

Применить тот же паттерн к:
- Лейбл «justwriting» (строка 48-52)
- Nav item лейблы (строка 68-72)
- Life Log лейбл (строка 88-92)

**Критерий приёмки**:
- [ ] При раскрытии — лейблы плавно «выезжают» слева направо
- [ ] При сворачивании — плавно «уезжают»
- [ ] Нет рваной анимации/моргания
- [ ] Duration = 300ms, как у width transition

---

### T-11 · CancelConfirmModal: добавить variant (danger / warning)

**Файл**: `src/features/writing/components/modals/CancelConfirmModal.tsx`

**Проблема**: Красный X-круг подходит для «удаление», но модал используется и для «отмена сессии» (не удаление — сброс прогресса), и для «delete сессии» из SessionCard. Одинаковая иконка для разных по смыслу действий сбивает пользователя.

**СТАЛО**:

1. Добавить `variant` в интерфейс:
```tsx
import { AlertTriangle } from 'lucide-react';

interface CancelConfirmModalProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning';
}
```

2. Иконка по variant:
```tsx
const variantConfig = {
  danger: { bg: 'bg-red-500/10', text: 'text-red-500', icon: <X size={32} /> },
  warning: { bg: 'bg-amber-500/10', text: 'text-amber-500', icon: <AlertTriangle size={32} /> },
};
const v = variantConfig[variant || 'danger'];
```

3. Заменить инлайн-иконку:
```tsx
// Было:
<div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto bg-red-500/10 text-red-500">
  <X size={32} />
</div>

// Стало:
<div className={cn("w-16 h-16 rounded-full flex items-center justify-center mx-auto", v.bg, v.text)}>
  {v.icon}
</div>
```

4. Обновить вызовы:
```tsx
// CancelConfirmModal — отмена сессии (warning):
<CancelConfirmModal variant="warning" ... />

// SessionCard — удаление (danger, default):
<CancelConfirmModal variant="danger" ... />  // или без variant
```

**Критерий приёмки**:
- [ ] `variant="danger"` (default) — красный X
- [ ] `variant="warning"` — amber AlertTriangle
- [ ] Существующие вызовы без variant работают как раньше

---

### T-12 · LifeLogPanel: dual control (externalTab + internalTab) — сделать fully controlled

**Файл**: `src/features/writing/components/LifeLogPanel.tsx:58-61`

**Проблема**: LifeLogPanel принимает `activeTab` и `onTabChange` как **опциональные** пропсы, но имеет внутренний `internalTab`-стейт. Это dual control — источник багов: родитель может не обновлять `activeTab`, а компонент будет использовать internal.

**БЫЛО**:
```tsx
interface LifeLogPanelProps {
  userId: string;
  onContinueSession: (session: Session) => void;
  onClose: () => void;
  activeTab?: 'log' | 'settings';              // опциональный
  onTabChange?: (tab: 'log' | 'settings') => void;  // опциональный
  pinned?: boolean;
  onTogglePin?: () => void;
}

// Внутри:
const [internalTab, setInternalTab] = useState<'log' | 'settings'>('log');
const activeTab = externalTab || internalTab;
const setActiveTab = (tab: 'log' | 'settings') => {
  if (onTabChange) onTabChange(tab);
  else setInternalTab(tab);
};
```

**СТАЛО** — обязательные пропсы, без internal state:
```tsx
interface LifeLogPanelProps {
  userId: string;
  onContinueSession: (session: Session) => void;
  onClose: () => void;
  activeTab: 'log' | 'settings';              // обязательный
  onTabChange: (tab: 'log' | 'settings') => void;  // обязательный
  pinned?: boolean;
  onTogglePin?: () => void;
}

// Внутри:
// Удалить internalTab
// Использовать activeTab напрямую
```

WritingPage уже передаёт оба: `activeTab={lifeLogTab} onTabChange={setLifeLogTab}`.

**Критерий приёмки**:
- [ ] Нет `internalTab` стейта в LifeLogPanel
- [ ] `activeTab` и `onTabChange` — обязательные пропсы
- [ ] TypeScript ошибка если пропсы не переданы

---

### T-13 · WritingPage: переименовать `_wordCount` → `wordCount`

**Файл**: `src/features/writing/pages/WritingPage.tsx:46`

**Проблема**: `const _wordCount = useWritingStore(s => s.wordCount)` — `_`-префикс обычно означает unused variable. Но переменная **используется**: в `handleBetaSave` (строка ~89: `_wordCount === 0`) и в `WritingFinishModal` (строка ~107: `wordCount={_wordCount}`). Это вводит в заблуждение.

**БЫЛО**:
```tsx
const _wordCount = useWritingStore(s => s.wordCount);
```

**СТАЛО**:
```tsx
const wordCount = useWritingStore(s => s.wordCount);
```

Обновить все ссылки:
- `handleBetaSave`: `_wordCount === 0` → `wordCount === 0`
- `handleBetaSave`: `[... _wordCount ...]` → `[... wordCount ...]`
- `WritingFinishModal`: `wordCount={_wordCount}` → `wordCount={wordCount}`

**Критерий приёмки**:
- [ ] Нет `_wordCount` в файле
- [ ] TypeScript компилируется без ошибок
- [ ] Функциональность не изменилась

---

### T-14 · BetaSidebar: кнопка Life Log без `aria-label`

**Файл**: `src/features/navigation/components/BetaSidebar.tsx:81`

**Проблема**: Кнопка Life Log имеет `title={t('lifelog_tab_log')}`, но нет `aria-label`. Для screen readers `title` недостаточно — он не озвучивается при навигации клавиатурой.

**БЫЛО** (строка 81):
```tsx
<button
  onClick={() => setLifeLogVisible(!lifeLogVisible)}
  className={cn(...)}
  title={t('lifelog_tab_log')}
>
```

**СТАЛО**:
```tsx
<button
  onClick={() => setLifeLogVisible(!lifeLogVisible)}
  className={cn(...)}
  title={t('lifelog_tab_log')}
  aria-label={t('lifelog_tab_log')}
>
```

**Критерий приёмки**:
- [ ] Кнопка Life Log имеет `aria-label`

---

## Сводка

| ID | P | Файл | Суть |
|----|---|------|------|
| T-01 | P1 | LifeLogPanel + i18n | «ч»/«м» → `t('unit_hour')`/`t('unit_min')` |
| T-02 | P1 | useModalEscape.ts | ESC в input не закрывает модал |
| T-03 | P1 | BetaBottomNav.tsx | Life Log active-индикатор |
| T-04 | P1 | WritingPage.tsx | Убрать flicker handleBetaStop |
| T-05 | P1 | BetaSidebar.tsx | ArrowUp/Down + Escape + role |
| T-15 | P1 | BetaHeaderStats.tsx | **РЕГРЕСС**: нет click-outside для GoalPopup |
| T-06 | P2 | LifeLogPanel.tsx | Кнопка удаления сессии |
| T-07 | P2 | LifeLogPanel.tsx + i18n | Поиск по заметкам |
| T-08 | P2 | LoadingSpinner.tsx | sizeMap вместо тернарной цепи |
| T-09 | P2 | BetaToolbar.tsx | Цветовая иерархия кнопок |
| T-10 | P3 | BetaSidebar.tsx | Анимация лейблов |
| T-11 | P3 | CancelConfirmModal.tsx | variant: danger/warning |
| T-12 | P3 | LifeLogPanel.tsx | Fully controlled tabs |
| T-13 | P3 | WritingPage.tsx | `_wordCount` → `wordCount` |
| T-15 | P3 | BetaSidebar.tsx | aria-label на Life Log |

**Итого**: 15 незакрытых тикетов (6×P1, 4×P2, 5×P3), включая 1 регресс.

---

*Создано: 2026-04-17, актуально после коммита ea98472*
