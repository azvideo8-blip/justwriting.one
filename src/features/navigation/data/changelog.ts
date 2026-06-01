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
    version: '0.7.9',
    date: '2026-06-01',
    items: [
      { category: 'fix', ru: 'ИИ-чат снова работает: потоковый эндпойнт /api/chat падал с ошибкой 500 на каждый запрос (сломанный ESM-импорт промптов после рефактора), из-за чего чат уходил в запасной режим и упирался в лимит — импорт исправлен, стриминг восстановлен', en: 'AI chat works again: the streaming /api/chat endpoint was returning 500 on every request (a broken ESM prompt import after refactoring), forcing the chat into fallback mode and into the rate limit — the import is fixed and streaming is restored' },
      { category: 'fix', ru: 'Исправлены ошибки «Недостаточно прав» при сохранении анализа заметки, психологического портрета и части операций в архиве — в продакшене были устаревшие правила доступа к базе; актуальные правила выкачены заново', en: 'Fixed "Missing or insufficient permissions" errors when saving a note analysis, the psychological portrait, and some archive operations — production had stale database access rules; the current rules were redeployed' },
      { category: 'improvement', ru: 'Безопасность ИИ: общий суточный лимит теперь проверяется во всех ИИ-функциях (редактирование, анализ, проверка промпта), а не только в чате; усилена защита от инъекций (нейтрализация служебных маркеров и невидимых Unicode-символов); смена роли пользователя стала согласованной между базой и токеном с откатом при сбое', en: 'AI security: the global daily cap is now enforced across all AI functions (edit, summarize, prompt validation), not just chat; input is hardened against more injection vectors (control markers and zero-width Unicode); changing a user role is now consistent between the database and the auth token, with rollback on failure' },
      { category: 'fix', ru: 'Целостность данных: при переполнении локального хранилища версия больше не «теряется» с отметкой об успешном сохранении; редактор заметки теперь действительно сохраняет изменённые теги; устранён бесконечный индикатор загрузки в списке документов', en: 'Data integrity: when local storage is full, a version is no longer "lost" while the session is marked saved; the note editor now actually persists edited tags; fixed an infinite loading spinner in the documents list' },
      { category: 'improvement', ru: 'Надёжность: чтение документов и версий устойчиво к рассинхрону схемы (записи больше не пропадают молча), массовые операции с тегами/лейблами больше не «съедают» ошибки; добавлен индекс базы для статистики ИИ (теперь в репозитории и деплоится автоматически)', en: 'Reliability: document and version reads tolerate schema drift (records no longer vanish silently), bulk tag/label operations no longer swallow errors; added the database index for AI usage stats (now version-controlled and auto-deployed)' },
      { category: 'improvement', ru: 'Под капотом: ремедиация внешнего аудита кода (с отсевом ложных срабатываний) — ограничение параллельной загрузки из облака, таймауты и единый механизм автосохранения черновика, аналитика убрана с критического пути ИИ, удалён мёртвый код, добавлены переводы и тесты; вся проверочная батарея зелёная (линт, типы, сборка функций, 399 тестов)', en: 'Under the hood: external code-audit remediation (with false positives filtered out) — bounded concurrency for cloud loading, timeouts and a unified draft-autosave mechanism, analytics moved off the AI critical path, dead code removed, translations and tests added; the full check suite is green (lint, types, functions build, 399 tests)' },
    ],
  },
  {
    version: '0.7.8',
    date: '2026-05-31',
    items: [
      { category: 'improvement', ru: 'Технический аудит и наведение порядка под капотом: исправлены все ошибки линтера, крупные экраны (Диагностика, ИИ, Синхронизация) разбиты на части, добавлены тесты бэкенда и их автоматический прогон в CI', en: 'Technical audit and under-the-hood cleanup: fixed all linter errors, split the large screens (Diagnostics, AI, Sync) into smaller pieces, and added backend tests that now run automatically in CI' },
      { category: 'improvement', ru: 'Усилена защита ИИ-эндпойнта: входящие сообщения и текст документа очищаются от служебных маркеров перед отправкой в модель; ограничен размер поля психологического портрета в правилах базы', en: 'Hardened the AI endpoint: incoming messages and document text are stripped of control markers before reaching the model; the psychological-portrait field size is now capped in the database rules' },
      { category: 'improvement', ru: 'Глобальный суточный лимит ИИ теперь считается по одному агрегатному счётчику вместо сканирования всех записей на каждый запрос — быстрее и дешевле', en: 'The global daily AI limit is now computed from a single aggregate counter instead of scanning every record on each request — faster and cheaper' },
      { category: 'improvement', ru: 'Промпты персон сведены к единому источнику — устранён риск рассинхрона между потоковым чатом и облачной функцией; синхронизированы схемы проверки запросов', en: 'Persona prompts unified into a single source — removes drift between the streaming chat and the Cloud Function; request validation schemas were synced' },
      { category: 'fix', ru: 'Улучшена диагностика сбоев ИИ-запросов — ошибки модели теперь логируются для быстрого разбора', en: 'Improved diagnosis of AI request failures — model errors are now logged for quick triage' },
    ],
  },
  {
    version: '0.7.7',
    date: '2026-05-31',
    items: [
      { category: 'fix', ru: 'ИИ-чат «Собеседник» теперь раскрывается на весь экран: убраны лишние отступы, диалог и поле ввода занимают всю высоту и ширину окна, исправлено выравнивание сообщений', en: 'The AI "Companion" chat now opens full-screen: removed stray padding so the conversation and input fill the viewport height and width, and fixed message alignment' },
      { category: 'fix', ru: 'Ответы ИИ больше не обрываются на полуслове: увеличен лимит вывода модели, а Service Worker перестал «резать» потоковую передачу (устранены обрывы стрима и ошибки «failed to fetch»)', en: 'AI replies no longer get cut off mid-sentence: raised the model output limit and stopped the Service Worker from interrupting the response stream (fixes truncated streams and "failed to fetch" errors)' },
      { category: 'new', ru: 'Дашборд расхода ИИ в админ-диагностике: статистика запросов и токенов по пользователям за день, суммарные итоги и сравнение с лимитами тарифа Gemini API Tier 1 (RPD / RPM / TPM) с прогресс-барами и индикатором превышения', en: 'Admin AI-usage dashboard: per-user daily request/token stats, totals, and a comparison against Gemini API Tier 1 limits (RPD / RPM / TPM) with progress bars and an over-limit indicator' },
      { category: 'new', ru: 'Глобальные суточные лимиты ИИ на бэкенде — общий потолок запросов и токенов по всем пользователям (с учётом сбросов), настроенный под тариф Gemini Tier 1, чтобы не превышать лимиты модели; настраивается через переменные окружения', en: 'Global daily AI caps on the backend — a project-wide ceiling on requests and tokens across all users (including resets), tuned to the Gemini Tier 1 plan so the model limits are never exceeded; configurable via environment variables' },
      { category: 'fix', ru: 'Статистика и лимиты ИИ теперь корректно записываются и читаются: потоковый чат (/api/chat) и облачные функции переведены на одну базу данных Firestore, расход токенов фиксируется для всех запросов, добавлен надёжный откат на облачную функцию при сбое стриминга', en: 'AI stats and limits are now recorded and read correctly: the streaming chat (/api/chat) and the Cloud Functions were unified onto a single Firestore database, token usage is recorded for every request, and a robust fallback to the Cloud Function was added when streaming fails' },
      { category: 'fix', ru: 'Сброс суточного лимита ИИ снова работает — и в таблице пользователей, и вручную по UID; добавлен защитный бюджет, блокирующий сброс при аномально высоком общем расходе; отключена принудительная проверка App Check на ИИ-функциях (вызывала ложные internal-ошибки)', en: 'Resetting the daily AI limit works again — both from the users table and manually by UID; a safety budget now blocks resets when overall usage is abnormally high; enforced App Check on the AI functions was disabled (it caused spurious internal errors)' },
      { category: 'fix', ru: 'Психологический портрет пользователя: исправлена генерация (раньше сохранялся «отказ» старой персоны) и добавлена кнопка «Сгенерировать / Обновить» в диагностике', en: 'User psychological portrait: fixed generation (it used to save an old persona’s "refusal") and added a "Generate / Refresh" button in diagnostics' },
    ],
  },
  {
    version: '0.7.6',
    date: '2026-05-30',
    items: [
      { category: 'improvement', ru: 'Полный редизайн экрана «Собеседник» (ИИ-чат) в фирменном стиле: монограммы-аватары в цвете персоны, шапка с ролью персоны, ответы ИИ в формате письма с цветной линейкой, градиентные сообщения пользователя, обновлённый список диалогов', en: 'Full redesign of the AI "Companion" (chat) screen in brand style: persona-coloured monogram avatars, header with the persona’s role, letter-style AI replies with a coloured rule, gradient user bubbles, refreshed dialogue list' },
      { category: 'new', ru: 'Кнопка ⓘ на персонах открывает описание и системный промпт; свои персоны можно редактировать (промпт/имя) и удалять, встроенные — только просмотр', en: 'An ⓘ button on personas opens their description and system prompt; custom personas can be edited (prompt/name) and deleted, built-in ones are read-only' },
      { category: 'improvement', ru: 'Поле ввода ИИ-чата растянуто на всю ширину; убрана дублирующая кнопка «Прикрепить заметку» (доступна в меню «+»)', en: 'AI chat input now spans the full width; removed the duplicate "Attach note" button (still available in the "+" menu)' },
      { category: 'fix', ru: 'На экране письма шестерёнка «Настройки» открывает закрепляемую панель (вкладка в Life Log): при закреплении редактор сдвигается, а панель больше не перекрывает текст', en: 'On the writing screen, the Settings gear opens the pinnable panel (Life Log tab): when pinned the editor shifts aside instead of being covered by the panel' },
      { category: 'fix', ru: 'ИИ-эндпойнт /api/chat: исправлена ошибка ESM-импорта firebase-admin, обновлены модель и ключ Gemini', en: 'AI endpoint /api/chat: fixed the firebase-admin ESM import error, updated the Gemini model and API key' },
      { category: 'fix', ru: 'Надёжный разбор ключа сервисного аккаунта Firebase: поддержка обёрнутых кавычек и ключей без внешних фигурных скобок', en: 'Robust parsing of the Firebase service-account key: handles wrapped quotes and keys missing the outer curly braces' },
      { category: 'fix', ru: 'Firestore переведён на long-polling в продакшене — убраны ошибки ERR_QUIC_PROTOCOL_ERROR в консоли', en: 'Firestore forced to long-polling in production — removes ERR_QUIC_PROTOCOL_ERROR console noise' },
    ],
  },
  {
    version: '0.7.5',
    date: '2026-05-29',
    items: [
      { category: 'improvement', ru: 'Полное удаление legacy-функционала сессий и очистка кодовой базы от следов коллекции sessions', en: 'Complete removal of legacy sessions functionality and database cleanup of the sessions collection' },
      { category: 'improvement', ru: 'Удаление неиспользуемых сервисов и хуков: SessionService, WritingSessionService, AdminSessionService, LocalSessionLoader, useSessionList, firestore-migrate-versions', en: 'Removed obsolete services and hooks: SessionService, WritingSessionService, AdminSessionService, LocalSessionLoader, useSessionList, firestore-migrate-versions' },
      { category: 'improvement', ru: 'Рефакторинг SyncService (удалена миграция старых сессий) и SyncDiagnostics (удалена вкладка legacy сессий)', en: 'Refactored SyncService (removed legacy session migrations) and SyncDiagnostics (removed legacy session listings)' },
      { category: 'fix', ru: 'Очистка правил базы данных firestore.rules и схемы firebase-blueprint.json от путей /sessions/{sessionId}', en: 'Deleted paths and schemas for /sessions/{sessionId} from firestore.rules and firebase-blueprint.json' },
      { category: 'fix', ru: 'Удален неиспользуемый параметр sessionId из Cloud Function editWithAI', en: 'Removed unused sessionId parameter from editWithAI Cloud Function' },
    ],
  },
  {
    version: '0.7.4',
    date: '2026-05-29',
    items: [
      { category: 'new', ru: 'Ленивая клиентская миграция легаси-сессий с сохранением исторических меток времени и количества сессий в IndexedDB/Firestore', en: 'Client-side lazy migration of legacy sessions with strict preservation of original timestamps and session counts in IndexedDB/Firestore' },
      { category: 'new', ru: 'Разрешение конфликтов оффлайн/онлайн синхронизации через форкинг конфликтных копий', en: 'Offline sync conflict resolution via cloning/forking of conflict-marked copies' },
      { category: 'new', ru: 'Очередь промисов (Mutex Lock) в StorageService для сериализации параллельных сохранений', en: 'Promise Queue (Mutex Lock) in StorageService to serialize concurrent saves' },
      { category: 'improvement', ru: 'Общая папка src/shared/ai/ с Zod-схемами и промптами для совместного использования на бэкенде и фронтенде; обновление Zod до v4', en: 'Shared src/shared/ai/ folder with Zod schemas and prompts shared across Cloud Functions and Edge routes; backend Zod upgraded to v4' },
      { category: 'improvement', ru: 'Инфраструктурные сервисы (VersionService, LocalVersionService, DiffService) перенесены в core/services для устранения циклических импортов', en: 'Versioning and diff services (VersionService, LocalVersionService, DiffService) moved to core/services to eliminate circular imports' },
      { category: 'improvement', ru: 'Декомпозиция WritingPageUI на EditorPanel и TimerDisplay, стабилизация коллбеков play/pause таймера', en: 'Decomposed WritingPageUI into EditorPanel and TimerDisplay, stabilizing play/pause callbacks to avoid stale closures' },
      { category: 'improvement', ru: 'Интеграция Feature Flags на базе Firebase Remote Config и добавление регламентов эксплуатации (ops runbooks)', en: 'Added Firebase Remote Config Feature Flags integration and operations runbooks' },
      { category: 'improvement', ru: 'Оптимизация сборки Vite (manualChunks разделение кода) и динамическое хеширование кэша Service Worker', en: 'Optimized Vite bundling with manualChunks splitting and dynamic Service Worker cache versions' },
      { category: 'fix', ru: 'Обработка исключений в useEncryptionStore при недоступности localStorage с возвратом false', en: 'Improved exception handling in useEncryptionStore with a safe false fallback on localStorage errors' },
      { category: 'fix', ru: 'Устранено дублирование логирования Sentry (reportError) в DocumentService.ts', en: 'Removed double error logging to Sentry in DocumentService.ts' },
    ],
  },
  {
    version: '0.7.3',
    date: '2026-05-29',
    items: [
      { category: 'new', ru: 'Отдельный пароль-сейф для шифрования, независимый от пароля аккаунта (envelope-шифрование: мастер-ключ оборачивает ключ данных)', en: 'Separate vault password for encryption, independent of the account password (envelope encryption: master key wraps the data key)' },
      { category: 'new', ru: 'Миграция со старого формата ключей на новый — заметки перешифровываются без потери данных', en: 'Migration from the legacy key format — notes are re-encrypted with no data loss' },
      { category: 'new', ru: 'Массовый экспорт всех заметок в ZIP (отдельные .md-файлы) в «Настройки → Аккаунт»', en: 'Bulk export of all notes to a ZIP of separate .md files in Settings → Account' },
      { category: 'new', ru: 'Диагностика: бейдж «Encrypted» для уже зашифрованных облачных заметок и кнопка шифрования отдельного документа', en: 'Diagnostics: "Encrypted" badge for already-encrypted cloud notes and a per-document encrypt button' },
      { category: 'fix', ru: 'Зашифрованные облачные заметки больше не экспортируются и не показываются в архиве как шифротекст — расшифровываются при разблокированном сейфе', en: 'Encrypted cloud-only notes no longer export or appear in the archive as ciphertext — they are decrypted when the vault is unlocked' },
      { category: 'fix', ru: 'Архив автоматически обновляется после разблокировки сейфа', en: 'Archive refreshes automatically after the vault is unlocked' },
      { category: 'fix', ru: 'Принятие политики конфиденциальности: исправлена ошибка прав Firestore (privacyAcceptedAt / privacyVersion)', en: 'Privacy policy acceptance: fixed Firestore permission error (privacyAcceptedAt / privacyVersion)' },
      { category: 'fix', ru: 'Вход для аккаунтов со старым форматом шифрования', en: 'Login fixed for accounts on the legacy encryption format' },
      { category: 'improvement', ru: 'Минимальная длина пароля-сейфа увеличена до 8 символов', en: 'Vault password minimum length raised to 8 characters' },
      { category: 'improvement', ru: 'Включение облачной синхронизации предлагает настроить шифрование', en: 'Enabling cloud sync prompts you to set up encryption' },
    ],
  },
  {
    version: '0.7.2',
    date: '2026-05-28',
    items: [
      { category: 'new', ru: 'Реальный стриминг ИИ: ответ появляется по словам в реальном времени через Vercel AI SDK + Gemini 2.5 Flash', en: 'Real AI streaming: response appears word by word in real time via Vercel AI SDK + Gemini 2.5 Flash' },
      { category: 'new', ru: 'Серверная проверка лимита: дневной счётчик хранится в Firestore, подделать нельзя', en: 'Server-side limit enforcement: daily counter stored in Firestore, cannot be faked' },
      { category: 'improvement', ru: 'Страница диагностики: дерево документов с раскрывающимися версиями и превью контента', en: 'Diagnostics page: document tree with expandable versions and content preview' },
      { category: 'fix', ru: 'Роль администратора: исправлено исчезновение после смены подхода к проверке прав', en: 'Admin role: fixed disappearing after changing auth verification approach' },
      { category: 'fix', ru: 'Страница диагностики: исправлен маршрут — теперь открывается корректно', en: 'Diagnostics page: fixed route — now opens correctly' },
      { category: 'fix', ru: 'Счётчик лимита ИИ: убран вызов устаревшей Cloud Function getAILimit, теперь читается напрямую из Firestore', en: 'AI limit counter: removed outdated getAILimit Cloud Function call, now reads directly from Firestore' },
    ],
  },
  {
    version: '0.7.1',
    date: '2026-05-27',
    items: [
      { category: 'improvement', ru: 'ИИ-чат: эффект печатания для ответов — символы появляются постепенно', en: 'AI chat: typewriter effect for responses — characters appear gradually' },
      { category: 'improvement', ru: 'Ответы ИИ отображаются в Markdown: жирный, курсив, списки, заголовки', en: 'AI responses rendered as Markdown: bold, italic, lists, headings' },
      { category: 'improvement', ru: 'ИИ-чат без заметки: можно начать разговор без привязки к тексту, прикрепить опционально', en: 'AI chat without a note: start a conversation freely, attach a note optionally' },
      { category: 'new', ru: 'Кнопка «Отправить в ИИ» в окне завершения сессии', en: '"Send to AI" button in the session finish modal' },
      { category: 'new', ru: 'Cloud Function getAILimit — счётчик лимита синхронизируется с сервером', en: 'getAILimit Cloud Function — daily limit counter synced from server' },
      { category: 'improvement', ru: 'AIPanel в редакторе проверяет лимит до запроса и показывает ошибку', en: 'AIPanel in editor checks limit before request and shows error' },
      { category: 'improvement', ru: 'Описания персон вынесены в i18n — переводятся на оба языка', en: 'Persona descriptions moved to i18n — translated into both languages' },
      { category: 'improvement', ru: 'Аналитика PostHog: требует явного согласия через localStorage, optIn/optOut API', en: 'PostHog analytics: requires explicit consent via localStorage, optIn/optOut API' },
      { category: 'improvement', ru: 'Проверка роли админа через ID Token Claims, а не через profile (защита от подмены)', en: 'Admin role verified via ID Token Claims, not profile (prevents spoofing)' },
      { category: 'fix', ru: 'editWithAI: транзакция Firestore вместо последовательных reads — нет race condition', en: 'editWithAI: Firestore transaction instead of sequential reads — no race condition' },
      { category: 'fix', ru: 'editWithAI: enforceAppCheck включён; история сообщений санируется перед отправкой в Gemini', en: 'editWithAI: enforceAppCheck enabled; message history sanitised before sending to Gemini' },
      { category: 'fix', ru: 'Смена пароля: при ошибке Firebase Auth откат ключей шифрования в Firestore', en: 'Password change: encryption keys rolled back in Firestore if Firebase Auth update fails' },
      { category: 'improvement', ru: 'Service Worker: раздельный кеш для навигации (stale-while-revalidate) и ассетов', en: 'Service Worker: separate navigation cache (stale-while-revalidate) and assets cache' },
      { category: 'improvement', ru: 'CSP: добавлены object-src none, base-uri self, form-action self; COOP/CORP заголовки', en: 'CSP: added object-src none, base-uri self, form-action self; COOP/CORP headers' },
    ],
  },
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
