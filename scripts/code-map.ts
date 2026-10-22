// HB-4: карта кода. Пишет CODE_MAP.md в корень репозитория: список модулей
// и по одной-две строки о каждом. Описания — словарь ниже, руками; скрипт
// только находит модули на диске и собирает файл. Свежесть сторожит
// scripts/__tests__/codeMap.test.ts: новая папка без описания, описание
// пропавшей папки или устаревший CODE_MAP.md — красный тест.
//
// Запуск: npm run code-map
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Каталоги, каждая подпапка которых — отдельный модуль. */
const GROUPS = ['api', 'src/core', 'src/features', 'src/shared'];
/** Модули-одиночки. */
const SINGLES = ['api', 'deploy', 'e2e', 'public/docs', 'scripts', 'src/app', 'supabase'];

export const DESCRIPTIONS: Record<string, string> = {
  // ── Сервер ИИ и аккаунта ────────────────────────────────────────────
  'api':
    'Node-сервер без фреймворка: `server.ts` поднимает HTTP, `dispatcher.ts` разбирает POST /api/*, `handlers.ts` сопоставляет имя вызова с логикой. Рядом `chat.ts` (стрим чата), `account.ts` (удаление аккаунта), `auth.ts` (проверка JWT), `postgresAiContext.ts` (квоты и данные ИИ в Postgres).',
  'api/admin':
    'Админские вызовы: `admin.logic.ts` — приглашения, список пользователей, удаление с почасовым бюджетом и следом в admin_actions; `supabaseAdmin.ts` — клиент с сервисной ролью.',
  'api/ai':
    'Логика ИИ-вызовов по одному файлу `*.logic.ts` на вызов (чат, правка, эмбеддинги, саммари, фасеты, убеждения, rerank, квота); `provider.ts` — запрос к OpenAI-совместимому шлюзу, `pure.ts` — помощники без базы.',

  // ── Ядро клиента ────────────────────────────────────────────────────
  'src/core/ai':
    'Единая точка вызова сервера `callAi.ts` (согласие, отмена, пул квоты) и флаги согласий и настроек ИИ: `aiConsent.ts`, `indexingConsent.ts`, `portraitEpoch.ts`.',
  'src/core/auth':
    'Провайдер авторизации поверх Supabase Auth: `supabaseAuthProvider.ts`, сохранённая сессия `storedSession.ts`, перезагрузка учётки `accountReload.ts`; вход — `index.ts`.',
  'src/core/constants':
    'Константы ядра: цвета меток `labelColors.ts`, версия политики конфиденциальности `privacyVersion.ts` (переэкспорт из shared/ai).',
  'src/core/crypto':
    'Шифрование заметок: `encrypt.ts` и `cryptoHelpers.ts`, кэш ключа сейфа `keyVaultCache.ts`, код восстановления `recoveryCode.ts`, шифрование меток, стор `useEncryptionStore.ts`.',
  'src/core/data':
    'Доступ к облачным таблицам: `supabaseDataProvider.ts` и по провайдеру на таблицу в `providers/` (документы, черновики, эмбеддинги, саммари, версии, профили); zod-схемы в `schemas.ts`.',
  'src/core/errors':
    'Перевод ошибок в текст для человека: `errorHandler.ts` (ошибки входа), `db-errors.ts` (ошибки базы, лог без uid).',
  'src/core/events':
    'Шина доменных событий `domainEvents.ts` (заметка удалена/сохранена/скрыта от ИИ, сброс аккаунта): слои узнают друг о друге без прямых импортов.',
  'src/core/services':
    'Сервисы данных: документы и версии (`DocumentService.ts`, `LocalDocumentService.ts`, `VersionService.ts`), синк (`SyncService.ts`, `CloudSyncService.ts`, `LocalStoreSyncService.ts`, `ConflictResolver.ts`), экспорт, профиль, шифрование.',
  'src/core/settings':
    'React-контексты настроек: `SettingsProvider.tsx` (открытие панели, переход к разделу), `SettingsContext.tsx`, `WritingSettingsContext.tsx`.',
  'src/core/storage':
    'Локальное хранилище: IndexedDB и её миграции `localDb.ts`, слияние реплик диалога `dialogueMerge.ts`, запрос постоянного хранилища `storagePersistence.ts`.',
  'src/core/supabase':
    'Ленивый клиент Supabase `client.ts`: создаётся при первом обращении, чтобы модуль грузился и без env.',
  'src/core/sync':
    'Механика синка: журналы `syncJournal.ts`, курсор изменений `changeCursor.ts`, блокировка документа `withDocumentLock.ts`, классификация ошибок, статус `useSyncStatus.ts`.',
  'src/core/theme':
    'Тема и фон: `ThemeProvider.tsx`, `ThemeBackground.tsx`, пульсация во время письма `FlowPulse.tsx`.',
  'src/core/utils':
    'Мелкие утилиты ядра: даты `dateUtils.ts`, время `formatTime.ts`, хэш содержимого `contentHash.ts`, заморозка серии `streakFreeze.ts`, стоп-слова, звук.',

  // ── Фичи ────────────────────────────────────────────────────────────
  'src/features/admin':
    'Админка: таблицы пользователей `AdminUsersTable.tsx` и журнала действий `AdminActionsTable.tsx` (только чтение).',
  'src/features/ai':
    'ИИ-собеседник и память: чат (`components/AIPanel.tsx`, `components/chat/`, `hooks/useAIChat.ts`), сборка контекста (`services/chatContext/`, `utils/retrieval/`), эмбеддинги, профиль-фасеты, портрет, диагностика; события шины — `subscribeDomainEvents.ts`.',
  'src/features/archive':
    'Архив заметок: список, сетка, календарь, поиск, метки и теги, корзина, читалка на телефоне; данные — `hooks/useArchiveData.ts`, операции — `services/archiveCrud.ts`, импорт — `services/archiveImport.ts`.',
  'src/features/auth':
    'Вход и учётка: `contexts/AuthContext.tsx`, `pages/LoginPage.tsx`, мастер приглашения, согласие на обработку, перенос гостевых черновиков, уборка локальных данных при смене аккаунта (`services/bootPurge.ts`, `services/lostSessionWipe.ts`).',
  'src/features/encryption':
    'Интерфейс сейфа: ввод пароля `EncryptionPasswordModal.tsx`, показ кода восстановления `RecoveryCodeGate.tsx`, настройка `useEncryptionSetup.ts`.',
  'src/features/navigation':
    'Навигация и статические страницы: `Sidebar.tsx`, `BottomNav.tsx`, лендинг, справка, юридические страницы; история версий в приложении — `data/changelog.ts`.',
  'src/features/profile':
    'Страница профиля: KPI, тепловая карта, ритм по часам, настроение, достижения; статистика — `hooks/useProfileStats.ts`.',
  'src/features/settings':
    'Панель настроек `SettingsPanel.tsx` и её разделы: аккаунт, сейф, ИИ, синк, экспорт и удаление; перенос данных `services/migrationExport.ts` / `migrationImport.ts`.',
  'src/features/writing':
    'Экран письма: редактор `WritingEditor.tsx`, сессия и таймер (`hooks/useSessionFlow.ts`, `store/`), автосохранение черновика `hooks/useDraftAutosave.ts`, диктовка, итог сессии, мобильный экран.',

  // ── Общий слой ──────────────────────────────────────────────────────
  'src/shared/activity':
    'Журнал активности для пользователя `useActivityLogStore.ts`: ошибки, предупреждения, сообщения.',
  'src/shared/ai':
    'Общий с сервером код ИИ: промпты `prompts.ts` и сборщик `buildChatPrompt.ts`, тело запроса `requestConfig.ts`, политика `aiPolicy.ts`, кризисные ресурсы, защита от инъекций и выдуманных цитат.',
  'src/shared/changelog':
    'Какая версия списка изменений уже показана на этом устройстве: `useChangelogSeenStore.ts`.',
  'src/shared/components':
    'UI-кит: `Button.tsx`, `Input.tsx`, `ModalShell.tsx`, `ConfirmDialog.tsx`, `Toast.tsx`, `Menu.tsx`, `ErrorBoundary.tsx`, раскладка `Layout/AppLayout.tsx`.',
  'src/shared/constants':
    'Общие константы: ключи localStorage `storageKeys.ts`, политика паролей `passwordPolicy.ts`.',
  'src/shared/errors':
    'Ошибки и логи: `reportError.ts` (единый вход в журнал активности, сетевые сбои — предупреждением), вычистка персональных данных `piiScrub.ts`, `logger.ts`, перезагрузка при битом чанке `chunkReload.ts`.',
  'src/shared/hooks':
    'Общие React-хуки: раскладка и ширина экрана (`useLayoutMode.ts`, `useNarrowViewport.ts`), клавиатура, фокус-ловушка, голосовой ввод `useSpeechInput.ts`, статус сети.',
  'src/shared/i18n':
    'Переводы и язык: провайдер `index.tsx`, словари по разделам в `translations/`, SEO-теги `SeoHead.tsx`.',
  'src/shared/lib':
    'Замер занятого localStorage: `localStorageUtils.ts`.',
  'src/shared/tests':
    'Тест `errorHandler.test.ts` для перевода ошибок входа.',
  'src/shared/types':
    'Общие типы: `common.ts` (форма отметки времени из старых экспортов).',
  'src/shared/utils':
    'Общие утилиты: `cn.ts`, подсчёт слов, время чтения, заголовки, экспорт и скачивание, векторная математика `vectorMath.ts`, `withTimeout.ts`.',

  // ── Приложение и инфраструктура ─────────────────────────────────────
  'src/app':
    'Каркас приложения: `AppProviders.tsx` (провайдеры), `AppRouter.tsx` / `AppRoutes.tsx` (ленивые маршруты), `AppShell.tsx`, страницы в `pages/` (письмо, архив, ИИ, профиль, настройки, диагностика).',
  'deploy':
    'Конфиги и скрипты выкатки: systemd-юниты, nginx и общие заголовки, бэкапы и учения восстановления (`backup/`), мониторинг (`monitor/`), их тесты (`tests/`).',
  'e2e':
    'Playwright-сценарии: десктопные `*.spec.ts`, стендовые `*.stand.spec.ts`, мобильные в `mobile/` (общий помощник `mobile/harness.ts`).',
  'public/docs':
    'Статическое руководство пользователя: HTML-страницы (`index.html`, `writing.html`, `ai.html`, `security.html` …), стили `docs.css`, скриншоты в `img/`.',
  'scripts':
    'Скрипты сборки и гейтов: CI (`ci/`), храповики knip, i18n и бандла, локальный стенд (`stand/`), бенчмарки ИИ, мутационные проверки (`mutations/`), пререндер, смоук после выкатки.',
  'supabase':
    'Схема базы: SQL-миграции `migrations/`, RLS и прочие SQL-тесты `tests/`, накатка миграций `scripts/migrate.sh`.',
};

function subdirs(root: string, rel: string): string[] {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs, { withFileTypes: true })
    // __tests__ — тесты соседних модулей, не модуль.
    .filter((e) => e.isDirectory() && !e.name.startsWith('__'))
    .map((e) => `${rel}/${e.name}`);
}

/** Модули, которые есть на диске, отсортированные. */
export function listModules(root: string): string[] {
  const found = [
    ...GROUPS.flatMap((g) => subdirs(root, g)),
    ...SINGLES.filter((s) => fs.existsSync(path.join(root, s))),
  ];
  return [...new Set(found)].sort();
}

export function renderMap(root: string): string {
  const lines = listModules(root).map((m) => {
    const desc = DESCRIPTIONS[m];
    if (!desc) throw new Error(`code-map: нет описания для ${m} — допишите в DESCRIPTIONS (scripts/code-map.ts)`);
    return `- \`${m}/\` — ${desc}`;
  });
  return [
    '# Карта кода',
    '',
    '<!-- Сгенерировано scripts/code-map.ts — руками не править. Обновить: npm run code-map -->',
    '',
    'Модули репозитория и за что каждый отвечает. Файл собирается скриптом из словаря описаний; тест `scripts/__tests__/codeMap.test.ts` краснеет, если он устарел.',
    '',
    ...lines,
    '',
  ].join('\n');
}

// argv[1] через симлинк не равен пути модуля — сравниваем реальные пути (как в bundle-compare.ts).
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  fs.writeFileSync(path.join(root, 'CODE_MAP.md'), renderMap(root));
}
