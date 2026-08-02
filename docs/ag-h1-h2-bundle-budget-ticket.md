# AG-H1…H2 — до потолка размера бандла 10 кБ

**Приоритет:** P2 · Объём: небольшой
**Ветка от:** `main` (сейчас `588f76bb`, версия 0.7.69).

## Откуда это

Задача B1 починила CI так, что шаг `Bundle size budget` **впервые начал мерить сборку
самого PR**, а не ветки `main`. И сразу выяснилось, что запас почти исчерпан:

```
index-DfjTqGb8.js   739 260 байт   при пороге   750 000
```

10 740 байт, то есть 1.4%. Следующая заметная правка уронит сборку.

Порог поднимать не надо: он для того и стоит. Я разобрал чанк по карте исходников
(`dist/assets/index-*.js.map`, суммарно 199 модулей) и нашёл две вещи, которые лежат в
нём по ошибке, а не по необходимости. Обе чинятся малой кровью.

**Границы:**

- не поднимать пороги в `.github/workflows/ci.yml` — это не решение;
- не добавлять зависимостей, в том числе анализаторов бандла;
- не трогать остальные записи `manualChunks`;
- не менять версию приложения и оба changelog'а;
- проверки заканчивать `npm run lint` целиком;
- не пушить.

---

# H1 — разделение react на отдельный чанк не работает (P2)

## Что сломано

`vite.config.ts`, строка 43:

```ts
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
```

Чанк создаётся, но он **пустой**:

```
$ ls -l dist/assets/vendor-react-*.js
0 KB
```

Причина: ключи `manualChunks` сопоставляются с идентификатором модуля, а приложение
никогда не импортирует голые `react` и `react-dom`. Оно импортирует
`react-dom/client` (`src/main.tsx:2`), `react-dom` ради `createPortal` (около десятка
компонентов) и `react/jsx-runtime` — его подставляет сам сборщик под JSX. Ни один из
этих идентификаторов записи не соответствует.

В итоге весь `react-dom` уезжает в общий чанк: по карте исходников это **523 кБ
исходного кода** — самая крупная позиция в `index`, больше, чем весь наш код вместе.

## Что делать

Заменить массив на функцию — она получает полный идентификатор модуля и умеет то, чего
не умеет форма со списком.

**Было:**

```ts
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-firebase-core': ['firebase/app', 'firebase/auth'],
```

**Стало:**

```ts
          manualChunks(id: string) {
            // Форма со списком сопоставляет ТОЧНЫЙ идентификатор, а приложение
            // импортирует react-dom/client, react-dom (createPortal) и
            // react/jsx-runtime — ни один не равен 'react-dom'. Поэтому чанк
            // vendor-react получался пустым, а сам react-dom (523 кБ исходника)
            // всё это время лежал в общем index.
            if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'vendor-react';
            for (const [name, mods] of Object.entries(VENDOR_CHUNKS)) {
              if (mods.some(m => id.includes(`node_modules/${m}/`))) return name;
            }
            return undefined;
          },
```

А над `build` объяви то, что раньше было объектом:

```ts
const VENDOR_CHUNKS: Record<string, string[]> = {
  'vendor-firebase-core': ['firebase'],
  'vendor-firebase-firestore': ['@firebase/firestore'],
  'vendor-motion': ['motion'],
  'vendor-charts': ['recharts'],
  'vendor-docx': ['docx'],
  'vendor-router': ['react-router-dom'],
  'vendor-markdown': ['react-markdown', 'rehype-sanitize'],
  'vendor-ui': ['lucide-react', 'clsx', 'tailwind-merge'],
  'vendor-ai': ['ai', '@ai-sdk/openai'],
  'vendor-sentry': ['@sentry/react'],
  'vendor-analytics': ['posthog-js'],
  'vendor-virtuoso': ['react-virtuoso'],
};
```

**Осторожно — это самое опасное место задачи.** Разбивка по путям `node_modules`
работает иначе, чем разбивка по именам пакетов: `firebase` и `@firebase/firestore`
раньше делились по точке входа, теперь по каталогу. **После сборки обязательно сравни
список чанков и их размеры с тем, что было до правки** (`ls -lS dist/assets/*.js`).
Если какой-то vendor-чанк исчез, распух или наоборот схлопнулся в ноль — значит
сопоставление промахнулось; разбирайся, а не оставляй как есть. Приложи оба списка в
отчёт.

Отдельно проверь, что `vendor-react` перестал быть нулевым.

---

# H2 — библиотека архивов грузится на каждой странице (P2)

## Что сломано

По карте исходников в `index` лежит `jszip` — **95 кБ исходника**. Он приходит из
`src/features/export/ExportAllService.ts:1`:

```ts
import JSZip from 'jszip';
```

а тот статически импортируется в `src/features/settings/components/AccountExportSection.tsx:8`.
Раздел настроек входит в общий чанк, поэтому библиотека сборки zip-архивов загружается
у каждого пользователя при каждом открытии приложения — ради кнопки, которую в
большинстве сессий никто не нажимает.

## Что делать

Загружать `jszip` в момент, когда он действительно нужен.

В `src/features/export/ExportAllService.ts` убрать статический импорт и взять его внутри
функции, которая собирает архив:

```ts
// jszip грузится по требованию: 95 кБ ради кнопки, которую в большинстве
// сессий не нажимают, не должны лежать в общем чанке.
const { default: JSZip } = await import('jszip');
```

Нужная функция — `exportAllAsZip` (строка 23), она уже `async`, так что сигнатуру
менять не придётся.

Ничего больше в этом файле не меняй: формат архива, имена файлов и порядок записей
остаются как есть.

## Проверка обеих задач

```
npm run build
ls -lS dist/assets/*.js | head -15
```

- `index-*.js` обязан стать заметно меньше 739 260 байт — назови новое число в отчёте;
- появился непустой `vendor-react-*.js`;
- `jszip` больше не в `index`. Проверить можно по карте исходников:

```
node -e "const m=require('./dist/assets/'+require('fs').readdirSync('dist/assets').find(f=>/^index-.*\.js\.map$/.test(f)));console.log(m.sources.filter(s=>s.includes('jszip')).length)"
```

должно напечатать `0` (подставь фактическое имя файла карты, если однострочник не
сработает — суть в том, что модулей jszip в карте `index` быть не должно).

Затем прогони обычный набор:

```
npx tsc --noEmit
npm run lint
npm run test:ci
```

И **вручную проверь, что выгрузка архива всё ещё работает** — H2 меняет момент
загрузки библиотеки, и сломать её молча очень легко. Если проверить в браузере не
можешь, так и напиши в отчёте.

---

# Как закончить

- `perf(build): put react in its own chunk, as the config always intended (H1)`
- `perf(build): load the zip library only when an export runs (H2)`

Не пушить. В отчёте: старый и новый размер `index`, полные списки чанков до и после
(H1 меняет разбивку и может задеть соседние), и сказал ли ты «проверил выгрузку» на
основании фактической проверки или нет.
