# AG-B1…B8 — дорожка B, гейты CI

**Приоритет:** B1 — P0, остальное P1/P2 · пункты B1–B8 бэклога (`docs/backlog-pre-migration.md`)
**Ветка от:** `main` (сейчас `8268819b`, версия 0.7.68).

Дорожка A закрыта целиком (A1–A11 в релизе 0.7.68). Это следующая пачка: не поведение
приложения, а **проверки, которые должны ловить его поломки**. Общая беда у всех восьми
одна — гейт существует, выглядит рабочим и при этом ничего не проверяет.

Всё, что ниже, я перепроверил по коду сам, а не переписал из аудита. Где мой вывод
разошёлся с бэклогом — это отмечено в тексте задачи.

Восемь независимых задач. Делай **по порядку**, каждую — отдельным коммитом. Если
какая-то не пойдёт — останови её и переходи к следующей, не переделывай уже сделанные.

**Общие границы для всех восьми:**

- **не менять код приложения в `src/`, кроме прямо названных здесь файлов.** Это задача
  про гейты; если гейт находит настоящую ошибку в коде — не чини её тут, выпиши в отчёт;
- не менять версию приложения, `CHANGELOG.md` и `src/features/navigation/data/changelog.ts` —
  ничего из этого пользователь не видит;
- не поднимать версию IndexedDB;
- не откатывать свои же правки через `git checkout <файл>` — так уже был потерян готовый фикс;
  правь файл обратно руками;
- не добавлять новых зависимостей;
- локальные проверки заканчивать `npm run lint` целиком, а не `npx eslint <файлы>`:
  репозиторный скрипт идёт с `--max-warnings 0`, и именно на этой разнице недавно уехал
  красный `main`;
- **не пушить.** Правки в `.github/workflows/ci.yml` проверяются только на PR, поэтому
  для них «проверил локально» невозможно — вместо этого в отчёте по каждой задаче с CI
  напиши, какой шаг ты изменил и почему уверен, что он делает то, что заявлено.

---

# B1 — CI после сравнения бандлов тестирует `main`, а не PR (P0)

## Что сломано

`.github/workflows/ci.yml`, шаг `Bundle size comparison`:

```yaml
        git fetch origin main
        git checkout origin/main -- .     # переписывает И рабочее дерево, И индекс
        npm ci
        npm run build
        mkdir -p /tmp/base-dist
        cp -r dist/assets/* /tmp/base-dist/
        # Compare
        git checkout -- .                 # восстанавливает дерево ИЗ ИНДЕКСА
        npx tsx scripts/bundle-compare.ts /tmp/base-dist /tmp/current-dist
```

`git checkout <ref> -- .` кладёт файлы и в индекс тоже. Поэтому следующий
`git checkout -- .` восстанавливает дерево не к состоянию PR, а **повторно к `main`**.
С этого момента и до конца job checkout — это `main`.

После этого шага идут:

- `Bundle size budget` — меряет `dist/`, собранный из `main`;
- `Install Playwright` + `E2E Tests` (`npm run build && playwright test`) — собирает и
  гоняет `main`;
- `Functions build & test` — код функций из `main`;
- `Run rules and emulator tests` — **правила Firestore и тесты эмулятора из `main`**.

То есть PR может сломать правила доступа к базе, сломать облачные функции, уронить E2E
и превысить бюджет размера — и получить зелёную галочку. Из всех гейтов реально проверяют
PR только первые пять шагов (`prod-audit`, `typecheck`, `lint`, `test:ci`, `build`).

Отдельно: `npm ci` внутри шага ставит зависимости из `package-lock.json` ветки `main` и
обратно уже не переустанавливается. Даже если починить только checkout, `node_modules`
останутся от базы.

## Что делать

**Вынести сравнение бандлов в отдельный job.** Не «поправить порядок шагов» и не
подкладывать worktree в тот же job: пока сравнение живёт рядом с гейтами корректности,
любая его ошибка снова превращается в ложный зелёный. В отдельном job оно физически не
может испортить дерево, на котором считаются гейты, — и это меньший диф, чем возня с
worktree и проверками `HEAD`.

Из job `build` **удалить целиком** шаг `Bundle size comparison` (от `- name: Bundle size
comparison` до строки с `npx tsx scripts/bundle-compare.ts /tmp/base-dist /tmp/current-dist`
включительно). Остальные шаги не трогать: после удаления `Bundle size budget` впервые
начнёт мерить сборку самого PR — так и задумано.

Добавить в конец файла, на том же уровне отступа, что и `build:` (то есть внутрь `jobs:`),
перед завершающим комментарием про ручной деплой функций:

```yaml
  # Сравнение размера бандла живёт отдельно от гейтов корректности намеренно.
  # Раньше оно стояло в середине job build и переключало checkout на main
  # (git checkout <ref> -- . переписывает индекс, поэтому git checkout -- .
  # возвращал base повторно). Всё, что шло после, — бюджет размера, E2E,
  # функции, правила Firestore — проверяло main вместо PR.
  bundle-size:
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    env:
      VITE_FIREBASE_API_KEY: ${{ secrets.VITE_FIREBASE_API_KEY }}
      VITE_FIREBASE_AUTH_DOMAIN: ${{ secrets.VITE_FIREBASE_AUTH_DOMAIN }}
      VITE_FIREBASE_PROJECT_ID: ${{ secrets.VITE_FIREBASE_PROJECT_ID }}
      VITE_FIREBASE_STORAGE_BUCKET: ${{ secrets.VITE_FIREBASE_STORAGE_BUCKET }}
      VITE_FIREBASE_MESSAGING_SENDER_ID: ${{ secrets.VITE_FIREBASE_MESSAGING_SENDER_ID }}
      VITE_FIREBASE_APP_ID: ${{ secrets.VITE_FIREBASE_APP_ID }}
      VITE_FIREBASE_FIRESTORE_DATABASE_ID: ${{ secrets.VITE_FIREBASE_FIRESTORE_DATABASE_ID }}
      VITE_RECAPTCHA_SITE_KEY: ${{ secrets.VITE_RECAPTCHA_SITE_KEY }}
    steps:
    - uses: actions/checkout@v4
      with:
        fetch-depth: 0
    - uses: actions/setup-node@v4
      with:
        node-version: '20'
        cache: 'npm'

    - name: Build PR
      run: |
        npm ci
        npm run build
        mkdir -p /tmp/current-dist
        cp -r dist/assets/* /tmp/current-dist/

    - name: Build base in a separate worktree
      run: |
        git worktree add /tmp/base "origin/${{ github.base_ref }}"
        cd /tmp/base
        npm ci
        npm run build
        mkdir -p /tmp/base-dist
        cp -r /tmp/base/dist/assets/* /tmp/base-dist/

    - name: Compare
      run: npx tsx scripts/bundle-compare.ts /tmp/base-dist /tmp/current-dist
```

Почему именно так:

- `fetch-depth: 0` — без полной истории `git worktree add origin/<base>` не найдёт ссылку;
- база собирается в `/tmp/base`, у неё свой `node_modules`; checkout PR не трогается вообще;
- `if: github.event_name == 'pull_request'` — на push в `main` сравнивать не с чем;
  `github.base_ref` при push пустой, и job бы упал;
- `npm run build` вызывает `prerender.ts` с Playwright — он ставит браузер сам через
  `npx`, как и сейчас в job `build` до шага установки Playwright. Если база не соберётся
  по этой причине, не добавляй установку браузера вслепую: сначала посмотри лог.

## Проверка

Локально job не воспроизвести. Что нужно сделать вместо этого:

1. YAML обязан парситься. Из корня: `npx js-yaml .github/workflows/ci.yml > /dev/null`
   (или `python3 -c "import yaml,sys;yaml.safe_load(open('.github/workflows/ci.yml'))"`).
   Не добавляй `js-yaml` в зависимости — только `npx`.
2. Убедись, что в `ci.yml` не осталось ни одного `git checkout` внутри job `build`:
   `grep -n "git checkout" .github/workflows/ci.yml` должен вернуть пусто.
3. В отчёте перечисли шаги job `build` в новом порядке.

---

# B2 — пороги покрытия не включены, а включать их как есть нельзя (P1)

## Что сломано и чем это отличается от бэклога

`package.json`: `"test:ci": "vitest run"` — без `--coverage`. Пороги в `vite.config.ts`
(`statements 75, branches 70, functions 75, lines 75`) не применяются никогда.

**Но просто дописать `--coverage` нельзя.** Я измерил фактическое покрытие на текущем
`main`:

```
Statements   : 30.31%   (порог 75)
Branches     : 20.76%   (порог 70)
Functions    : 22.68%   (порог 75)
Lines        : 31.40%   (порог 75)
```

Пороги 75/70/75/75 — это пожелание, записанное в конфиг и никогда не проверявшееся.
Включить их — значит сделать CI красным навсегда, а красный CI перестают читать через
неделю, и тогда мы теряем и те гейты, что работают.

## Что делать

Два порога вместо одного: **глобальный храповик** на текущем уровне (чтобы покрытие не
падало) и **отдельные, честные пороги на путях данных** (чтобы там оно не падало
особенно). Не поднимать общий процент — это отдельная большая работа, и она не сюда.

### B2.1 — включить покрытие в CI

`package.json`:

**Было:**

```json
    "test:ci": "vitest run",
```

**Стало:**

```json
    "test:ci": "vitest run --coverage",
```

### B2.2 — заменить пороги на измеренные

`vite.config.ts`, блок `thresholds` внутри `coverage`.

**Было:**

```ts
        thresholds: {
          statements: 75,
          branches: 70,
          functions: 75,
          lines: 75,
        },
```

**Стало:**

```ts
        // Храповик, а не цель. Значения — фактический уровень на 0.7.68, округлённый
        // вниз: задача порога здесь не поднять покрытие, а не дать ему упасть.
        // Прежние 75/70/75/75 были пожеланием — при них CI был бы красным всегда,
        // а красный CI перестают читать.
        thresholds: {
          statements: 30,
          branches: 20,
          functions: 22,
          lines: 31,
          // Пути данных держим отдельно и заметно выше: сюда уехали все правки
          // дорожки A, и именно здесь потеря покрытия означает потерю заметок.
          'src/core/storage/**': { statements: 85, branches: 50, functions: 60, lines: 88 },
          'src/core/crypto/**': { statements: 70, branches: 58, functions: 65, lines: 74 },
          'src/core/services/**': { statements: 63, branches: 54, functions: 60, lines: 66 },
        },
```

Измеренные значения по этим каталогам на 0.7.68 — `storage 88.23/52.08/62.50/91.40`,
`crypto 72.32/60.84/67.50/76.84`, `services 65.87/56.65/62.27/69.02`. В пороги выше
заложен запас в 2–3 пункта: он нужен, потому что покрытие слегка плавает от того, какие
файлы вообще загрузились в прогоне.

`src/features/auth/**` намеренно **не** включён: там сейчас 39.69/31.03/42.11/39.34, и
порог на этом уровне ничего не защищает. Выпиши это в отчёт как известный пробел.

## Проверка

```
npx vitest run --coverage
```

Должно завершиться успешно и напечатать сводку без строк `ERROR: Coverage for ...`.
Если какой-то каталожный порог не проходит — **не подгоняй его вниз молча**: напиши в
отчёте фактическое число и на сколько оно разошлось с указанным здесь.

---

# B3 — код функций не линтуется вообще (P1)

## Что сломано

`eslint.config.js`, строка 12:

```js
    ignores: ['dist/**', 'node_modules/**', '.claude/**', '.vercel/**', 'functions/**', 'scripts/**'],
```

В `functions/package.json` своего `lint` тоже нет — только `build`, `test`,
`test:emulator`, `test:rules`, `serve`, `deploy`. То есть весь серверный код не видел
линтера ни разу. Перед тем как писать серверный код под VPS, у бэкенда должен быть свой
гейт.

## Что делать

Отдельный конфиг в `functions/`, а не расширение корневого: у бэкенда другая среда
(Node, без DOM и React) и свой `tsconfig`. Корневой `ignores` **не трогай** — пусть
`functions/**` и дальше исключён из корневого прогона.

Новый файл `functions/eslint.config.js`:

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['lib/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
```

Сверься с корневым `eslint.config.js`: если там другой способ подключения
`typescript-eslint` или другая версия импортов — повтори тамошний, а не этот. Версии
`@eslint/js` и `typescript-eslint` уже есть в корневых `devDependencies`; в
`functions/package.json` добавь их в `devDependencies` **теми же версиями**, что стоят в
корне. Новых пакетов не приноси.

В `functions/package.json`, в `scripts`, после `"build"`:

```json
    "lint": "eslint . --max-warnings 0",
```

В `.github/workflows/ci.yml`, шаг `Functions build & test`:

**Было:**

```yaml
    - name: Functions build & test
      run: cd functions && npm ci && npm run build && npm test
```

**Стало:**

```yaml
    - name: Functions build & test
      run: cd functions && npm ci && npm run lint && npm run build && npm test
```

## Дальше — важное

Первый прогон почти наверняка даст ошибки: этот код никогда не линтовался.

- **Чини только механическое**: неиспользуемые импорты и переменные, явные `any`,
  которые заменяются очевидным типом.
- Всё, что требует менять поведение, **не чини**. Выключи правило точечным
  `// eslint-disable-next-line <правило>` с коротким комментарием почему — и перечисли
  все такие места в отчёте.
- Если ошибок больше пары десятков — остановись, не правь их пачкой, а напиши в отчёте
  сколько их и какие. Мы решим отдельно.

## Проверка

```
cd functions && npm run lint
```

Ноль ошибок. И корневой `npm run lint` из корня — тоже ноль (он не должен был
измениться вообще).

---

# B4 — аудит зависимостей даёт ложный зелёный, когда команда падает (P2)

## Что сломано

`scripts/prod-audit.mjs`:

```js
let raw;
try {
  raw = execFileSync('npm', ['audit', '--omit=dev', '--audit-level=high', '--json'], { encoding: 'utf8' });
} catch (e) {
  // npm audit exits non-zero when advisories exist; the JSON report is still on stdout.
  raw = e.stdout?.toString() ?? '';
}

const report = JSON.parse(raw || '{}');
```

Комментарий верен только для одного случая — когда `npm audit` отработал и нашёл
уязвимости. Но `execFileSync` кидает и когда команда упала по-настоящему: нет сети,
реестр недоступен, npm сломан. Тогда `e.stdout` пустой, `raw || '{}'` даёт `{}`,
`report.vulnerabilities` — `undefined`, цикл не выполняется ни разу, и скрипт печатает
«блокирующих уязвимостей нет». Это первый шаг в CI: он должен различать «проверили, чисто»
и «проверить не смогли».

## Что делать

**Было:**

```js
const report = JSON.parse(raw || '{}');
```

**Стало:**

```js
// Пустой stdout значит, что команда не отработала, а не что уязвимостей нет.
// execFileSync кидает и при найденных уязвимостях (отчёт на stdout), и при
// настоящем сбое — нет сети, недоступен реестр. Различать обязательно: это
// первый гейт в CI, и «проверить не смогли» не равно «проверили, чисто».
if (!raw.trim()) {
  console.error('prod-audit: npm audit не дал вывода — проверка не выполнена, а не пройдена.');
  process.exit(1);
}

let report;
try {
  report = JSON.parse(raw);
} catch (e) {
  console.error('prod-audit: не удалось разобрать вывод npm audit:', e instanceof Error ? e.message : e);
  process.exit(1);
}
```

Плюс аудит самих функций. В `.github/workflows/ci.yml`, сразу после существующего шага
`- run: node scripts/prod-audit.mjs`:

```yaml
    - name: Audit functions dependencies
      run: cd functions && npm ci && npm audit --omit=dev --audit-level=high
```

Отдельным шагом и без списка исключений: в `functions/` он пока не нужен, а появится —
заведём такой же скрипт. Если этот шаг сразу красный — **не добавляй исключений сам**,
выпиши находки в отчёт.

## Проверка

```
node scripts/prod-audit.mjs && echo OK
```

Должно отработать как раньше. Затем — что скрипт действительно падает на пустом вводе:
временно подставь `raw = ''` сразу после блока `try/catch`, убедись, что скрипт выходит
с ненулевым кодом (`node scripts/prod-audit.mjs; echo $?`), и **верни строку обратно
руками**, не через `git checkout`.

---

# B5 — два теста не проверяют ничего (P2)

## Что сломано

`src/core/services/__tests__/SyncService.integration.test.ts`.

```ts
  it('syncPending skips when already in progress', async () => {
    localStorage.setItem('auto_sync_enabled', 'true');
    await SyncService.syncPending(userId);
    await SyncService.syncPending(userId);
    localStorage.removeItem('auto_sync_enabled');
  });
```

Ни одного утверждения. И даже если бы они были — два `await` подряд не создают
одновременности: первый вызов успевает освободить защёлку до начала второго, так что
проверяемая ветка не выполняется вообще.

```ts
  it('expired queue items are cleaned up during sync', async () => {
    const db = await getLocalDb();
    await db.put('syncQueue', { id: 'sync_doc_old', /* createdAt: сутки назад */ });
    const countBefore = await SyncService.getPendingCount();
    expect(countBefore).toBe(1);
  });
```

Синхронизация не запускается. Тест проверяет, что `db.put` записал запись.

**И главное, чего в бэклоге нет: очистки просроченных задач не существует.** Я искал —
в `SyncService.ts` единственный срок это `cutoff = Date.now() - 60_000` в `addToQueue`,
и он только про дедупликацию, а не про удаление. Тест назван в честь механизма, которого
нет.

## Что делать

**Не реализовывать удаление просроченных задач.** Это выглядит как очевидное «сделать
тест правдой», но означало бы молча выбрасывать невыгруженную работу — ровно то, из-за
чего была вся дорожка A. Задача, которая падает сутками, должна продолжать попытки, а не
исчезать. Если очередь когда-нибудь начнёт расти без предела, это отдельный разговор про
видимый пользователю статус, а не про тихое удаление.

Поэтому: первый тест — переписать так, чтобы одновременность была настоящей; второй —
заменить на проверку того, что происходит на самом деле.

**Было** (оба теста целиком):

```ts
  it('syncPending skips when already in progress', async () => {
    localStorage.setItem('auto_sync_enabled', 'true');
    await SyncService.syncPending(userId);
    await SyncService.syncPending(userId);
    localStorage.removeItem('auto_sync_enabled');
  });

  it('expired queue items are cleaned up during sync', async () => {
    const db = await getLocalDb();
    await db.put('syncQueue', {
      id: 'sync_doc_old',
      documentId: 'doc_old',
      type: 'document' as const,
      createdAt: Date.now() - 25 * 60 * 60 * 1000,
    });
    const countBefore = await SyncService.getPendingCount();
    expect(countBefore).toBe(1);
  });
```

**Стало:**

```ts
  // Два await подряд не создают одновременности: первый вызов освобождает
  // защёлку до начала второго, и проверяемая ветка не выполняется вообще.
  // Второй вызов должен уйти, пока первый ещё в работе.
  it('syncPending skips a second run while the first is still going', async () => {
    localStorage.setItem('auto_sync_enabled', 'true');
    const db = await getLocalDb();
    await db.put('syncQueue', {
      id: 'delete_cloud_slow', documentId: 'cloud_slow', type: 'delete' as const,
      createdAt: Date.now(), ownerId: userId,
    } as never);

    let started = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>(res => { release = res; });
    vi.spyOn(CloudSyncService, 'removeCloudCopy').mockImplementation(async () => {
      started++;
      await gate;
    });

    const first = SyncService.syncPending(userId);
    await Promise.resolve();
    await SyncService.syncPending(userId);   // должен выйти сразу
    release();
    await first;

    expect(started).toBe(1);
    localStorage.removeItem('auto_sync_enabled');
  });

  // Просроченные задачи НЕ удаляются, и это намеренно: задача, которая падает
  // сутками, должна продолжать попытки, а не исчезать вместе с невыгруженной
  // заметкой. Тест раньше назывался «expired queue items are cleaned up» и
  // проверял, что db.put сработал.
  it('keeps a day-old queue item instead of dropping it', async () => {
    localStorage.setItem('auto_sync_enabled', 'true');
    const db = await getLocalDb();
    await db.put('syncQueue', {
      id: 'sync_doc_old', documentId: 'doc_old', type: 'document' as const,
      createdAt: Date.now() - 25 * 60 * 60 * 1000, ownerId: userId,
    } as never);

    await SyncService.syncPending(userId);

    expect(await db.get('syncQueue', 'sync_doc_old')).toBeTruthy();
    localStorage.removeItem('auto_sync_enabled');
  });
```

Если фактические сигнатуры или мок не совпали — подставь настоящие, но **утверждения не
меняй**. И не убирай `ownerId`: без него задача не пройдёт фильтр владельца из A7.

## Проверка

```
npx vitest run src/core/services/__tests__/SyncService.integration.test.ts
```

**Проверка на невакуумность** для первого теста: убери в `SyncService.syncPending`
строку `if (_syncInProgress.get(userId)) return;` — тест обязан упасть на `started`.
Верни правку руками.

---

# B6 — сравнение бандлов сопоставляет имена с хэшами, поэтому гейт мёртв (P2)

## Что сломано

`scripts/bundle-compare.ts`:

```ts
    const baseChunk = base.find(b => b.name === cur.name);
```

Имена файлов в `dist/assets` содержат хэш содержимого — `index-CSCSaN6_.js`. Любой чанк,
который изменился, получает **новое** имя. Значит `find` его не находит, чанк попадает в
«новый», а старый — в «удалённый».

Дальше по файлу:

```ts
const indexChange = changes.find(c => c.name.startsWith('index-'));
if (indexChange && indexChange.percent !== 'new' && indexChange.percent !== 'removed') {
```

Изменившийся `index` всегда имеет `percent === 'new'` — и порог в 5% пропускается. То же
самое для `vendor` и 10%. **Оба гейта не срабатывают ни при каких обстоятельствах**, а
отчёт при этом печатает пары «новый / удалённый» вместо разницы. Это не «неточность в
отчёте», как в бэклоге, — это неработающая проверка.

## Что делать

Сопоставлять по имени без хэша. Хэш Vite ставит последним сегментом перед расширением,
через дефис.

Добавь рядом с `getChunks` (после неё):

```ts
/** Имя чанка без хэша содержимого: index-CSCSaN6_.js → index.js.
 *  Без этого изменившийся чанк получает новое имя, не находит себе пару в базе
 *  и уходит в «новый» — а к новым порог не применяется, поэтому оба гейта
 *  (index > 5%, vendor > 10%) не срабатывали никогда. */
function stripHash(name: string): string {
  const ext = path.extname(name);
  return name.slice(0, -ext.length).replace(/-[A-Za-z0-9_-]{8,}$/, '') + ext;
}
```

В `compareChunks` сопоставляй по нему:

**Было:**

```ts
  for (const cur of current) {
    const baseChunk = base.find(b => b.name === cur.name);
```

**Стало:**

```ts
  for (const cur of current) {
    const baseChunk = base.find(b => stripHash(b.name) === stripHash(cur.name));
```

И в блоке удалённых:

**Было:**

```ts
  for (const b of base) {
    if (!current.find(c => c.name === b.name)) {
```

**Стало:**

```ts
  for (const b of base) {
    if (!current.find(c => stripHash(c.name) === stripHash(b.name))) {
```

Пороговые `find` в конце файла оставь как есть: `c.name.startsWith('index-')` продолжит
работать, а `percent` у изменившегося `index` теперь будет числом, а не `'new'` — ради
этого всё и делается.

## Проверка

Разовый скрипт, тестов у него нет — заведи их. Новый файл
`scripts/__tests__/bundleCompare.test.ts`. Каталог `scripts/` в `exclude` у vitest не
попадает (там только `node_modules`, `dist`, `.claude`, `coverage`, `.git`, `.firebase`,
`functions/lib`, `functions/src`, `e2e`), так что тест подхватится сам. Из
`bundle-compare.ts` **экспортируй только `stripHash`** — остальное не трогай, скрипт под
тестируемость не переписывай.

```ts
import { describe, it, expect } from 'vitest';
import { stripHash } from '../bundle-compare';

// Изменившийся чанк получает новый хэш. Пока сопоставление шло по полному
// имени, он не находил пару в базе, уходил в «новый», и порог к нему не
// применялся — оба гейта размера не срабатывали ни разу.
describe('stripHash', () => {
  it('matches the same chunk across two builds', () => {
    expect(stripHash('index-CSCSaN6_.js')).toBe(stripHash('index-Ab12Cd34.js'));
  });

  it('keeps different chunks apart', () => {
    expect(stripHash('index-CSCSaN6_.js')).not.toBe(stripHash('vendor-CSCSaN6_.js'));
  });

  it('keeps the extension', () => {
    expect(stripHash('index-CSCSaN6_.css')).toBe('index.css');
  });
});
```

Хэши Vite в этом проекте — 8 символов (`index-CSCSaN6_.js`, `vendor-…`), так что `{8,}`
подходит. Если после сборки увидишь другую длину — поправь выражение под фактическую и
скажи об этом в отчёте.

Важно: в `dist/assets` рядом лежат `.js.map`. `getChunks` фильтрует по `.js` и `.css`,
и `.map` под фильтр не попадает — так и должно остаться, карты в сравнение размеров не
входят.

---

# B7 — предупреждения не видны в проде (P1)

## Что сломано

`src/shared/errors/logger.ts`:

```ts
function log(level: LogLevel, context: string, message: string, data?: Record<string, unknown>): void {
  if (import.meta.env.DEV) {
    ...console.warn...
  }

  if (level === 'error') {
    reportError(new Error(message), { context, ...data });
  }
}
```

`logger.warn` в продакшене не делает **ничего**: консоль только в DEV, до `reportError`
доходит только `error`. При этом через `warn` логируются в том числе сбои удаления
черновика и облачной синхронизации — то есть ровно те события, ради которых стоило бы
смотреть в журнал.

## Что делать

Отправлять `warn` в отчёты с уровнем `warning`. `reportError` это уже умеет — третий
аргумент, и он же кладёт запись в журнал активности, который виден в диагностике.

**Было:**

```ts
  if (level === 'error') {
    reportError(new Error(message), { context, ...data });
  }
```

**Стало:**

```ts
  // warn в проде раньше не делал ничего: консоль только в DEV, до отчётов
  // доходили лишь error. Через warn логируются сбои удаления черновика и
  // облачной синхронизации — как раз то, что нужно видеть.
  if (level === 'error' || level === 'warn') {
    reportError(new Error(message), { context, ...data }, level === 'warn' ? 'warning' : 'error');
  }
```

`info` не трогай: он для отладочного шума и в отчётах не нужен.

Про счётчики записей, ошибок и глубины очереди из бэклога: **в этой задаче их не делать.**
Это серверная телеметрия, а сервера пока нет — она относится к дорожке C, к рантайму на
VPS. Здесь только то, что можно сделать на клиенте сейчас.

## Проверка

Новый файл `src/shared/errors/__tests__/logger.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockReport = vi.fn();
vi.mock('../reportError', () => ({ reportError: (...a: unknown[]) => mockReport(...a) }));

import { logger } from '../logger';

// warn в проде не делал ничего: консоль только в DEV, до отчётов доходили
// лишь error. Так терялись сбои удаления черновика и облачной синхронизации.
describe('logger', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports a warning, at warning level', () => {
    logger.warn('sync', 'could not delete draft', { documentId: 'd1' });

    expect(mockReport).toHaveBeenCalledTimes(1);
    expect(mockReport.mock.calls[0]![2]).toBe('warning');
  });

  it('still reports an error at error level', () => {
    logger.error('sync', 'upload failed');

    expect(mockReport.mock.calls[0]![2]).toBe('error');
  });

  it('does not report info', () => {
    logger.info('sync', 'started');

    expect(mockReport).not.toHaveBeenCalled();
  });
});
```

**Проверка на невакуумность:** верни условие `if (level === 'error')` — первый тест
обязан упасть. Верни правку руками.

---

# B8 — флаги не являются аварийными выключателями (P1)

## Что сломано — и почему задача не та, что в бэклоге

`src/core/services/featureFlags.ts` хранит переопределения в `localStorage` каждого
браузера, так что оператор действительно не может ничего выключить глобально. Но я
проверил вызовы, и картина хуже: **у этого модуля ноль обращений во всём коде.**
`grep -rn "featureFlags" src/` находит только сам файл. Ни `ai_enabled`, ни
`sync_enabled`, ни `encryption_enabled`, ни `export_enabled` нигде не спрашиваются.

То есть это не «выключатель, который плохо устроен», а мёртвый код, который выглядит как
существующий рубильник. Пока он лежит в репозитории, любой — человек или агент — вправе
считать, что аварийное отключение синхронизации есть.

Настоящий аварийный выключатель требует источника состояния вне браузера. Строить его
сейчас на Firebase бессмысленно: этот бэкенд снимается (по той же причине в `ci.yml`
нет job деплоя функций), а каждое чтение конфига — это ещё и обращение к базе, лимит по
которым мы уже выбивали.

## Что делать

Удалить мёртвый модуль и записать решение.

1. Удалить `src/core/services/featureFlags.ts`.
2. Отдельного теста у него нет — я проверил, `src/core/services/__tests__/` ничего про
   флаги не содержит. Если всё же найдёшь ссылку в другом тесте — удали и её.
3. Убедиться, что больше ничего на него не ссылается:
   `grep -rn "featureFlags\|ff_ai_enabled\|ff_sync_enabled" src/ e2e/` — должно быть пусто.
4. В `docs/backlog-pre-migration.md`, в пункт B8, дописать в конец:

```md
**Решено (0.7.68):** модуль `featureFlags` удалён — у него не было ни одного вызова, и
он создавал ложное впечатление, что аварийное отключение существует. Настоящий
выключатель требует состояния вне браузера и относится к рантайму на VPS (дорожка C,
пункт 5): один источник конфигурации, читаемый сервером, а не каждым клиентом.
```

Ничего вместо удалённого модуля **не создавать**. Заглушка на будущее — это тот же
мёртвый код.

## Проверка

```
npm run lint && npx tsc --noEmit && npx vitest run
```

Всё зелёное, ни одной ссылки на удалённый файл.

---

# Как закончить

Каждая задача — свой коммит, Conventional Commits:

- `ci: bundle comparison must not leave the checkout on main (B1)`
- `test: enable coverage with thresholds that reflect reality (B2)`
- `ci: lint the functions code (B3)`
- `ci: a failed audit is not a passed audit (B4)`
- `test: two sync tests that asserted nothing (B5)`
- `ci: compare bundle chunks across content hashes (B6)`
- `fix(logging): a warning must be visible in production (B7)`
- `chore: remove the dead feature-flag module (B8)`

После всех восьми, из корня репозитория:

```
npx tsc --noEmit
npm run lint
npx vitest run --coverage
npm run build
cd functions && npm run lint && npm run build && npm test
```

Все обязаны пройти. `npm run lint` — целиком, не по файлам.

Не пушить. В отчёте по каждой задаче укажи: что изменено, какой тест добавлен, и **что
именно показала проверка на невакуумность** — какой тест упал и на каком утверждении.
Если проверку не делал (для задач с CI её сделать нельзя), так и напиши — не пиши «тесты
зелёные» вместо ответа. Отдельно перечисли всё, что нашёл, но чинить не стал: находки
линтера в `functions/`, находки `npm audit` в `functions/`, пороги покрытия, которые
разошлись с указанными здесь.
