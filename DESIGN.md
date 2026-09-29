---
name: justwriting
description: Тихий редактор для свободного письма
colors:
  amethyst-primary: '#7D4FD1'
  amethyst-soft: '#A583E8'
  amethyst-deep: '#4A2A8A'
  night-bg: '#0E0A18'
  night-surface: '#1A1030'
  night-elevated: '#231542'
  night-popup: '#1B1231'
  night-card: '#1A103066'
  lavender-ink: '#F0EBFF'
  lavender-muted: '#9B89CC'
  lavender-border: '#A583E81F'
  success: '#34D399'
  warning: '#FBBF24'
  danger: '#F87171'
typography:
  display:
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif'
    fontSize: '24px'
    fontWeight: 600
    lineHeight: 1.3
  headline:
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif'
    fontSize: '20px'
    fontWeight: 600
    lineHeight: 1.3
  title:
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif'
    fontSize: '16px'
    fontWeight: 500
    lineHeight: 1.4
  editor:
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif'
    fontSize: '18px'
    fontWeight: 400
    lineHeight: 1.6
  body:
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif'
    fontSize: '14px'
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif'
    fontSize: '11px'
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: '0.06em'
  label-xs:
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif'
    fontSize: '10px'
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: '0.08em'
rounded:
  sm: '8px'
  control: '12px'
  md: '16px'
  lg: '24px'
  sheet: '28px'
  full: '9999px'
spacing:
  xs: '2px'
  sm: '4px'
  md: '8px'
  lg: '12px'
  xl: '16px'
  2xl: '24px'
  3xl: '32px'
components:
  button-primary:
    backgroundColor: '{colors.lavender-ink}'
    textColor: '{colors.night-bg}'
    rounded: '{rounded.control}'
    padding: '8px 16px'
  button-secondary:
    backgroundColor: '{colors.night-elevated}'
    textColor: '{colors.lavender-ink}'
    rounded: '{rounded.control}'
    padding: '8px 16px'
  button-ghost:
    textColor: '{colors.lavender-ink}'
    rounded: '{rounded.control}'
    padding: '8px 16px'
  button-brand:
    backgroundColor: '{colors.amethyst-primary}'
    textColor: '#FFFFFF'
    rounded: '{rounded.control}'
    padding: '8px 16px'
  button-danger:
    textColor: '{colors.danger}'
    rounded: '{rounded.control}'
    padding: '8px 16px'
  input:
    backgroundColor: '{colors.night-elevated}'
    textColor: '{colors.lavender-ink}'
    rounded: '{rounded.control}'
    padding: '8px 12px'
  card:
    backgroundColor: '{colors.night-card}'
    textColor: '{colors.lavender-ink}'
    rounded: '{rounded.md}'
    padding: '16px'
  sheet:
    backgroundColor: '{colors.night-card}'
    rounded: '{rounded.sheet}'
  bottom-nav-tab:
    textColor: '{colors.lavender-ink}'
    typography: '{typography.label}'
---

# Design System: justwriting

## 1. Overview

**Creative North Star: "Ночная тетрадь"**

Тёмная тихая комната, лампа над страницей, больше никого. Интерфейс — обложка и поля тетради: он есть, но на него не смотрят. Главное на экране всегда текст пользователя, всё остальное приглушено до 55–60% непрозрачности и проявляется при наведении или по запросу. Палитра по умолчанию — глубокий аметистовый (тема «Аметистовый»): тёплая ночь с фиолетовым оттенком, а не холодный чёрный «для разработчиков».

Плотность низкая, ритм спокойный. Поддержка выражается тоном и мягкими подтверждениями (плавное появление, короткий пульс на достижении цели), а не яркими акцентами. Система отвергает облик Notion-клона: никаких блоков, slash-меню, таблиц свойств и деревьев страниц; настройки — это выбор нескольких хороших вариантов, а не конструктор.

Токены семантические и тематизируемые. Четыре темы (`amethyst` по умолчанию, `notion` = «Тёплый» светлая, `modern` = «Современный» обсидиан, `spotify` = «Энергия» лесной зелёный, плюс `system`: amethyst/notion по `prefers-color-scheme`) переназначают одни и те же слоты в `src/index.css`. Значения во frontmatter — тема по умолчанию; компоненты обязаны ссылаться на слоты (`bg-surface-base`, `text-text-main`, `border-border-subtle`, `bg-brand-primary`), а не на hex.

**Key Characteristics:**

- Тёмная тема по умолчанию, светлая «Тёплый» — полноправная, не второсортная.
- Монохромная иерархия: главное действие — инверсия (светлая кнопка на тёмном), бренд-фиолетовый — редкий акцент.
- Приглушённый хром: вторичные элементы на 55–60% непрозрачности текста.
- Мягкие скругления (12–16px у контролов и карточек, 28px у мобильных шторок).
- Глубина тоном и размытием подложки, почти без теней.
- Движение короткое (≈200 мс) и выключается целиком при `prefers-reduced-motion`.

## 2. Colors

Тонированные нейтрали одного фиолетового оттенка плюс один бренд-акцент; статусные цвета только для статуса.

### Primary

- **Аметист** (`amethyst-primary`): кнопка `brand` (белый текст), фирменные отметки, `theme-color` PWA. Используется точечно — это подпись, не заливка.
- **Мягкий аметист** (`amethyst-soft`): кольцо фокуса у `Button`, пульс «маяка», каретка, скроллбар, `accent-info` в тёмной теме. В светлой теме подменяется на `#6D4BC4`, иначе падает до 2.8:1.
- **Глубокий аметист** (`amethyst-deep`): тёмные подложки бренд-элементов.

### Neutral

- **Ночь** (`night-bg`): фон страницы. В тёмной теме тело залито вертикальным градиентом `#0E0A18 → #130D24 → #1A1030` — это атмосфера комнаты, а не декор.
- **Ночная поверхность / приподнятая / всплывающая** (`night-surface`, `night-elevated`, `night-popup`): ступени глубины для панелей, меню, поповеров.
- **Ночная карточка** (`night-card`): полупрозрачная карточка, через которую проступает фон.
- **Лавандовые чернила** (`lavender-ink`): основной текст и инверсная заливка главной кнопки.
- **Лавандовый приглушённый** (`lavender-muted`): вторичный текст, подписи, метаданные (≈6:1 на `night-bg`).
- **Лавандовая граница** (`lavender-border`): волосяные разделители и обводки, 12% непрозрачности.

### Status

- **Успех / предупреждение / опасность** (`success`, `warning`, `danger`): только тосты, индикаторы синхронизации и журнала активности, деструктивные действия. Формула всегда одна: фон 10–15%, обводка 30%, текст 100% того же цвета.

### Named Rules

**The Borrowed Light Rule.** Бренд-фиолетовый занимает не больше ~10% экрана. Главное действие на экране — инверсия чернил (`bg-text-main text-surface-base`), а не фиолетовая кнопка.

**The Slot Rule.** Ни одного hex в компонентах. Цвет берётся из семантического слота, иначе он сломается в трёх темах из четырёх.

## 3. Typography

**Display Font:** Inter (с `ui-sans-serif, system-ui`)
**Body Font:** Inter
**Editor Font:** выбирает пользователь — Inter (по умолчанию), Lora, Playfair Display, EB Garamond
**Label/Mono Font:** JetBrains Mono — только для чисел в настройках и технических значений

**Character:** Интерфейс говорит одним спокойным гротеском в нескольких весах; голос пользователя может звучать засечками. Шрифты свои (`/fonts/fonts.css`), без Google Fonts — ни один запрос не уходит за рубеж.

### Hierarchy

- **Display** (600, 24px, 1.3): заголовки экранов и модалок.
- **Headline** (600, 20px, 1.3): заголовки секций.
- **Title** (500, 16px, 1.4): заголовки карточек заметок, пункты настроек.
- **Editor** (400, 18px, 1.6): текст в редакторе. Пользователь меняет кегль 14–24px и интерлиньяж 1.2–2.2; ширина колонки по умолчанию 68% (40–100% на десктопе). Засечечный текст получает `text-wrap: pretty` и `hyphens: auto`.
- **Body** (400, 14px, 1.6): интерфейсный текст, сообщения чата, описания.
- **Label** (500, 11px, 0.06em): подписи вкладок нижней навигации, мелкие метки (`.text-label-sm`).
- **Label XS** (500, 10px, 0.08em): метаданные и счётчики (`.text-label`).

### Named Rules

**The Reader's Voice Rule.** Шрифт редактора принадлежит пользователю. Интерфейс не меняет его и не навязывает засечки; Inter в UI остаётся Inter.

**The Quiet Label Rule.** Метки — строчные с лёгкой разрядкой. Капсом-разрядкой над каждой секцией не размечаем.

## 4. Elevation

Глубина строится тоном (card → elevated → popup) и размытием подложки под слоями, которые лежат поверх контента. Тени редкие и мягкие, у карточек в покое их нет.

### Shadow Vocabulary

- **Card** (`box-shadow: 0 4px 20px rgba(0,0,0,0.2)`, `.shadow-card`): приподнятая карточка, `Card variant="elevated"`.
- **Panel** (`box-shadow: -12px 0 40px rgba(0,0,0,0.35)`, `.shadow-panel`): боковые выезжающие панели (журнал, ИИ).
- **Modal** (`box-shadow: 0 0 60px rgba(0,0,0,0.8)`, `.shadow-modal`): модальные окна поверх размытой подложки.
- **Sheet** (`box-shadow: 0 -8px 32px rgba(0,0,0,0.4)`): мобильная шторка снизу.

### Blur Layers

- Подложка модалки: `bg-surface-base/80` + `backdrop-blur-2xl`.
- Подложка шторки: `bg-black/60` + `backdrop-blur-sm`.
- Нижняя навигация и тосты: `bg-surface-card/85` + `backdrop-blur-xl`.

### Z-index

Семантическая шкала в `@theme`: `--z-sidebar` 50 → `--z-overlay` 60 → `--z-panel` 70 → `--z-sheet` 100 → `--z-modal` 110 → `--z-auth` 200 → `--z-critical` 300 (разблокировка, согласие) → `--z-skip` 999. Новые слои встают в эту шкалу, произвольные `z-[9999]` запрещены.

### Named Rules

**The Flat-At-Rest Rule.** Поверхности плоские, пока с ними ничего не происходит. Тень — признак того, что слой поднят над страницей (модалка, шторка, панель).

**The Blur-Is-A-Layer Rule.** Размытие только у слоёв поверх контента (навигация, подложки, тосты). Карточки в ленте не размываются.

## 5. Components

Все общие примитивы лежат в `src/shared/components/`. Сначала переиспользуй их, новый примитив — только если три и больше мест делают одно и то же.

### Buttons (`Button.tsx`)

- **Shape:** мягко скруглённые (12px у `md`/`lg`, 8px у `sm`).
- **Primary:** инверсия чернил — `bg-text-main text-surface-base`, 8×16px, `font-medium`; hover — `opacity-90`.
- **Secondary:** `bg-surface-elevated`, волосяная обводка; hover уходит в `bg-surface-card`.
- **Ghost (по умолчанию):** текст на 60%, hover — 100% и подложка `text-main/8`. Основной вид для второстепенных действий.
- **Brand:** аметист с белым текстом, hover `brightness-110`. Редко: первый вход, ключевое приглашение.
- **Danger:** красный текст с обводкой 30%, hover — подложка 10%.
- **Focus:** `ring-2 ring-brand-soft`. **Loading:** спиннер внутри, кнопка заблокирована. **Disabled:** 50% непрозрачности.

### Chips / Status pills

- **Style:** `rounded-full`, `px-2.5 py-1`, `text-xs font-medium`, фон 15% + обводка 30% + текст статус-цвета.
- **Where:** индикатор журнала активности и синхронизации над нижней навигацией.

### Cards / Containers (`Card.tsx`)

- **Corner Style:** 16px (`rounded-2xl`).
- **Background:** `bg-surface-card` (полупрозрачная в тёмных темах).
- **Border:** `border-border-subtle/50`.
- **Internal Padding:** 16px.
- **Elevated:** `bg-surface-elevated` + `.shadow-card`.
- **Note card:** container query — от 480px карточка раскладывается в две колонки, метаданные слева через 1px разделитель. При прокрутке появляется через `animation-timeline: view()` (только при `no-preference`).

### Inputs / Fields (`Input.tsx`)

- **Style:** `bg-surface-elevated`, 1px `border-border-subtle`, 12px, отступы 8×12px, placeholder `text-subtle/50`.
- **Focus:** `ring-2 ring-brand-primary/50`, без смены обводки.
- **Error:** обводка и кольцо `accent-danger`, текст ошибки 12px под полем с `role="alert"`. **Disabled:** 50%.

### Modals & Sheets (`ModalShell.tsx`)

- **Modal:** по центру, `max-w-lg`, вход `scale 0.95 → 1` + opacity, 220 мс `easeOut`.
- **Sheet (мобильный):** выезд снизу пружиной (`damping 28, stiffness 280`), верхние углы 28px, `max-h-[85vh]`, `pb-safe`.
- **Behaviour:** `role="dialog"`, `aria-modal`, `aria-labelledby`, фокус-трап, Escape, блокировка прокрутки фона. Новые модалки строятся только на `ModalShell`.

### Toasts (`Toast.tsx`)

- Справа внизу над навигацией, `rounded-2xl`, `px-4 py-3`, `text-sm font-medium`, статус-формула 10/30/100 + `backdrop-blur-xl`.
- Появление: снизу вверх с лёгким масштабом; уход: вверх. Необязательное действие — подчёркнутая ссылка 12px.

### Navigation

- **Mobile (`BottomNav.tsx`):** фиксированная панель снизу, `bg-surface-card/85` + `backdrop-blur-xl`, верхняя граница `white/[0.06]`. Вкладки: иконка 22px (штрих 1.6) + подпись `label`. Неактивная — 60%, активная — 100% и `font-semibold`. Лёгкая вибрация 8 мс при нажатии.
- **Desktop (`Sidebar.tsx`):** узкая колонка иконок 40×40px, `rounded-xl`; hover — подложка `text-main/5`; активная — инверсия (`bg-text-main text-surface-base`) + `shadow-lg`.

### Editor (signature)

- Шрифт, кегль, интерлиньяж и ширина колонки — пользовательские.
- **Focus mode:** маска-градиент гасит текст до 30% вне полосы ±45–120px вокруг каретки (`--focus-y`).
- **Zen mode:** хром уходит во время письма.
- **Caret:** цвет — смесь `flow-pulse-color` 70% с цветом текста.

### Motion (сводно)

- Переходы состояний — `transition-colors` 150–300 мс.
- Празднование достижения — `milestone-pulse` (600 мс, масштаб до 1.08) и `celebration-checkmark` (500 мс, лёгкий перелёт). Это единственное разрешённое место перелёта.
- `prefers-reduced-motion: reduce` глушит всё глобально, новые анимации это наследуют.

## 6. Do's and Don'ts

### Do:

- **Do** бери цвет только из семантических слотов (`bg-surface-*`, `text-text-*`, `border-border-subtle`, `bg-brand-*`, `accent-*`) и проверяй экран во всех четырёх темах, светлую «Тёплый» — обязательно.
- **Do** делай главное действие инверсией чернил (`Button variant="primary"`), фиолетовый `brand` — не чаще одного раза на экран.
- **Do** приглушай второстепенный хром до 55–60% и возвращай в 100% при наведении или фокусе.
- **Do** строй модалки на `ModalShell`, кнопки на `Button`, поля на `Input`, карточки на `Card`.
- **Do** держи текст ≥ 4.5:1 во всех темах и цели нажатия ≥ 44px (`.clickable-target-expansion`).
- **Do** пиши сообщения об ошибках бережно: что с заметками и что делать дальше.

### Don't:

- **Don't** превращай продукт в Notion-клон: никаких блоков, slash-команд, баз и таблиц свойств, деревьев вложенных страниц, бесконечной настраиваемости.
- **Don't** вставляй hex-цвета в TSX: они ломают три темы из четырёх.
- **Don't** используй цветную боковую полосу (`border-left` толще 1px) как акцент на карточках, тостах и выносках.
- **Don't** делай градиентный текст (`bg-clip-text`) и неоновое свечение.
- **Don't** размывай и «остекляй» карточки в ленте: blur только у слоёв поверх контента.
- **Don't** вешай капсовую разрядку-«бровь» над каждой секцией.
- **Don't** добавляй стрики, бейджи, конфетти и счётчики-давилки: празднование — один короткий пульс.
- **Don't** выдумывай z-index вне шкалы `--z-*`.
- **Don't** трогай шрифт редактора из интерфейса: он принадлежит пользователю.
