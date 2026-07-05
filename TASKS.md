# Tasks

## Active

## Waiting On

## Someday

## Done

- [x] **PROF-8: Исправление бага мульти-назначения доменов (Minority Domains)** - исправить логику распределения чанков по опорным доменам
- [x] **PROF-9: Обновление центроидов при инкрементальном импорте заметок** - пересчитывать вектор центроида фасета при добавлении новых чанков
- [x] **PROF-10: Интеграция Reranking в поиск ИИ-психолога** - использовать `AIService.rerank` для сокращения и ранжирования контекста
- [x] **PROF-11: Повышение надежности парсинга тем ИИ (XML-теги)** - перевод промпта и парсера суммаризатора фасетов на XML разметку
- [x] **SYNC-1: Офлайн-фолбэк для правок «Cloud Only» заметок** - cloud-only заметки: при ошибке облака создаётся локальная копия, правка применяется локально, задача в syncQueue; локальные заметки: при ошибке облака задача в syncQueue
- [x] **SYNC-2: Глобальный автодренаж очереди синхронизации** - SyncManager в AppProviders слушает восстановление Firestore и browser online, вызывает syncPending глобально
- [x] **SYNC-3: Индикатор «Синхронизация приостановлена»** - useSyncStatus хук, индикатор в Sidebar/BottomNav, текст статуса в настройках
- [x] **SYNC-4: Тесты, закрепляющие «не падает» при сбоях облака** - StorageService.saveVersion resilience + archiveCrud cloud-only fallback + аудит Firestore reads
- [x] **SYNC-5: Авто-ретрай первой облачной загрузки новой заметки** - cleanupDraftsAfterSave кладёт локальный id в syncQueue при отказе syncOne, подхватывается глобальным дренажом (SYNC-2)
- [x] **SYNC-6: Офлайн-устойчивое удаление заметки** - StorageService.deleteDocument: локальное удаление сразу, облачное в try/catch с постановкой в syncQueue (type:'delete') при отказе; SyncService дренирует delete/portrait/document задачи раздельно
- [x] **SYNC-7: Офлайн-устойчивое сохранение ИИ-портрета** - AIProfileService.savePortrait кладёт задачу в syncQueue (type:'portrait') при отказе облака вместо throw; реальная запись вынесена в CloudSyncService.syncPortraitToCloud (core), чтобы SyncService не импортировал features/ai
- [x] **UI-081: Мягкие офлайн-предупреждения** - ai_error_offline вместо зависаний в useAIChat/AIPanel/useDiagnosticsData для онлайн-only действий
- [x] **DIAG-012: Вкладка «Очередь» в Диагностике** - QueueExplorer.tsx: просмотр/синхронизация по одному/всё/очистка (с подтверждением) содержимого syncQueue
