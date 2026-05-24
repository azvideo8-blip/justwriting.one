# Design System Tickets (DS Sprint)

Tickets по результатам аудита дизайн-системы. По приоритету.

---

## DS-01 — Hex-хардкоды: заменить на CSS-переменные

**Severity:** Bug (ломает темы)  
**Scope:** 4 файла, 8 мест

### Проблема

Hex-значения зашиты в компоненты. При переключении темы (amethyst/modern/notion/spotify/stripe) эти цвета не меняются — баг виден на светлых темах.

### Правки

#### `src/features/writing/components/MobileWriteToolbar.tsx` (строки 141–156)

Stream Mode badge — кнопка поверх тулбара:

```tsx
// было:
background: '#ef4444',
color: '#fff',
boxShadow: '0 2px 4px rgba(239, 68, 68, 0.2)',

// стало:
background: 'var(--accent-danger)',
color: 'var(--bg-base)',
boxShadow: '0 2px 4px color-mix(in srgb, var(--accent-danger) 20%, transparent)',
```

#### `src/features/writing/components/MobileWriteScreen.tsx` (строка 234)

Dot-индикатор статуса (paused):

```tsx
// было:
: isPaused ? '#f59e0b' : 'var(--text-subtle)',

// стало:
: isPaused ? 'var(--accent-warning)' : 'var(--text-subtle)',
```

#### `src/features/writing/components/MobileHomeScreen.tsx` (строки 248–255)

Draft restore banner:

```tsx
// было:
background: 'rgba(245,158,11,0.15)',
border: '1px solid rgba(245,158,11,0.3)',
color: '#f59e0b',

// стало:
background: 'color-mix(in srgb, var(--accent-warning) 15%, transparent)',
border: '1px solid color-mix(in srgb, var(--accent-warning) 30%, transparent)',
color: 'var(--accent-warning)',
```

#### `src/features/writing/components/MobileHomeScreen.tsx` (строки 333, 339)

SVG иконка и текст CTA-кнопки — тёмно-зелёный хардкод `#0b1a12`. Этот цвет — contrast-пара для brand-primary в notion-теме, но ломается в других темах. Заменить на `var(--bg-base)` (тёмный контраст к brand-primary во всех темах):

```tsx
// было:
<svg ... fill="#0b1a12">
color: '#0b1a12',

// стало:
<svg ... fill="var(--bg-base)">
color: 'var(--bg-base)',
```

#### `src/features/writing/components/GoalPopup.tsx` (строка 127)

Фон попапа:

```tsx
// было:
background: '#111413',

// стало:
// убрать строку background полностью — bg-surface-card в className уже есть и даёт нужный цвет
```

Проверить: если `bg-surface-card` в className даёт правильный фон — просто удалить `background:` из inline style. Если нет — добавить `background: 'var(--surface-card)'`.

#### `src/features/settings/components/AccountTab.tsx` (строки 382, 440, 488)

`style={{ background: 'var(--brand-primary)' }}` → `className="bg-brand-primary"`. Это не ломает темы (переменная корректная), но нарушает конвенцию — стили через className, не через style:

```tsx
// было:
<button style={{ background: 'var(--brand-primary)' }} className="...">

// стало:
<button className="bg-brand-primary ...">
```

---

## DS-02 — Добавить токены `text-label` и `text-label-sm` в `@theme`

**Severity:** Cleanup / DX  
**Scope:** `src/index.css` — 2 строки. Потом массовый rename ~150 мест.

### Проблема

`text-[10px]` — 71 вхождение, `text-[11px]` — 79 вхождений. Arbitrary values не типобезопасны, не документируются в дизайн-системе.

### Шаг 1 — добавить в `src/index.css` в блок `@theme`:

```css
@theme {
  /* ... существующие токены ... */
  
  /* Label typography tokens */
  --font-size-label: 10px;
  --font-size-label-sm: 11px;
}
```

В Tailwind v4 это автоматически даёт классы `text-label` и `text-label-sm`.

Если нужно задать line-height и letter-spacing — в Tailwind v4 через дополнительные переменные:
```css
--font-size-label--line-height: 1.4;
--font-size-label--letter-spacing: 0.08em;
--font-size-label-sm--line-height: 1.3;
--font-size-label-sm--letter-spacing: 0.06em;
```

### Шаг 2 — массовая замена (после проверки что токены работают):

```bash
# проверить что заменяемые места не имеют особого контекста
grep -rn "text-\[10px\]" src/
grep -rn "text-\[11px\]" src/
```

Заменить `text-[10px]` → `text-label`, `text-[11px]` → `text-label-sm` во всех компонентах.

**Исключения — не заменять:**
- Случаи где рядом есть `leading-[...]` или `tracking-[...]` с нестандартными значениями — проверять вручную
- `text-[9px]` — слишком мелкий, пересмотреть использование (6 мест), не заменять механически

---

## DS-03 — Создать `Button` и `IconButton` как shared компоненты

**Severity:** High / Tech debt  
**Scope:** новый файл `src/shared/components/Button.tsx` + `IconButton.tsx`

### Проблема

8+ несогласованных шаблонов кнопок. Примеры из кодовой базы:

```tsx
// ProfileHero — primary
px-6 py-2 bg-text-main text-surface-base rounded-2xl font-bold

// SettingsPanel tabs — активная вкладка
py-2 px-3 rounded-xl text-sm font-medium bg-text-main text-surface-base

// WritingHeader — icon-only
w-9 h-9 rounded-xl flex items-center justify-center text-text-main/40 hover:text-text-main hover:bg-text-main/5 transition-all

// AccountTab — action
style={{ background: 'var(--brand-primary)' }} rounded-xl px-4 py-2 text-sm font-medium
```

### Технический выбор

Проверить наличие `class-variance-authority` в зависимостях:
```bash
grep "class-variance-authority" package.json
```

- **Если есть** — использовать `cva` для типобезопасных вариантов.
- **Если нет** — реализовать через `cn()` с объектом вариантов. Не устанавливать лишние зависимости.

### Спецификация `Button`

Варианты:
- `primary` — `bg-text-main text-surface-base`, hover darkens
- `ghost` — `text-text-main/50 hover:text-text-main hover:bg-text-main/8`
- `danger` — `text-accent-danger border border-accent-danger/30 hover:bg-accent-danger/10`
- `brand` — `bg-brand-primary text-bg-base`

Размеры:
- `sm` — `px-3 py-1.5 text-sm rounded-lg`
- `md` (default) — `px-4 py-2 text-sm rounded-xl`
- `lg` — `px-6 py-2.5 text-base rounded-xl`

Обязательные props: `variant`, `size`, `children`, стандартные button attrs.

### Спецификация `IconButton`

```tsx
// Фиксированный шаблон — сейчас повторён ~8 раз вручную:
// w-9 h-9 rounded-xl flex items-center justify-center transition-colors

interface IconButtonProps {
  icon: React.ReactNode;
  label: string;           // → aria-label (обязательный)
  size?: 'sm' | 'md';    // sm=w-8 h-8, md=w-9 h-9
  active?: boolean;
  onClick?: () => void;
}
```

`label` — обязательный prop (решает A11Y-02 из соседнего тикета встроенно).

### После создания компонентов

Мигрировать:
1. `WritingHeader.tsx` — все 6 icon-only кнопок → `<IconButton>`
2. `SettingsPanel.tsx` — tab buttons → `<Button variant="ghost">`
3. `AccountTab.tsx` строки 382, 440, 488 → `<Button variant="brand">`
4. `ProfileHero.tsx` CTA → `<Button variant="primary" size="lg">`

---

## DS-04 — Нормировать opacity-шкалу: убрать нестандартные значения

**Severity:** Low / Cleanup  
**Scope:** ~30–40 мест только с нестандартными значениями

### Проблема

14 значений opacity вместо 5 нормированных. Нестандартные (1–10 вхождений каждое):
`/15`, `/35`, `/45`, `/55`, `/65`, `/75`

### Стандарт (не менять):

| Opacity | Семантика |
|---------|-----------|
| `/25` | disabled / decorative |
| `/40` | muted (основной) |
| `/60` | secondary |
| `/80` | subdued |
| `100%` | primary |

### Правило замены нестандартных:

| Нестандартное | → Заменить на |
|---------------|---------------|
| `/15` | `/25` |
| `/35` | `/40` |
| `/45` | `/40` |
| `/55` | `/60` |
| `/65` | `/60` |
| `/75` | `/80` |

### Процесс

```bash
# найти все нестандартные вхождения
grep -rn "text-main\/\(15\|35\|45\|55\|65\|75\)\b" src/
grep -rn "bg-text-main\/\(15\|35\|45\|55\|65\|75\)\b" src/
grep -rn "border-text-main\/\(15\|35\|45\|55\|65\|75\)\b" src/
```

Перед заменой — визуально проверить контрастные случаи. Особенно `/55` → `/60`: уже использовалось в BottomStats.tsx для меток, сдвиг небольшой но стоит посмотреть глазами.

---

## DS-05 — Заменить `transition-all` на `transition-colors`

**Severity:** Low / Performance  
**Scope:** 204 места

### Проблема

`transition-all` анимирует все CSS-свойства включая layout-свойства (`width`, `height`, `padding`, `grid-template-columns`). Для hover-состояний кнопок нужна только `transition-colors`.

Дополнительный аргумент: `transition-all` конфликтует с Framer Motion — когда `AnimatePresence` управляет `opacity`, `transition-all` создаёт двойной easing на том же свойстве.

### Правило замены

```
transition-all → transition-colors
```

**Исключения — оставить `transition-all` или использовать специфичные классы:**

- Компоненты где явно анимируется размер: `Sidebar.tsx` (expand/collapse), `BottomStats.tsx` (прогресс-бар), `HeaderStats.tsx` (если есть resize)
- Элементы с `transition-all` + явным `duration-*` / `ease-*` — проверить вручную

### Процесс

```bash
# посмотреть масштаб
grep -rn "transition-all" src/ | wc -l

# найти с кастомными duration (осторожнее с ними)
grep -rn "transition-all.*duration\|duration.*transition-all" src/
```

Заменять файл за файлом, не одним regex по всему src — легче ревьюить.

---

## Сводная таблица

| Тикет | Severity | Файлы | Приоритет |
|-------|----------|-------|-----------|
| DS-01 | Bug | MobileWriteToolbar, MobileWriteScreen, MobileHomeScreen, GoalPopup, AccountTab | 🔴 Немедленно |
| DS-02 | Cleanup | index.css + ~150 компонентов | 🟡 Следующий спринт |
| DS-03 | Tech debt | новые Button.tsx, IconButton.tsx + 4 места миграции | 🟡 Следующий спринт |
| DS-04 | Cleanup | ~30–40 мест | 🟢 Когда удобно |
| DS-05 | Performance | 204 места | 🟢 Когда удобно |
