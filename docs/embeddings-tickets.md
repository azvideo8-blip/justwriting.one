# Семантический поиск по заметкам через эмбеддинги — тикеты

Документ для передачи в исполнителя (opencode). Цель — чтобы запрос «найди заметки про X / что я думал про Y / что годится в пост» не грузил все ~500 заметок в LLM.

---

## Общий контекст (читать перед любым тикетом)

Проект: `justwriting` — React + TS + Vite, бэкенд на Firebase Functions, деплой на Vercel. Заметки пользователя **на русском** и **E2E-зашифрованы**.

**Архитектура решения:**
- Эмбеддинги считаются **серверно** (вызов из клиента → Firebase callable).
- Векторы хранятся **зашифрованно** (E2E): локально в IndexedDB плейнтекстом (устройство доверенное), в облаке — зашифрованным JSON-полем.
- **Поиск целиком клиентский**: брутфорс-косинус в браузере (для 500–10k векторов это доли мс). Серверный векторный индекс невозможен — текст/саммари зашифрованы.
- Двухстадийно: эмбед запроса → cosine top-K локально → дешёвый вызов LLM по карточкам top-K (отбор под намерение) → полный текст только для финальных 3–5 заметок.

**Провайдер ИИ (важно):**
- Активен **Fireworks** (`AI_PROVIDER=fireworks` по умолчанию, см. `functions/src/shared/aiProvider.ts:8`), чат-модель `deepseek-v4-flash`. Gemini — только фолбэк.
- **DeepSeek эмбеддинги не делает.** Нужна отдельная embedding-модель.
- Заметки русские → модель обязана быть **мультиязычной**. Англоцентричные (`nomic-*`, `bge-*-en`, `gte-*`, `UAE-Large`, `mxbai`, `all-MiniLM-L6-v2`) **не подходят**.
- **Embed-модель по умолчанию: `fireworks/qwen3-embedding-8b`** (мультиязычная, топ MTEB-multilingual, Matryoshka). Размерность усекать до **1024** через параметр `dimensions`. Fallback: `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`.
- Идентификатор embed-модели — каталожная строка (`fireworks/qwen3-embedding-8b`), **не** формат `accounts/fireworks/models/...` (это для чат-моделей).
- Эндпоинт эмбеддингов: `POST {FIREWORKS_BASE_URL}/embeddings`, `FIREWORKS_BASE_URL = https://api.fireworks.ai/inference/v1`, заголовок `Authorization: Bearer ${FIREWORKS_API_KEY}`, тело `{ model, input: string[], dimensions: 1024 }`, ответ OpenAI-формата `{ data: [{ embedding: number[] }], usage }`.

**Эталонные файлы и паттерны (повторять стиль):**
- `src/core/storage/localDb.ts` — idb, `openDB<JustWritingDB>('justwriting-local', 5, { upgrade })`. Есть `AIDocumentSummary` (~стр. 87) и стор `aiSummaries` (keyPath `documentId`).
- `src/features/ai/services/AISummaryService.ts` — эталон сервиса: local IndexedDB + зашифрованный cloud через `maybeEncrypt`/`maybeDecrypt` из `src/core/crypto/cryptoHelpers`. Облачный путь `users/{uid}/summaries/{docId}`.
- `functions/src/ai/summarizeDocument.ts` — эталон callable: `onCall({ secrets: ['GEMINI_API_KEY','FIREWORKS_API_KEY'] })`, лимиты `checkDailyLimit/checkRateLimit/withinGlobalDailyLimit/recordUsage` из `../shared/aiUtils`, генерация через `generate`/`getActiveModel` из `../shared/aiProvider`.
- `functions/src/shared/aiProvider.ts` — провайдер-сим (`generate` → Fireworks/Gemini). Эмбеддинги добавить тем же паттерном.
- `functions/src/index.ts` — регистрация экспортов callable-функций.
- `src/features/ai/services/AIService.ts` — клиент, вызовы через `httpsCallable(functions, '<name>')`, `withTimeout`, `mapAIError`.
- `src/features/ai/hooks/useAIChat.ts` (`attachDocument`, ~стр. 296–341) — точка интеграции поиска в чат.

**Ограничения:** не нарушать слоевые границы (eslint `import/no-restricted-paths`). `maybeEncrypt(obj, stringFields, arrayFields, true)` шифрует только перечисленные поля. Вектор `number[]` в облаке хранить как JSON-строку в string-поле; локально — как `number[]`.

---

## Порядок и зависимости

```
EMB-1 → EMB-2 ┐
EMB-1 → EMB-3 ┘ → EMB-4 → EMB-5 → EMB-6 → EMB-7 → EMB-8
```

- EMB-1..3 — чистый клиент, без деплоя и без траты квоты Fireworks. Безопасны.
- EMB-5 требует деплоя функции.
- EMB-7 при первом прогоне проиндексирует весь корпус (~500 вызовов эмбеддингов — на Fireworks доли цента, но учесть лимиты/бэкофф).

---

## EMB-1 · Слой данных: стор `aiEmbeddings` в IndexedDB

**Файл:** `src/core/storage/localDb.ts`

**Задачи:**
- Добавить интерфейс:
  ```ts
  export interface AIDocumentEmbedding {
    documentId: string;
    vector: number[];
    model: string;     // напр. 'fireworks/qwen3-embedding-8b'
    dim: number;       // фактическая длина вектора (1024)
    contentHash: string;
    processedAt: number;
  }
  ```
- В `JustWritingDB` добавить `aiEmbeddings: { key: string; value: AIDocumentEmbedding };`.
- Бамп версии БД `5 → 6`. В `upgrade` добавить `if (oldVersion < 6) { db.createObjectStore('aiEmbeddings', { keyPath: 'documentId' }); }`. Существующие блоки не трогать.

**Приёмка:** tsc/`npm run build` проходит; при старте БД апгрейдится без ошибок, стор `aiEmbeddings` существует.

---

## EMB-2 · `AIEmbeddingService` (local + encrypted cloud)

**Файл (новый):** `src/features/ai/services/AIEmbeddingService.ts`

**Задачи:** зеркало `AISummaryService`. Методы:
- `get(documentId): Promise<AIDocumentEmbedding | undefined>` — сначала локально, иначе из облака (расшифровать → положить локально).
- `save(emb: AIDocumentEmbedding): Promise<void>` — локально + в облако; ошибку облака логировать, не блокировать UI (как в AISummaryService).
- `getAll(): Promise<AIDocumentEmbedding[]>` — все локальные (для поиска).
- `hasAll(): Promise<Record<string, boolean>>`.
- `delete(documentId): Promise<void>`.
- Облако: путь `users/{uid}/embeddings/{documentId}`. Перед записью `vectorJson = JSON.stringify(vector)`; шифровать `maybeEncrypt(obj, ['vectorJson','model','contentHash'], [], true)`; `dim`/`processedAt` в открытом виде. При чтении `maybeDecrypt` + `JSON.parse(vectorJson)` → `vector`.

**Приёмка:** tsc проходит; save→get round-trip даёт идентичный вектор; в облаке `vectorJson` зашифрован.

---

## EMB-3 · Утилита векторного поиска + тест

**Файл (новый):** `src/features/ai/utils/vectorSearch.ts`

**Задачи:**
- `cosineSimilarity(a: number[], b: number[]): number`.
- `topK(query: number[], items: { id: string; vector: number[] }[], k: number): { id: string; score: number }[]` — сортировка по убыванию score.
- Тест `__tests__/vectorSearch.test.ts`: идентичные векторы → score ≈ 1; ортогональные → ≈ 0; topK возвращает k штук в правильном порядке.

**Приёмка:** тесты зелёные.

---

## EMB-4 · Бэкенд: эмбеддинги в `aiProvider` через провайдер-сим

**Файл:** `functions/src/shared/aiProvider.ts`

**Задачи:**
- Добавить env-дефолт `FIREWORKS_EMBED_MODEL = process.env.FIREWORKS_EMBED_MODEL ?? 'fireworks/qwen3-embedding-8b'`.
- Экспорт `embed(texts: string[]): Promise<{ vectors: number[][]; model: string; dim: number; tokens: number }>` с тем же сим, что у `generate`:
  - `AI_PROVIDER === 'fireworks'` → `POST {FIREWORKS_BASE_URL}/embeddings`, заголовок `Authorization: Bearer ${FIREWORKS_API_KEY}`, тело `{ model: FIREWORKS_EMBED_MODEL, input: texts, dimensions: 1024 }`; ответ `{ data: [{ embedding }], usage }`; `dim = vectors[0].length`, `model = FIREWORKS_EMBED_MODEL`.
  - иначе (Gemini-фолбэк) → `text-embedding-004` через `@ai-sdk/google` `.textEmbeddingModel(...)` + `embedMany` из `ai`.
- AbortController/таймаут как в `generateFireworks`. Не ломать `generate`.

**Приёмка:** tsc в `functions` проходит; при `AI_PROVIDER=fireworks` возвращает 1024-мерные векторы от Fireworks.

---

## EMB-5 · Бэкенд: callable `embedDocument`

**Файлы (новый + правка):** `functions/src/ai/embedDocument.ts`, регистрация в `functions/src/index.ts`

**Задачи:** callable по образцу `summarizeDocument`:
- `onCall({ secrets: ['GEMINI_API_KEY','FIREWORKS_API_KEY'], timeoutSeconds: 120 })`, `request.auth` обязателен (иначе `unauthenticated`).
- Лимиты: `withinGlobalDailyLimit`, `checkDailyLimit`, `checkRateLimit`; учёт через `recordUsage`.
- Вход (zod): `{ content: string (min 1, max 50_000) }`.
- `sanitizeAiInput`; если текст длиннее ~1500 токенов — чанковать, `aiProvider.embed()` по чанкам, mean-pool в один вектор; иначе один вызов.
- Возврат: `{ vector: number[], model: string, dim: number }` — `model`/`dim` из ответа `aiProvider.embed` (не хардкодить).

**Приёмка:** деплой ок; вызов аутентифицированным юзером возвращает вектор; лимиты срабатывают.

---

## EMB-6 · Клиент: `AIService.embed()`

**Файл:** `src/features/ai/services/AIService.ts`

**Задачи:** метод `embed({ content }): Promise<{ ok: true; vector: number[]; model: string; dim: number } | { ok: false; error }>` через `httpsCallable(functions, 'embedDocument')`, `withTimeout`, `mapAIError` (как у `summarize`).

**Приёмка:** tsc проходит.

---

## EMB-7 · Фоновая инкрементальная индексация

**Файлы (новый хук + врезка):** `src/features/ai/hooks/useEmbeddingIndexer.ts` (+ подключить в AI-провайдере / корне приложения)

**Задачи:**
- Очередь: находить заметки без свежего эмбеддинга. «Свежесть» — сравнение `contentHash` (SHA-256 hex через `crypto.subtle.digest` от текста последней версии) с сохранённым в `AIDocumentEmbedding`. Также пересчёт, если `model`/`dim` ≠ текущим.
- Триггеры: онлайн + простой (debounce после правок / `requestIdleCallback` / при открытии экрана). Обрабатывать по 1–3 заметки за тик, бэкофф при `RATE_LIMIT`/`DAILY_LIMIT`.
- На заметку: текст → `AIService.embed` → `AIEmbeddingService.save`.
- Неизменённые заметки ИИ не дёргают.

**Приёмка:** дописанная заметка через короткое время получает запись в `aiEmbeddings`; повторная индексация неизменённой заметки вызовов ИИ не делает.

---

## EMB-8 · Поиск по заметкам в AI-чате

**Файлы:** `src/features/ai/hooks/useAIChat.ts` (+ при необходимости небольшой util ретрива)

**Задачи:**
- Capability «искать по моим заметкам»:
  1. `AIService.embed({ content: query })` → вектор запроса;
  2. `AIEmbeddingService.getAll()` + `topK` (k ≈ 15);
  3. по top-K подтянуть карточки из `AISummaryService` (tone/themes/insights) → один дешёвый вызов LLM, который под намерение запроса отбирает финальные 3–5 `documentId`;
  4. для выбранных — грузить **полный текст** (как в текущем `attachDocument`) и отдавать в ответ/черновик.
- Грейсфул-фолбэк: у заметки нет эмбеддинга — не падать (индексатор догонит).

**Приёмка:** реальный запрос («что я писал про <тему>») возвращает релевантные заметки; в LLM уходит только шортлист, не весь корпус.

---

## Открытые решения (зафиксированы)

- **Гранулярность v1:** один вектор на заметку (mean-pool по чанкам). Мульти-вектор/чанки — отдельный апгрейд, если не хватит recall.
- **Размерность:** 1024 (усечение Qwen3 через `dimensions`). Баланс качество/объём.
- **Реиндекс:** при изменении `contentHash` ИЛИ `model` ИЛИ `dim` → пересчитать. Запрос и индекс обязаны быть на одной модели/размерности, иначе косинус бессмыслен.

## Проверить при интеграции

- `fireworks/qwen3-embedding-8b` доступна по вашему `FIREWORKS_API_KEY` и принимает параметр `dimensions`. Если нет — усечь вектор клиентом или взять fallback `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`.

## Источники

- Fireworks: Create embeddings (API reference) — https://docs.fireworks.ai/api-reference/creates-an-embedding-vector-representing-the-input-text
- Fireworks blog: Announcing Embeddings and Reranking — https://fireworks.ai/blog/embeddings-and-reranking-announcement
