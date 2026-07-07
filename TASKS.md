# Tasks

## Active

## Waiting On

## Someday

## Done

- [x] **DESIGN-11: AI composer textarea still ~35px wide at 640px viewport** - dialogs-list column capped max-w-[180/200px] below md, send/stop buttons collapse to icon-only below md; measured live: 34px→209px at 640px, no regression at 1280px (286px list, 675px textarea)
- [x] **DESIGN-12: webVitals.ts still statically imports posthog-js** - now imports shared getPosthog()/hasConsent() from analytics.ts; verified in fresh build: modulepreload for vendor-analytics gone from dist/index.html, main chunk only reaches it via dynamic import()
- [x] **DESIGN-13: Sidebar.tsx had 5 more transition-all instances** - all replaced with named properties (opacity/max-width/margin-left, opacity/height/padding); grep confirms zero transition-all left in the file
- [x] **DESIGN-2: Hardcoded colors bypass theme tokens, break theme-notion (light theme)** - StreakDots.tsx, DiagnosticsPage.tsx, ProfileHero.tsx now use var(--...) tokens; verified live in theme-notion
- [x] **DESIGN-3: Sidebar inactive-icon contrast fails WCAG on theme-notion** - opacity bumped /40→/55; recomputed 3.97:1 (was 2.55:1)
- [x] **DESIGN-4: Framer Motion x/y shorthand not hardware-accelerated** - all 10 listed files converted to transform strings, verified via diff
- [x] **DESIGN-5: transition-all used instead of specific properties (main instances)** - fixed everywhere except 5 leftover spots in Sidebar.tsx, see DESIGN-13
- [x] **DESIGN-6: Click targets below 44x44px on desktop toolbar/nav** - IconButton clickable-target-expansion + SidebarNavItem 44px, verified live
- [x] **DESIGN-7: /features page identical 2x3 feature-card grid** - first+last feature promoted to highlighted asymmetric cards, verified live
- [x] **DESIGN-9: Settings uses raw emoji icons vs rest-of-app lucide-react** - clean emoji→icon prop rename, verified no emoji remains
- [x] **DESIGN-10: Duplicate CTA copy on /features** - both CTAs now "Начать писать", verified live
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
