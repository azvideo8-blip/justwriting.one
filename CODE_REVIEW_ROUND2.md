# Code Review — justwriting (Round 2)

Дата: 2026-05-23  
Статус: повторная проверка после первой ревью  
Из 36 исходных тикетов: 22 исправлены, 5 не исправлены, 4 частично исправлены, 1 частично исправлен (P-01).  

Ниже — тикеты на все оставшиеся проблемы.

---

## ❌ Не исправленные (5)

### [S-04] sanitizeAiResponse: regex-санитизация вместо DOMPurify
- **Severity:** High
- **Category:** Security
- **Location:** `functions/src/ai/editWithAI.ts:32-43`
- **Description:** Функция `sanitizeAiResponse` по-прежнему использует набор regex-выражений для удаления `<script>`, `<iframe>`, `<style>`, `on*=` атрибутов и `javascript:` URI. Комментарий `[S-04] расширенная санитизация` говорит о том, что regex был расширен, но принципиально подход не изменился. Regex-санитизация HTML фундаментально ненадёжна:
  - `<img src=x onerror=alert(1)>` — `onerror` без кавычек может пройти мимо `on\w+\s*=\s*"[^"]*"`
  - HTML entity encoding: `&#106;avascript:` обходит `javascript:` фильтр
  - `<svg/onload=alert(1)>` — `/` между тегом и атрибутом
  - Null bytes, Unicode tricks, и десятки других обходных путей
- **Suggested Fix:**
  1. Установить `dompurify` в `functions/`:
     ```bash
     cd functions && npm install isomorphic-dompurify
     ```
  2. Заменить `sanitizeAiResponse`:
     ```ts
     import DOMPurify from 'isomorphic-dompurify';
     
     function sanitizeAiResponse(response: string): string {
       return DOMPurify.sanitize(response, {
         ALLOWED_TAGS: [],        // убрать весь HTML
         ALLOWED_ATTR: [],        // убрать все атрибуты
         ALLOW_DATA_ATTR: false,
       });
     }
     ```
  3. Если нужно сохранить базовое форматирование (жир, курсив):
     ```ts
     DOMPurify.sanitize(response, {
       ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'br', 'p', 'ul', 'ol', 'li'],
       ALLOWED_ATTR: [],
     });
     ```

---

### [L-01] Mood Check-in: данные настроения не сохраняются
- **Severity:** High
- **Category:** Logic
- **Location:** `src/features/writing/WritingFinishModal.tsx` (кнопки 😊🙂😐😔😤)
- **Description:** Экран «mood check-in» отображается после сохранения сессии. Все 5 кнопок-эмодзи и кнопка «Skip» вызывают один и тот же `onCancel`, который просто закрывает модал. Нет переменной `mood`, нет callback-пропа для передачи mood наверх, нет персистенции. Пользователь видит приглашение выбрать настроение, делает выбор — и результат теряется.
- **Suggested Fix:**
  1. Добавить `mood` в тип `Session` и в `SaveData`:
     ```ts
     // types/index.ts
     export interface Session {
       // ... existing fields
       mood?: string;
     }
     
     // WritingFinishModal.tsx
     export interface SaveData {
       title: string;
       tags: string[];
       labelId?: string;
       mood?: string;  // <-- добавить
     }
     ```
  2. В `WritingFinishModal` добавить state и handler:
     ```ts
     const [mood, setMood] = useState<string | null>(null);
     
     const handleMoodSelect = (selectedMood: string) => {
       setMood(selectedMood);
       onSave({ ...saveData, mood: selectedMood });
     };
     ```
  3. Заменить `onClick={onCancel}` на кнопках эмодзи:
     ```tsx
     <motion.button
       onClick={() => handleMoodSelect(emoji)}
       className={cn("text-4xl", mood === emoji && "scale-125 ring-2")}
     >
       {emoji}
     </motion.button>
     ```
  4. Кнопка «Skip» оставляет `mood = undefined` и закрывает модал.
  5. В `handleSave` в `WritingPage.tsx` передать `mood` дальше в `StorageService`/`SessionService`.

---

### [L-02] Три копипаст-функции: resetSession / finishSession / resetAndClear
- **Severity:** Medium
- **Category:** Architecture
- **Location:** `src/features/writing/store/storeActions.ts` (3 функции с одинаковыми телами)
- **Description:** В исходном ревью было 3 алиаса на одну функцию. Сейчас — 3 отдельные функции с идентичными телами (копипаст). Это хуже: при изменении логики одной из них нужно не забыть обновить остальные. Концептуально `finishSession` и `resetAndClear` должны делать разное: finish — завершить сессию корректно (сохранив данные для статистики), reset — форсированно очистить.
- **Suggested Fix:**
  ```ts
  function resetSession() {
    clearWordCalcTimer();
    useContentStore.setState(createContentDefaults());
    useTimerStore.setState(TIMER_DEFAULTS);
    useSessionMetaStore.setState(META_DEFAULTS);
  }

  // Если сейчас семантика одинаковая — используем алиасы:
  export { resetSession, resetSession as finishSession, resetSession as resetAndClear };
  
  // Если в будущем finishSession должен отличаться — делегировать:
  // export function finishSession() {
  //   // TODO: сохранить статистику перед сбросом
  //   resetSession();
  // }
  // export { resetSession as resetAndClear };
  ```

---

### [U-01] Мёртвый код: 70 строк закомментированных Pinned Thoughts + неиспользуемые переменные
- **Severity:** Medium
- **Category:** UI
- **Location:** `src/features/writing/WritingEditor.tsx:31-32,57-63,70-138`
- **Description:** В файле остались:
  - `newThought` / `setNewThought` (строка 31) — state только для закомментированного UI
  - `showAddForm` / `setShowAddForm` (строка 32) — state только для закомментированного UI
  - `handleAddThought` (строки 57-63) — функция только для закомментированного UI
  - 68 строк закомментированного JSX (строки 70-138)
  - Импорты `Pin`, `Plus` из lucide-react — `Pin` не используется, `Plus` не используется, `X` используется только в закомментированном коде
  
  Это мусор, который затрудняет чтение и поддержку файла.
- **Suggested Fix:**
  1. Удалить строки 31-32 (`newThought`, `showAddForm`)
  2. Удалить строки 57-63 (`handleAddThought`)
  3. Удалить строки 70-138 (весь закомментированный JSX)
  4. Удалить `Pin`, `Plus` из импортов lucide-react; `X` — проверить, используется ли ещё где-то в файле
  5. Если фича Pinned Thoughts планируется вернуть — создать ветку `feature/pinned-thoughts` и держать код там

---

### [P-05] WritingEditor ре-рендерится на каждый статус-переход таймера
- **Severity:** Medium
- **Category:** Performance
- **Location:** `src/features/writing/WritingEditor.tsx:22,151`
- **Description:**
  ```ts
  const _status = useTimerStore(s => s.status);      // строка 22
  readOnly={_status === 'paused'}                      // строка 151
  ```
  `WritingEditor` подписан на полный `status` (`'idle' | 'writing' | 'paused'`). Любой переход между статусами вызывает ре-рендер всего memo-компонента. Но для `readOnly` важно только `paused` vs `not-paused`. При активной сессии (`writing`) `checkGoals` обновляет `seconds` каждую секунду — это не вызывает ре-рендер WritingEditor напрямую, но переход `idle → writing` и `writing → paused` вызывает полный ре-рендер с пересозданием textarea.
- **Suggested Fix:**
  Заменить подписку на булевый селектор:
  ```ts
  // Было:
  const _status = useTimerStore(s => s.status);
  readOnly={_status === 'paused'}
  
  // Стало:
  const isPaused = useTimerStore(s => s.status === 'paused');
  readOnly={isPaused}
  ```
  Это гарантирует, что WritingEditor ре-рендерится только при входе/выходе из `paused`, а не при каждом переходе между `idle` и `writing`.

---

## ⚠️ Частично исправленные (5)

### [A-03] Дублирование draft load/restore логики
- **Severity:** Medium
- **Category:** Architecture
- **Location:** `src/features/writing/hooks/useGuestWritingSession.ts:79-123`; `src/features/writing/hooks/useSessionPersistence.ts:114-139`
- **Description:** Autosave-логика унифицирована, но логика загрузки/восстановления черновика дублируется:
  - `useGuestWritingSession`: `autoLoadDraftIfEmpty` / `restoreDraft` — вручную вызывают `loadGuestDraftFromStorage()` → `loadDraftIntoStore()` + `useContentStore.setState()` + `useTimerStore.setState()`
  - `useSessionPersistence`: `applyDraftToStore` + `loadDraft` / `restoreDraft` — тот же паттерн через `WritingDraftService.loadDraft()`
  
  Паттерн «загрузить draft → записать в 3 стора» повторяется с разными бэкендами.
- **Suggested Fix:**
  1. Создать общий `applyDraftToStores(draft: DraftData)`:
     ```ts
     // src/features/writing/utils/draftUtils.ts
     export function applyDraftToStores(draft: DraftData) {
       loadDraftIntoStore({
         content: draft.content,
         title: draft.title ?? '',
         wordCount: draft.wordCount ?? 0,
         savedDocumentId: draft.savedDocumentId ?? null,
         accumulatedDuration: draft.accumulatedDuration ?? 0,
       });
       useContentStore.setState({
         pinnedThoughts: Array.isArray(draft.pinnedThoughts) ? draft.pinnedThoughts : [],
         tags: Array.isArray(draft.tags) ? draft.tags : [],
         labelId: draft.labelId ?? undefined,
       });
       useTimerStore.setState({
         seconds: draft.seconds ?? 0,
         accumulatedDuration: draft.accumulatedDuration ?? 0,
         totalPauseSeconds: draft.totalPauseSeconds ?? 0,
       });
       useTimerStore.getState().setSessionStart();
     }
     ```
  2. Использовать в обоих хуках.

---

### [A-04] ProfileService: дублирующее логирование (reportError + handleFirestoreError)
- **Severity:** Low
- **Category:** Architecture
- **Location:** `src/features/profile/services/ProfileService.ts` (все 6 catch-блоков)
- **Description:** SessionService исправлен (оставлен только `handleFirestoreError`), но ProfileService по-прежнему вызывает оба:
  ```ts
  reportError(err, { action: 'updateNickname', userId });
  handleFirestoreError(err, OperationType.UPDATE, `users/${userId}`);
  ```
  Каждая ошибка логируется дважды: один раз через `reportError` (Sentry + console), другой раз через `handleFirestoreError` (который внутри тоже вызывает `reportError`). Это загромождает Sentry и консоль.
- **Suggested Fix:**
  Убрать `reportError` из каждого catch-блока, оставив только `handleFirestoreError` (как в SessionService):
  ```ts
  catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${userId}`);
    throw err;
  }
  ```
  Добавить комментарий: `// [A-04] дублирующий reportError убран: handleFirestoreError уже логирует внутри`

---

### [A-08] SyncService.syncAllUnlinked: `_syncInProgress.set(userId, false)` вместо `.delete()`
- **Severity:** Low
- **Category:** Architecture
- **Location:** `src/features/writing/services/SyncService.ts:79`
- **Description:** Метод `syncPending` исправлен (использует `.delete()`), но `syncAllUnlinked` по-прежнему использует:
  ```ts
  _syncInProgress.set(userId, false);  // строка 79 в finally
  ```
  Это оставляет ключ в Map со значением `false`, вместо удаления. При многократных вызовах с разными userId Map растёт бесконечно.
- **Suggested Fix:**
  ```ts
  // В syncAllUnlinked, блок finally:
  finally {
    _syncInProgress.delete(userId);  // [A-08] delete вместо set(false)
  }
  ```

---

### [P-01] Глобальный `_wordCalcTimer` — механизм setTimeout не заменён на requestAnimationFrame
- **Severity:** Low
- **Category:** Performance
- **Location:** `src/features/writing/store/useContentStore.ts:29-30`
- **Description:** Добавлен coalescing guard `_wordCalcIsScheduled`, что частично решает проблему дублирования таймеров. Но механизм по-прежнему `setTimeout(() => get().recalcStats(), 100)`. Проблема: при unmount компонента-инициатора таймер всё ещё сработает (Zustand-стор глобальный — краша нет, но это холостой выстрел). `requestAnimationFrame` лучше привязан к рендер-циклу и автоматически не срабатывает для скрытых вкладок.
- **Suggested Fix:**
  ```ts
  let _wordCalcRaf: number | null = null;
  let _wordCalcIsScheduled = false;
  
  export function clearWordCalcTimer() {
    if (_wordCalcRaf != null) cancelAnimationFrame(_wordCalcRaf);
    _wordCalcRaf = null;
    _wordCalcIsScheduled = false;
  }
  
  // В setContent:
  setContent: (content) => {
    set({ content });
    if (_wordCalcIsScheduled) return;
    _wordCalcIsScheduled = true;
    _wordCalcRaf = requestAnimationFrame(() => {
      _wordCalcIsScheduled = false;
      _wordCalcRaf = null;
      get().recalcStats();
    });
  },
  ```

---

### [S-03] Firebase App Check не настроен
- **Severity:** Medium
- **Category:** Security
- **Location:** Проект в целом: нет конфигурации ни в `src/`, ни в `functions/`, ни в `firebase.json`
- **Description:** `.env.local` корректно исключён из git. Однако Firebase App Check не настроен — это означает, что любой может использовать Firebase API ключ проекта для вызовов к Firestore из неавторизованных клиентов. App Check верифицирует, что запросы исходят от легитимного приложения.
- **Suggested Fix:**
  1. Включить App Check в Firebase Console (reCAPTCHA v3 или reCAPTCHA Enterprise).
  2. Инициализировать на клиенте:
     ```ts
     // src/core/firebase/client.ts
     import { initializeApp } from 'firebase/app';
     import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
     
     export const app = initializeApp(firebaseConfig);
     if (import.meta.env.PROD) {
       initializeAppCheck(app, {
         provider: new ReCaptchaV3Provider(import.meta.env.VITE_RECAPTCHA_SITE_KEY),
         isTokenAutoRefreshEnabled: true,
       });
     }
     ```
  3. Добавить `VITE_RECAPTCHA_SITE_KEY` в `.env.local` / Vercel env vars.
  4. В Cloud Functions добавить enforcement:
     ```ts
     // functions/src/ai/editWithAI.ts
     export const editWithAI = onCall({
       enforceAppCheck: true,  // отклонять запросы без App Check токена
       secrets: ['GEMINI_API_KEY'],
     }, async (request) => { ... });
     ```
