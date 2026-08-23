# Tasks

## Active

- [ ] **MEM-0: Grounded citations in chat answers** - 🔴 Foundational trust skin for memory features
  - Ref-tag injected notes with `[#<documentId> · <YYYY-MM-DD>]` in `useAIChatContext.buildContext`
  - Add citation contract to `PERSONA_PROMPTS` in `src/shared/ai/prompts.ts`, `functions/src/shared/prompts.ts`, and `api/chat.ts`
  - Render clickable source chips in `AIPage.tsx` for `[#id]` tokens to preview notes
  - Implement defensive guard to neutralize out-of-context citation tags after generation
  - Migrate regression test to `scripts/ai/citation_faithfulness.mjs`
- [ ] **MEM-1: Visible, removable memory scope + hard-scoped retrieval** - 🔴 Boundary visibility and filtering
  - Render a removable scope chip in `AIPage.tsx` chat header, clearable by clicking
  - Hard-scope note candidates filtering in retrieval path before search/ranking
  - Implement distinct period labeling for comparison mode (e.g., "весна vs осень")
  - Inject honesty marker for periods with insufficient notes to prevent confabulation
- [ ] **MEM-2: Consent-based people resolution** - 🟡 Propose aliases instead of silent identity merging
  - Create new IDB store `aiPersonAliases`
  - Implement local suggestion heuristic based on co-occurrence + embedding proximity
  - Build consent UI for suggestions: confirm / reject / rename / undo
  - Use only confirmed alias sets for cross-label resolution in `AIPeopleService.search`
- [ ] **MEM-3: Correction loops: exclude a source, fix a mention** - 🟡 User control over AI data sources
  - Exclude source option on chip: re-run synthesis with selected note removed
  - Fix mention option: detach note from a person's alias set with confirm/undo
  - Keep actions local, reversible, and within budget (no new LLM calls except re-synthesis)
- [ ] **MEM-4: Decision-outcome journal** - 🟢 (P2) Learn from writer's decisions without claiming causation
  - Group decisions locally using `commitments` and thread machinery (SEAM-4/5)
  - Display decision outcomes grouped by prior context and follow-ups with MEM-0 citations
  - Label outcomes explicitly as correlation, not causation (e.g., "после этого решения в заметках...")
  - Allow user to mark misgrouped decisions as unrelated

- [x] **TIMER-1: «Успеть к 22:30» срабатывает на первой секунде сессии** - 🔴 (аудит р6) видимый пользователю баг, одна строка
  - `useTimerStore.ts:74,157,186` кладут в `sessionStartWallMs` значение `_startWallMs`, а это `performance.now()` — миллисекунды от загрузки страницы, не epoch
  - Потребитель на `:124` делает `new Date(sessionStartWallMs)` → 1970 год → `now >= target` истинно всегда → тост и салют сразу после старта
  - Фикс: хранить `Date.now()` отдельным полем; `_startWallMs` обязан остаться монотонным — на нём считается сам таймер (`:59`)
  - Тест зелёный из-за фикстуры с настоящим epoch (`writingStore.test.ts:132`) — поправить фикстуру, иначе регресс не ловится
  - Не зависит от CI, можно делать сразу
  - Тикет: `docs/ag-timer1-wall-clock-ticket.md`

- [ ] **DEBT-1: Похудение основного бандла** - 🟡 порог CI поднят до фактического, вес не тронут
  - `index-*.js` = 800 113 байт; порог в `ci.yml` поднят 750000 → 810000 как храповик (2026-08-21)
  - Разбирать по `bundle-stats.html`; осторожно с `manualChunks` — он здесь уже ломал сборку
  - Готово, когда вес ниже 750000 и порог опущен обратно

## Waiting On

- [ ] **C4-1: Удалить дерево Firebase** - 🔴 разблокирует пять находок и делает CI зелёным впервые с 3 августа
  - Удаляются `functions/`, `firestore.rules`, `storage.rules`, `firebase.json`, два `firestore.indexes*.json`, `firebase-blueprint.json` — все семь на месте, проверено
  - Из CI уходят пять шагов, из `dependabot.yml` — блок `/functions`
  - **Предусловия:** финальный экспорт из Firestore, выключить проекты Firebase и Vercel в консолях, убедиться что приложение живо — и только потом удалять код
  - Тикет: `docs/ag-c4-remove-firebase-tree-ticket.md`

- [ ] **QUOTA-1: Один аккаунт может забить диск** - 🟡 (#25)
  - `versions` без ограничения числа строк, `tags`/`pinned_thoughts` — безразмерный jsonb вопреки комментариям в DDL
  - **Сначала проверить**: `pg_column_size` в `CHECK` Postgres скорее всего отклонит (он STABLE, а не IMMUTABLE) — в тикете команда проверки и запасной вариант
  - Рекомендация: ограничения на размер колонок взять, потолок версий придержать до второго пользователя — жёсткий отказ в сохранении хуже риска
  - Тикет: `docs/ag-quota1-storage-limits-ticket.md`

- [ ] **CJK-1: Из ответов ИИ вырезаются иероглифы** - 🟡 (#35) тихая потеря данных
  - Комментарий говорит «чистим утечки из цепочки рассуждений», код чистит весь ответ — процитированная японская фраза из своей же заметки исчезает молча
  - Тикет: `docs/ag-cjk1-answer-text-ticket.md`

- [ ] **DEBT-1: У index-чанка осталось 3 КБ запаса** - 🟡 переписан, прежняя посылка была неверной
  - Замер: 806 933 при пороге 810 000. Бюджет упадёт на следующих трёх килобайтах продуктового кода
  - **`changelog.ts` тут ни при чём**: `ChangelogPage` уже `React.lazy`, данные лежат отдельным чанком на 219 КБ. Оценка «−150–200 КБ» была ни на чём не основана
  - Начинать с `bundle-stats.html`, а не с догадки; порог опустить в том же коммите
  - Тикет: `docs/ag-debt1-index-bundle-ticket.md`

- [ ] **AIONE-1: Одна реализация ИИ вместо двух** - 🟢 **после C4-1**
  - Причина дублирования — граница ESM/CommonJS с `functions/`; она уходит вместе с деревом
  - В исходном роадмапе диф ссылался на несуществующий модуль `src/shared/ai/sanitize` — в тикете реальная карта файлов
  - Ловушка: `isomorphic-dompurify` и `langfuse` серверные, целиком `pure.ts` наверх не поднимается
  - Тикет: `docs/ag-aione1-single-ai-implementation-ticket.md`

- [ ] **MERGE-1: Профиль ИИ двоится между устройствами** - 🟡 (аудит р7, остаток)
  - id фасета — это `${Date.now()}_${index}`, то есть «когда собрали», а не «что это»: два устройства кладут одну грань дважды
  - `lastReinforcedAt` — строка `YYYY-MM-DD`, все подкрепления одного дня парсятся в одну полночь, и подкрепление второго устройства теряется
  - Тикет: `docs/ag-merge1-profile-identity-ticket.md`

- [ ] **VERIFY-1: Долг по замерам** - 🟡 две правки уехали без обещанного измерения
  - §2.4 и §2.5 плана изменили порядок выдачи поиска; план требовал замер до/после, замер не сделан. Стенд есть: `/rerank-bench`
  - §3.8 (возврат слота при обрыве стрима) покрыт юнит-тестом, но не проверен на живом сокете — добавить кейс в `post-deploy-smoke.ts`
  - Если замер противоречит правке — это и есть результат, а не повод крутить числа
  - Тикет: `docs/ag-verify1-measurement-debt-ticket.md`

- [x] **RAG-1: В модель попадают не те заметки** - 🔴 (аудит р7) исключённая заметка и чужой период
  - Lite-путь внедрения не проверяет `excludedFromAI` — человек сказал «не показывать ИИ», текст всё равно уходит провайдеру
  - Ключ кэша `searchNotesMulti` не содержит окна времени → «сравни периоды» подаёт заметки периода А под заголовком «ПЕРИОД Б»
  - Тикет: `docs/ag-rag1-retrieval-leaks-ticket.md`

- [x] **STAT-1: Счётчики врут о жизни пользователя** - 🔴 (аудит р7) четыре штуки, общая аудитория
  - Фильтр в архиве тратит месячную заморозку стрика: `calculateStreak` пишет в localStorage прямо из `useMemo` на отфильтрованном наборе
  - Продолжение старой заметки уменьшает счётчик сессий в профиле (дельта считает не то)
  - «Заметки» на самом деле «сохранения» — достижение `notes_25` открывается десятью сохранениями одной заметки
  - Два сохранения подряд могут получить одинаковый номер версии → превью показывает текст до правки
  - Тикет: `docs/ag-stat1-counters-lie-ticket.md`

- [x] **PROF-1: Портрет деградирует сам, у рефреша нет мьютекса** - 🟡 (аудит р7)
  - Упавший раздел заменяется заглушкой и безусловно сохраняется поверх хорошего портрета на всех устройствах
  - Оценка стоимости считает свежие дайджесты, а прогон — нет: показывает 0–1 вызов, тратит 12
  - Гвард рефреша — `useState` в компоненте, уход со страницы его обнуляет
  - `removeDialogueFromFacets` пишет мимо лока (теперь чинится в две строки — лок вынесен в `facetLock.ts`)
  - Удаление заметок оставляет призраков в фасетах, убеждениях и портрете
  - Тикет: `docs/ag-prof1-portrait-and-locks-ticket.md`

- [x] **AUTH-1: После выхода остаётся чужое** - 🟡 (аудит р7) важно на общем браузере
  - `signOut` зовёт `setKey(null)` вместо `lockVault()` — сброс `rememberDevice` живёт в `lockVault`
  - Индекс поиска предыдущего пользователя живёт в памяти до пяти минут: `invalidateMiniSearchCache` при выходе не зовётся
  - Тикет: `docs/ag-auth1-leftovers-after-signout-ticket.md`

- [ ] **CI-1: Тесты `functions/` и `rules` не запускаются** - ⏸ отложено до C4, чинить не будем
  - `functions/`: 39 тестов из 107 падают — `TypeError: db.doc is not a function`, моки отстали от перехода на именованную БД (`getDb()`)
  - `rules.test.ts` не компилируется — импорт удалённого `src/core/firebase/cloudFields.ts` (ушёл с Firebase-клиентом, коммит 9b9665c7)
  - Решение 2026-08-21: не чинить. Клиент в Firestore не ходит, дерево удаляется шагом **C4** плана миграции вместе с обоими шагами CI
  - **Пока C4 не выполнен, джоб CI остаётся красным на этих шагах** — это известно и принято
  - Закрывается вместе с C4, отдельной работы не требует

- [x] **SYNC-5: Кластер потери данных в синхронизации** - 🔴 (аудит р6) один корень: синк только вверх
  - Форк-взрыв: `ConflictResolver` создаёт копию, но не подтягивает облачные версии и не двигает `currentVersion` — следующее сохранение форкает снова, и так на каждом сохранении
  - Пути скачивания обновлений для уже слинкованных документов не существует вообще; `downloadAllFromCloud` их пропускает
  - Коллизия версий при разборе очереди: задача очищается по `cloudNums.has(v)`, хотя версия принадлежит другому устройству — last-writer-wins там, где форк писался ради защиты от этого
  - Нет надгробий: жёсткий DELETE без `deleted_at` ни в одной из 14 миграций → удалённая заметка воскресает с устройства, пропустившего удаление
  - Делать после оживления CI: это несколько дней работы, и проверять её нечем, пока гейты мертвы
  - Тикет: `docs/ag-sync5-upload-only-sync-ticket.md`

- [x] **DRAFT-2: Автосейв не сериализован с завершением сессии** - 🟡 (аудит р6) фантомный черновик
  - 30-секундный интервал не координирован с finish/cancel: снапшот снят → юзер сохранил → `deleteDraft` → приземляется опоздавший put
  - Черновик — одна ячейка на пользователя (keyPath `userId`), опоздавшая запись перетирает всё
  - `AbortController` декоративен: сигнал не доходит до провайдера, сервис рапортует успех опоздавшей записи
  - Тикет: `docs/ag-draft2-autosave-race-ticket.md`

- [x] **AI-BILL-1: Глобальный флаг биллинга захватывает параллельные вызовы** - 🟡 (аудит р6)
  - `callAi.ts` — модульная `let chargeUserLimit` + оборачивающая `withUserCharge`; окно общее на модуль
  - Любой параллельный вызов внутри окна (эмбеддинг чата, память) списывается как ход пользователя
  - Фикс: передавать признак аргументом, а не через состояние модуля
  - Тикет: `docs/ag-bill1-charge-flag-ticket.md`

- [x] **CHAT-2: Гонки в диалоге с ИИ** - 🟡 (аудит р6) четыре разных, один слой
  - «Регенерировать» удаляет старый Q&A из БД до отправки — при ошибке ответ пропадает и из треда, и из контекста
  - Смена персоны на середине стрима: замыкание держит старую, запись идёт в диалог с новой
  - Любой `dialogue-updated` (заголовок, длина ответа) стирает оптимистичный пузырь пользователя до конца стрима
  - Двойной сабмит: второй отклоняется и трактуется как ошибка — инпут и вложения восстанавливаются на живом стриме
  - Тикет: `docs/ag-chat2-dialogue-races-ticket.md`

- [x] **ERR-2: Ошибки не доходят до пользователя в понятном виде** - 🟡 (аудит р6)
  - Семь с лишним форм ошибок; сырой `throw` от PostgREST без маппинга в UI
  - `permission-denied` с сервера показывается как общая «ошибка сервера»
  - `RATE_LIMIT` бросается транспортом, но ветки в `catch` нет — задержка выглядит как «Произошла ошибка»
  - Тикет: `docs/ag-err2-limit-errors-ticket.md`

- [x] **LINT-1: `import/no-cycle` объявлено ошибкой и не работает** - 🔴 сломанный контроль, а не стиль
  - Правило стоит `'error'` в `eslint.config.js:52`, но молчит и на настоящих циклах, и на искусственном из двух файлов — проверено пробой
  - Причина: не установлен `eslint-import-resolver-typescript`. Правила, которым нужно **разрешение модулей**, мертвы; правила, работающие со строкой пути (`import/no-restricted-paths`), живы — эту границу проверил отдельно, она срабатывает
  - В коде сейчас 5 настоящих циклов, все внутри одной фичи: `auth/contexts/AuthContext ↔ hooks/useAuthStatus ↔ contexts/ProfileContext/AnalyticsContext` (3 штуки, порождены ре-экспортами `export { … } from` в обе стороны) и `ai/services/AIProfileFacetService ↔ Builder/Summarizer` (2)
  - Сделать: поставить резолвер, посмотреть, что ещё всплывёт, развязать 5 циклов или занести их в исключения явно. Не оставлять правило включённым и слепым
  - Ни один цикл не пересекает границы слоёв — с ARCH-2 они не связаны, чинятся отдельно
  - ✔ 2026-08-22. Резолвера **оказалось недостаточно**: `import/no-unresolved` с ним заработал, `no-cycle` — нет, даже на цикле из двух файлов. Не хватало `'import/parsers': { '@typescript-eslint/parser': ['.ts','.tsx'] }` — резолвер отвечает «где файл», а правилу нужно «что файл экспортирует»
  - После починки конфига всплыло 11 циклов. Развязаны: два мёртвых ре-экспорта между `AuthContext` и `useAuthStatus`, `PRIVACY_VERSION` вынесена в `src/core/constants/privacyVersion.ts`, `withFacetLock` — в `src/features/ai/services/facetLock.ts`
  - Проверять только пробой: `--print-config` показывает `no-cycle: [2]` и при неработающем правиле

- [x] **ARCH-2: `ARCHITECTURE.md` расходится с кодом** - ✔ решено 2026-08-21: **правим документ, код не трогаем**
  - Замеры, на которых основано решение: 60 импортов «фича → фича» в 34 файлах; 5 импортов `core → features`; 39 импортов в `src/app/` из 22 файлов; 23 сервиса в `core/services` при заявленных восьми
  - **Но границы не фикция.** `import/no-restricted-paths` в `eslint.config.js:56` работает — проверил пробой, правило срабатывает. В конфиге прямо написано, что кросс-фичевые импорты **сознательно** дедовщинены («grandfathered ~80 as of 2026-06 — extend the zones as features get untangled»), а `auth` и `calendar` уже закрыты поимённо. Это храповик, а не бардак
  - Пять `core → features` — однострочные ре-экспорт-мосты с явным `eslint-disable … -- re-export bridge for cross-feature access`. Это не нарушение правила, а способ, которым документ сам предлагает делиться сервисами. Направление вывернуто (core ре-экспортирует из features, а не владеет кодом) — это стоит назвать в документе, но не переделывать
  - **Почему не код:** 60 импортов в 34 файлах — это правка без единого приложенного бага, пока открыт кластер потери данных (`SYNC-5`) и CI только-только начал что-то проверять. Расплетать фичи имеет смысл по одной, когда до неё дошли руки, — ровно как задумано храповиком
  - **Что писать в документе:** (1) стек — Supabase и VPS; разделы «Cloud (Firestore)», «Cloud Functions» и «Vercel API» описывают то, что удаляется шагом C4, и это единственная часть, которая прямо вводит в заблуждение; (2) границы — не абсолютные правила прозой, а ссылка на `eslint.config.js` как на источник истины, с честным числом дедовщиненных импортов и порядком их сокращения; (3) убрать список из восьми сервисов либо генерировать его, а не поддерживать руками
  - Заголовок раздела — «Target Architecture». Документ и задумывался как цель; ошибка была в том, что цель записана в настоящем времени

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
