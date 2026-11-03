READ ~/Projects/agent-scripts/AGENTS.MD BEFORE ANYTHING (skip if missing).

# AGENTS.md

Правила для любого ИИ-агента (Claude Code, Cursor, Copilot, Qoder, …) в этом репозитории. `CLAUDE.md` подключает этот файл и добавляет то, что относится только к Claude (правила `/code-review`).

## Что это

Редактор justwriting: React/Vite local-first клиент + свой Supabase + Node API в `api/`. Обзор — `README.md`, устройство — `ARCHITECTURE.md`, **карта модулей — `CODE_MAP.md`** (генерируется `npm run code-map`, свежесть проверяет тест `scripts/__tests__/codeMap.test.ts`).

Команды:

| Что | Команда |
|---|---|
| Типы | `npx tsc --noEmit -p .` |
| Lint целиком | `NODE_OPTIONS=--max-old-space-size=8192 npx eslint . --max-warnings 0` |
| Тесты | `npx vitest run` (CI: `npm run test:ci`) |
| i18n / knip | `npm run i18n:audit`, `node scripts/knip-check.mjs` |
| Постулаты | `npm run postulates` |
| Стенд (свой Supabase в docker) | `bash scripts/stand/up.sh` … `bash scripts/stand/down.sh` |
| Мобильные e2e на стенде | `bash scripts/ci/mobile-e2e.sh` |
| Карта кода | `npm run code-map` |

## Как работать

**Git.** В основном checkout часто параллельно работает другой агент.
- Стейджить **по имени** (`git add path/a path/b`), прямо перед своим коммитом. Не `git add -A`, не `git stash`, не `git mv`/`git rm` (используй `mv`/`rm`). Чужие изменения в `git status` — норма, не трогай.
- Не `git commit … -- <paths>` (здесь даёт пустые коммиты): стейдж → `git diff --cached --name-only` → обычный `git commit` → `git show --stat HEAD`.
- Без `--amend`. Conventional Commits.
- Своя ветка/рабочее дерево для пакета: `git worktree add ../jw-<имя> -b <ветка> main`.

**Пуш и выпуск.**
- Пуш в приложение — только вместе с подъёмом версии. Исключение — правки только тестов/CI, возвращающие зелёный CI.
- Выпуск — только по явному «го» владельца. «Добавь X» ≠ «выпусти X».
- Защищённые пути — см. «CI, деплой и миграции» ниже.

**Проверки.**
- Код выхода смотреть без трубы: `cmd; echo EXIT=$?`. `| tail` прячет падение (так уже пушили красное).
- Lint — целиком и с `--max-warnings 0`; пофайловый и `lint:changed` пропускают то, на чём падает CI. Lint и typecheck — оба.
- Границы слоёв (`core` ↛ `features`) — храповик: перенеси код или пошли событие, не `eslint-disable`.
- **Каждый новый тест — мутацией красный:** убери механизм фикса → тест красный по нужной причине → верни. Зелёный тест, который никогда не был красным, ничего не доказал.
- Поздняя правка общего кода (`src/shared/**`, хуки, сторы) — полный `npx vitest run`, не только свои файлы.
- Правка внешнего вида — её e2e-храповик в том же коммите (`rg` класса/текста/testid в `e2e/`).
- Тяжёлое (vitest, e2e, сборка) — через `nice`: машина общая.

**Классы багов, которые уже были** — `CLAUDE.md` §5 (список для ревью). Главные: сбой чтения принят за «пусто/нет» (и зеркально на записи); фикс в одном из двух входов, а прод ходит другим; часы устройства в решениях синка (запрещено, гейт `src/test/syncRuleGates.s06.test.ts`); мок с порядком строк не как в базе; смена формата/KDF, запирающая старые данные (тест открывает артефакт прежнего кода).

## Приватность и 152-ФЗ

- **Никакого вызова ИИ без действия человека.** Новый фоновый/автоматический вызов ИИ — стоп, вопрос владельцу.
- Скрытая от ИИ заметка (`isExcludedFromAI`) не уходит модели никаким путём: поиск, сводки, память, грани, портрет, цитаты, подсказки.
- Открытый текст заметок, настроения, тегов не попадает в логи, к ИИ без согласия и в облако без шифрования (при включённом сейфе; единая точка — `maybeEncrypt`).
- Тексты согласий и юридические тексты агент не меняет — только владелец.
- Секреты не печатать и не коммитить; фикстуры — синтетические.

## Живые данные не коммитятся — никогда

Это приложение для личного дневника. Всё, что вынуто из настоящего архива,
считается персональными данными, даже если это «просто замер».

- **Никогда** не добавляй в git тексты заметок, их заголовки, **формулировки
  поисковых запросов**, имена людей из архива, разметку релевантности —
  ни в `scripts/`, ни в `docs/`, ни в тестах, ни в примерах в промптах.
- Запрос — тоже личные данные. «[запрос удалён]», «пример запроса
  с <имя>» рассказывают о человеке ровно то же, что и сама заметка. На этом
  уже обожглись: замеры лежали в публичном репозитории (август 2026).
- Входы и выходы прогонов на личном архиве закрыты в `.gitignore`
  (`scripts/rerank-bench/*.json`, `scripts/ai-bench/*-real.*`, `corpus-real.json`).
  Версионируются только скрипты стенда.
- В отчётах запросы идут под номерами (З1, З2…); таблица соответствия остаётся
  в личной выгрузке. См. `rerank-contribution-measurement.md` в приватном `justwriting-docs`.
- Фикстуры в тестах и примеры в системных промптах — выдуманные имена.
  Не бери их из своего архива: имя из примера потом расходится по коду.
- Нужен реалистичный вход для бенчмарка — напиши синтетический текст похожей
  длины и устройства (см. `scripts/ai-bench/reasoning-bench.mjs`).

Проверка перед коммитом: если строку страшно показать постороннему — она не
едет в репозиторий.

## Поведение агента

Behavioral guidelines to reduce common LLM coding mistakes. **Tradeoff:** these guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## Выпуск — чек-лист

- **Review before the bump:** `/code-review` and `/security-review` over the diff since the previous release commit (`git diff <prev-release>..HEAD`). Every finding is either fixed or recorded as «ложное, потому что …» in the release note/memory.
- **Mobile e2e locally before the release push** (owner, 2026-10-18 — standing approval to start Docker for this): `docker ps` first (don't touch foreign or someone else's `jw-stand-*`), `scripts/stand/up.sh` on the alt ports, `scripts/ci/mobile-e2e.sh`, then `scripts/stand/down.sh`. CI is the second check, not the first: one runner, 30 min a round.
- **CI runs on every branch push** (not only `main`); a new push cancels the branch's old run. Push the working branch, get it green, then put the release on `main`. Deploy still counts only the `main` push run. The `main` run skips the heavy jobs when the identical tree already passed full CI on a branch (`already-green`, owner 2026-10-20), and the deploy no longer re-runs typecheck/tests — so put the release on `main` as the exact tree that went green on the branch (squash = same tree), not a re-edited one.
- **A change that alters the look updates its e2e ratchet in the same commit:** `rg` the changed class/text/testid in `e2e/` before committing. Agent reports (Qoder etc.) must include the mobile e2e result, or the batch is not accepted.
- **Version bump — all places must match:**
  1. `package.json` `"version"`.
  2. `package-lock.json` — run `npm install --package-lock-only` after bumping `package.json`.
  3. `public/sw.js` `CACHE_VERSION = 'vX.Y.Z'` — triggers cache eviction of old assets in users' browsers.
  4. `src/version.ts` `APP_VERSION` — **this is the version the UI displays** (Sidebar, Settings, Diagnostics, export payloads). A release that skips this ships new code while the site still shows the old number.
  5. Журналы изменений — **оба**: `CHANGELOG.md` и `src/features/navigation/data/changelog.ts` (его видят люди в приложении, из него же собирается объявление о выпуске). Строка Version в `README.md`.
  - Before pushing, grep for stragglers: `rg "X\.Y\.<old>" --hidden -g '!node_modules' -g '!.git'` (changelog *history* entries are the expected exception).
- **Таблица журнала выпуска:** в выпускном коммите (или `release-table-X.Y.Z.md` в `justwriting-docs`) — строка на каждый пункт `changelog.ts`: `пункт | файл:строка | тест, который его держит (без правки красный)`. Пункт без теста не едет в анонс: тест дописывается до пуша, пункт снимается из журнала или выпуск идёт с `announce: false`. «Исправлены мелкие недоработки» таблицы не требует.
- **Для кого пункт журнала неверен** (владелец 03.11, по дейликам 01–03.11): у каждого пункта `changelog.ts` в таблице выпуска — колонка «кроме»: гость, сейф включён, синхронизация выключена, телефон. Проверка механическая: `rg -n "isGuest|getEncryptionEnabled|cloudSyncEnabled|layoutMode" <файлы правки>` — каждая ветка, которую правка обходит, либо покрыта тестом, либо названа в пункте («кроме …»), либо пункт сужается. Пустая колонка = «проверено, исключений нет», а не «не смотрели».
- **Как откатить** — строкой в сообщении выпускного коммита: прошлый `main` + выкатка, и что ещё (миграция, ключи, конфиг nginx — каждое своим шагом). Нечего сказать — значит, откат не продуман.
- **Здоровье выпусков:** `node scripts/release-health.mjs` — правки кода на `main` между выпусками (хотфиксы), откаты, выпуски через < 24 ч после прошлого. Растёт — экономим на проверках не там.
- **Справочник:** в закрытом `justwriting-docs/handbook/` обновлён `now.md` (что вошло, что нет, ручные шаги).

Полный порядок выпуска, прод и ручные шаги — в закрытом справочнике владельца (`justwriting-docs/handbook/release.md`, `ops.md`); в этом репо прод-деталей нет — оно станет публичным.

## Справочник — держать живым

Закрытый справочник проекта — `justwriting-docs/handbook/` (как устроено опасное, ловушки, прод, выпуск, как работать с владельцем).
- Правка, которая затрагивает синк, шифрование, приватность ИИ, вход или сервер, **в том же пакете** правит нужный раздел справочника.
- Новая ловушка — сразу строкой в `handbook/traps.md`.
- Новый модуль (папка уровня `src/features/*`, `src/core/*`, `src/shared/*`, `api/*`) — описание в словаре `scripts/code-map.ts` и `npm run code-map`, иначе CI красный.

## Skills

В `skills/<name>/SKILL.md` лежат workflow с шагами и критериями выхода. Если интент задачи совпадает с описанием skill — используй его и следуй шагам целиком (агенты без инструмента skill — читают `SKILL.md` сами). Новый skill: папка `kebab-case`, файл ровно `SKILL.md` с frontmatter `name` / `description` (одна фраза: когда применять), скрипты — в `skills/<name>/scripts/*.sh` (`#!/bin/bash`, `set -e`, статус в stderr, JSON в stdout), `SKILL.md` короче 500 строк, справка — отдельными файлами, скрипты чистят временные файлы trap'ом.

Какой skill на какой интент: новая функция → `spec-driven-development`, затем `incremental-implementation` + `test-driven-development`; план → `planning-and-task-breakdown`; баг → `debugging-and-error-recovery`; ревью → `code-review-and-quality`; упрощение → `code-simplification`; API → `api-and-interface-design`; интерфейс → `frontend-ui-engineering`; выпуск → `shipping-and-launch` (порядок выпуска этого репо — чек-лист выше, он главнее).

## CI, деплой и миграции — только с отмашки владельца

Защитить `main` по путям на GitHub нельзя: push-rulesets с ограничением файлов
даются только репозиториям организаций (`422: only org-owned repos can have push
rules`, проверено 2026-10-17), а branch-ruleset на весь `main` сломал бы прямые
коммиты. Поэтому роль «человек обязателен» для `.github/workflows/**`, `deploy/**`
и `supabase/migrations/**` держится правилом, а не замком: агент не пушит правки
этих путей без явной отмашки владельца в той же сессии. Выкатка и так только
руками через `workflow_dispatch` (`deploy.yml`). Правила ревью — в `CLAUDE.md`.

## Внутренние документы — в `justwriting-docs`

Тикеты, отчёты аудитов, промпты аудиторов, ops-документы (runbook, rollback) и
рабочие планы живут в приватном репозитории
`https://github.com/azvideo8-blip/justwriting-docs` (клон — `../justwriting-docs`),
с 2026-10-01. Основной репозиторий станет публичным, а эти файлы — карта
устройства прода и известных дыр. Новые тикеты и отчёты кладутся туда, не в
`docs/`. В `docs/` остаются только публичные: `adr/`, `FEATURES.md`,
`security-invariants.md`, `sync-resilience.md`, `reasoning-mode.md`, `api/` и
генерируемые скриптами `sync-mutation-sweep.md`, `TEST1-protocol.md`.
