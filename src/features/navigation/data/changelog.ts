export type ChangelogCategory = 'new' | 'fix' | 'improvement' | 'accessibility';

export interface ChangelogItem {
  category: ChangelogCategory;
  ru: string;
  en: string;
}

export interface ChangelogRelease {
  version: string;
  date: string;
  items: ChangelogItem[];
}

export const CHANGELOG: ChangelogRelease[] = [
  {
    version: '0.7.0',
    date: '2026-05-26',
    items: [
      { category: 'new', ru: 'Раздел ИИ — чат с персонами на основе твоих заметок', en: 'AI section — chat with personas based on your notes' },
      { category: 'new', ru: '5 встроенных персон: Группа психологов, КПТ-психолог, Редактор, Коуч, Журналист', en: '5 built-in personas: Psychology Panel, CBT Therapist, Editor, Coach, Journalist' },
      { category: 'new', ru: 'Создание собственных персон с эмодзи и промптом', en: 'Create custom personas with emoji and a system prompt' },
      { category: 'new', ru: 'Загрузка заметки в диалог — ИИ видит текст и настроение', en: 'Load a note into the chat — the AI sees your text and mood' },
      { category: 'new', ru: 'Анализ заметки: тональность, ключевые слова, темы, инсайты', en: 'Note analysis: tone, key words, themes, insights' },
      { category: 'new', ru: 'AI-бейдж на карточках обработанных заметок в архиве', en: 'AI badge on processed note cards in the archive' },
      { category: 'new', ru: 'Портрет пользователя — агрегированный анализ всех заметок, экспорт в .md', en: 'User portrait — aggregate analysis of all notes, export to .md' },
      { category: 'new', ru: 'История диалогов с ИИ: архив, скачивание в .md, удаление', en: 'AI dialogue history: archive, download as .md, delete' },
      { category: 'new', ru: 'Лимит 5 запросов в день — счётчик виден в интерфейсе', en: '5 requests per day limit — counter visible in the UI' },
      { category: 'new', ru: 'Политика конфиденциальности — модал при первом входе', en: 'Privacy policy — modal on first login' },
      { category: 'new', ru: 'Тогл автосинхронизации в настройках — можно синхронизировать вручную', en: 'Auto-sync toggle in settings — manual sync option' },
      { category: 'new', ru: 'Скрытая страница диагностики — 5 тапов по версии в настройках', en: 'Hidden diagnostics page — tap the version number 5 times in settings' },
      { category: 'new', ru: 'Раздел AI Usage в админке — статистика токенов по пользователям', en: 'AI Usage section in admin — per-user token statistics' },
      { category: 'improvement', ru: 'Бэкенд: Node.js 20 → 22, firebase-functions 5 → 7', en: 'Backend: Node.js 20 → 22, firebase-functions 5 → 7' },
    ],
  },
  {
    version: '0.6.11',
    date: '2026-05-26',
    items: [
      { category: 'improvement', ru: 'SEO: canonical, hreflang, Open Graph, Twitter Card, JSON-LD во всех страницах', en: 'SEO: canonical, hreflang, Open Graph, Twitter Card, JSON-LD across all pages' },
      { category: 'new', ru: 'Страница /features с описанием возможностей', en: 'New /features page with product overview' },
      { category: 'new', ru: 'OG-изображение 1200×630 для превью в соцсетях', en: 'OG image 1200×630 for social media previews' },
      { category: 'improvement', ru: 'Sitemap.xml и Sitemap-директива в robots.txt', en: 'sitemap.xml and Sitemap directive in robots.txt' },
      { category: 'improvement', ru: 'Пре-рендер уникальных мета-тегов для каждой публичной страницы', en: 'Per-route meta prerender for all public pages' },
      { category: 'fix', ru: 'Убран эмодзи ⚠️ из предупреждения о сбросе пароля — добавлена иконка', en: 'Removed ⚠️ emoji from password reset warning — replaced with an icon' },
      { category: 'improvement', ru: '"Сессия завершена." вместо "Отличная работа!" — тише и честнее', en: '"Session complete." instead of "Great job!" — quieter and more honest' },
      { category: 'improvement', ru: 'Достижения переименованы: убраны "бог", "воин", "король", "фанатизм"', en: 'Achievements renamed: removed "god", "warrior", "king", "fanatic"' },
    ],
  },
  {
    version: '0.6.10',
    date: '2026-05-25',
    items: [
      { category: 'fix', ru: 'Продолжение из ЛайфЛога теперь подгружает текст в редактор', en: 'Continuing from LifeLog now loads text into the editor' },
      { category: 'fix', ru: 'Кнопка «пин» в ЛайфЛоге корректно сдвигает редактор, не ломая макет', en: 'LifeLog pin button now correctly pushes the editor sideways' },
      { category: 'fix', ru: 'При продолжении сессия не запускается автоматически — нужно нажать Старт', en: 'Resuming a session no longer auto-starts the timer — press Start to begin' },
      { category: 'fix', ru: 'Тост «цель по словам выполнена» больше не появляется ложно при открытии длинного текста', en: 'Word goal toast no longer fires incorrectly when loading a long document' },
      { category: 'new', ru: '7-дневный мини-график написанных слов в панели ЛайфЛог', en: '7-day mini word-count bar chart in the LifeLog panel' },
      { category: 'fix', ru: 'Три кнопки финиш-модала в одну строку: Вернуться · Пропустить · Сохранить', en: 'Finish modal: three buttons in one row — Go Back · Skip · Save' },
      { category: 'fix', ru: 'Размер числа серии в финиш-модале уменьшен; линия между кружками убрана', en: 'Streak number in finish modal is smaller; chain line between dots removed' },
      { category: 'new', ru: 'Страница «История обновлений» по адресу /changelog', en: 'Release notes page at /changelog' },
      { category: 'fix', ru: 'Двойной скроллбар на странице заметок', en: 'Double scrollbar on the notes page' },
    ],
  },
  {
    version: '0.6.9',
    date: '2026-05-25',
    items: [
      { category: 'fix', ru: 'Сетка в архиве теперь показывает карточки нормального размера — без растягивания на весь экран', en: 'Archive grid cards no longer stretch to full width' },
      { category: 'fix', ru: 'Восстановлена группировка заметок по дням в режиме сетки', en: 'Date grouping in grid mode restored' },
      { category: 'fix', ru: 'Скроллбар стал фиолетовым', en: 'Scrollbar is now purple' },
    ],
  },
  {
    version: '0.6.8',
    date: '2026-05-25',
    items: [
      { category: 'improvement', ru: 'Кнопка настроек перенесена в боковую панель — доступна всегда, не только в редакторе', en: 'Settings button moved to the sidebar — always accessible' },
      { category: 'improvement', ru: 'Лог сессий теперь открывается поверх редактора, не сдвигая его', en: 'Session log now overlays the editor instead of pushing it' },
      { category: 'improvement', ru: 'Панель слева теперь полупрозрачная — как все остальные панели', en: 'Left sidebar is now translucent to match other panels' },
      { category: 'accessibility', ru: 'Кнопки «Пауза» и «Стоп» теперь читаются экранными читалками', en: 'Play/Pause/Stop buttons now work with screen readers' },
      { category: 'accessibility', ru: 'Контраст вторичного текста повышен во всех темах', en: 'Secondary text contrast improved across all themes' },
      { category: 'accessibility', ru: 'В режиме потока появилось уведомление о том, что удаление заблокировано', en: 'Stream mode now shows a notification when deletion is blocked' },
      { category: 'fix', ru: '«НЕТ СВЯЗИ С БАЗОЙ ДАННЫХ» → «Нет подключения. Проверь интернет.»', en: '"NO CONNECTION TO DATABASE" → "No connection. Check your internet."' },
      { category: 'fix', ru: 'Кнопка старта на мобильном: «ПОЕХАЛИ!» → «Начать»', en: 'Mobile start button: "GO!" → "Start"' },
      { category: 'new', ru: 'При первом входе в zen-режим появляется подсказка как вернуть интерфейс', en: 'First-time zen mode hint: how to bring the UI back' },
    ],
  },
  {
    version: '0.6.7',
    date: '2026-05-24',
    items: [
      { category: 'new', ru: 'Полная адаптация под мобильные устройства', en: 'Full mobile adaptation' },
      { category: 'new', ru: 'Управление сохранением через bottom-sheet по долгому нажатию', en: 'Save status control via long-press bottom sheet' },
      { category: 'new', ru: 'Автопауза при переходе приложения в фон', en: 'Auto-pause when app goes to background' },
      { category: 'new', ru: 'Нативный экспорт через Web Share API на мобильных', en: 'Native export via Web Share API on mobile' },
    ],
  },
  {
    version: '0.6.5',
    date: '2026-05-24',
    items: [
      { category: 'fix', ru: 'Исправлено 22 проблемы надёжности и обработки ошибок', en: 'Fixed 22 reliability and error handling issues' },
    ],
  },
  {
    version: '0.6.0',
    date: '2026-03-25',
    items: [
      { category: 'new', ru: 'Таймер «Закончить к...» — пишешь к дедлайну с обратным отсчётом', en: '"Finish by..." timer — write to a deadline with countdown' },
      { category: 'new', ru: 'Режим «Полностью локально» и шифрование заметок (AES-256)', en: 'Fully Local mode and note encryption (AES-256)' },
    ],
  },
];
