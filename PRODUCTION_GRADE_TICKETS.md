# Production-Grade Improvement Tickets — justwriting

Дата: 2026-05-23  
Категории: Тесты, Кросс-стор зависимости, Обработка ошибок

---

## Часть 1. Тесты

### [T-01] Тесты для `countWords` — фундамент всех метрик
- **Severity:** High
- **Category:** Tests
- **Location:** `src/shared/utils/countWords.ts` — 0 тестов
- **Description:** `countWords` — функция, на которой строятся WPM, word goals, achievements, session persistence. Один баг в ней молча отравляет все метрики приложения. При этом она парсит текст (разные языки, дефисы, эмодзи, Unicode) — типичный источник краевых случаев.
- **Suggested Fix:**
  ```ts
  // src/shared/utils/__tests__/countWords.test.ts
  import { countWords } from '../countWords';
  
  describe('countWords', () => {
    it('returns 0 for empty string', () => expect(countWords('')).toBe(0));
    it('counts English words', () => expect(countWords('hello world')).toBe(2));
    it('counts Russian words', () => expect(countWords('привет мир')).toBe(2));
    it('counts mixed language', () => expect(countWords('hello мир')).toBe(2));
    it('ignores extra whitespace', () => expect(countWords('  hello   world  ')).toBe(2));
    it('handles hyphenated words', () => expect(countWords('well-known fact')).toBe(2));
    it('handles emojis', () => expect(countWords('hello 😊 world')).toBe(2));
    it('handles line breaks', () => expect(countWords('hello\nworld')).toBe(2));
    it('handles punctuation-only input', () => expect(countWords('... --- !!!')).toBe(0));
    it('handles very long text', () => {
      const text = 'word '.repeat(10000);
      expect(countWords(text)).toBe(10000);
    });
  });
  ```

---

### [T-02] Тесты для `encryptMigration` — защита от потери данных
- **Severity:** High
- **Category:** Tests
- **Location:** `src/core/crypto/encryptMigration.ts` — 0 тестов
- **Description:** Массовое шифрование всех заметок пользователя. Баг здесь может привести к необратимой потере данных. Функция `encryptAllExistingNotes` итерирует документы, шифрует контент, обновляет Firestore/IDB, управляет чекпоинтом. Нет ни одного теста.
- **Suggested Fix:**
  ```ts
  // src/core/crypto/__tests__/encryptMigration.test.ts
  describe('encryptAllExistingNotes', () => {
    it('encrypts all unencrypted documents');
    it('skips already encrypted documents');
    it('saves checkpoint after each batch');
    it('resumes from checkpoint on retry');
    it('aborts when signal is aborted');
    it('reports progress via callback');
    it('handles individual document encryption failure gracefully');
    it('handles checkpoint save failure');
    it('handles empty document list');
    it('does not corrupt data if encryption fails mid-way');
  });
  ```
  Мокировать: Firestore, IDB, `maybeEncrypt`, `getSessionKey`. Использовать реальные ключи через Web Crypto API.

---

### [T-03] Тесты для `useEncryptionStore` — жизненный цикл ключей
- **Severity:** Medium
- **Category:** Tests
- **Location:** `src/core/crypto/useEncryptionStore.ts` — 0 тестов
- **Description:** Zustand-стор, управляющий криптографическим ключом (`dataKey`), состоянием vault (locked/unlocked), флагом `encryptionEnabled`. Нет тестов на lock/unlock, onAuthChange, persistence в localStorage.
- **Suggested Fix:**
  ```ts
  describe('useEncryptionStore', () => {
    it('starts with null dataKey and locked vault');
    it('setKey stores CryptoKey and sets isVaultUnlocked=true');
    it('lockVault clears dataKey and sets isVaultUnlocked=false');
    it('lockVault sets encryptionEnabled=false in localStorage');
    it('isEncryptionEnabled reads from localStorage cache');
    it('isEncryptionEnabled returns false for guest users');
    it('onAuthChange clears key when user logs out');
    it('onAuthChange preserves key when same user re-authenticates');
  });
  ```

---

### [T-04] Тесты для `DiffService` — корректность diff между версиями
- **Severity:** Medium
- **Category:** Tests
- **Location:** `src/features/writing/services/DiffService.ts` — 0 тестов
- **Description:** `computeWordDelta(prevContent, newContent)` вычисляет `wordsAdded` и `charsAdded` между версиями документа. Используется при сохранении каждой версии. Некорректный diff → неверная статистика версий.
- **Suggested Fix:**
  ```ts
  describe('computeWordDelta', () => {
    it('returns 0 added for identical content');
    it('counts added words at the end');
    it('counts added words in the middle');
    it('handles completely new content (empty prevContent)');
    it('handles deleted content (wordsAdded=0)');
    it('counts charsAdded as length difference');
    it('handles Unicode correctly');
    it('handles whitespace-only changes');
  });
  ```

---

### [T-05] Тесты для `draftUtils.applyDraftToStores`
- **Severity:** Medium
- **Category:** Tests
- **Location:** `src/features/writing/utils/draftUtils.ts` — 0 тестов
- **Description:** Общая утилита для записи данных черновика в 3 Zustand-стора. Это единая точка входа для загрузки/восстановления черновиков. Если она ломается — ломается всё: и guest, и cloud сессии.
- **Suggested Fix:**
  ```ts
  describe('applyDraftToStores', () => {
    it('writes content, title, wordCount to useContentStore');
    it('writes pinnedThoughts as array, defaults to []');
    it('writes tags as array, defaults to []');
    it('writes seconds, accumulatedDuration to useTimerStore');
    it('writes savedDocumentId to useSessionMetaStore');
    it('calls useTimerStore.setSessionStart()');
    it('sets activeSessionId when provided');
    it('handles null/undefined fields gracefully');
  });
  ```

---

### [T-06] Замена smoke-теста `ExportService` на реальные тесты
- **Severity:** Medium
- **Category:** Tests
- **Location:** `src/features/export/tests/ExportService.test.ts` — 11 строк, проверяет только `typeof === 'function'`
- **Description:** Текущий тест даёт ложное чувство безопасности. Он не проверяет, что экспорт работает корректно. Пользователь может получить пустой файл или битый PDF — и это будет обнаружено только на проде.
- **Suggested Fix:**
  ```ts
  describe('ExportService', () => {
    describe('toTxt', () => {
      it('returns plain text with title and content');
      it('handles empty title');
      it('handles empty content');
    });
    describe('toMarkdown', () => {
      it('starts with # title');
      it('includes tags as #tag');
      it('includes word count and duration');
      it('generates correct filename');
    });
    describe('toDocx', () => {
      it('generates a valid DOCX blob');
      it('includes title as heading');
      it('includes content as paragraphs');
    });
    // toPDF сложнее тестировать — хотя бы проверить, что не бросает
    describe('toPDF', () => {
      it('does not throw for valid input');
    });
  });
  ```

---

### [T-07] Тесты для `storeActions` — критические оркестрации
- **Severity:** Medium
- **Category:** Tests
- **Location:** `src/features/writing/store/storeActions.ts` — частичное покрытие через `writingStore.test.ts`
- **Description:** `loadDraftIntoStore` и `setSessionConfig` — функции, которые пишут в 3 стора одновременно. Они не протестированы изолированно. `setSessionConfig` динамически распределяет поля по сторам — это хрупкая логика.
- **Suggested Fix:**
  ```ts
  describe('loadDraftIntoStore', () => {
    it('sets content, title, wordCount in useContentStore');
    it('sets idle status and accumulatedDuration in useTimerStore');
    it('sets savedDocumentId in useSessionMetaStore');
    it('resets wpm and wordSnapshots');
    it('defaults accumulatedDuration to 0 when not provided');
  });
  
  describe('setSessionConfig', () => {
    it('routes content keys to useContentStore');
    it('routes timer keys to useTimerStore');
    it('routes meta keys to useSessionMetaStore');
    it('handles mixed keys across all three stores');
    it('sanitizes tags: slice(0,10), String(t).slice(0,50)');
    it('coerces non-array pinnedThoughts to []');
    it('ignores unknown keys silently');
  });
  ```

---

### [T-08] Тесты для `useDraftAutosave` и `useDraftManager`
- **Severity:** Medium
- **Category:** Tests
- **Location:** `src/features/writing/hooks/useDraftAutosave.ts`, `useDraftManager.ts` — 0 тестов
- **Description:** Эти хуки управляют автосохранением черновиков каждые 30 секунд и при `visibilitychange`. Это критический механизм предотвращения потери данных. Ни одного теста.
- **Suggested Fix:** Использовать `@testing-library/react` + `vi.useFakeTimers()`:
  ```ts
  describe('useDraftAutosave', () => {
    it('saves draft every 30s during writing session');
    it('does not save when status is idle');
    it('saves on visibilitychange to hidden');
    it('reports save status: idle → saving → saved');
    it('reports error on write failure');
    it('stops saving after unmount');
  });
  ```

---

### [T-09] Тесты для Firestore-сервисов (`DocumentService`, `VersionService`, `SessionService`)
- **Severity:** Low
- **Category:** Tests
- **Location:** `src/features/writing/services/` — 0 прямых тестов (только моки в других тестах)
- **Description:** Все 3 сервиса только мокируются в других тестах. Их собственная логика (валидация полей, `clean` объекта от `undefined`, обработка ошибок) никогда не проверяется. При изменении внутренней логики тесты-потребители не поймают регрессию.
- **Suggested Fix:** Создать интеграционные тесты с Firebase Emulator:
  ```ts
  // Или: мокировать getClient() и проверять вызовы
  describe('SessionService', () => {
    it('saveSession strips undefined fields before setDoc');
    it('deleteSession reports and rethrows on failure');
    it('updateSessionTags adds serverTimestamp');
    it('getAllSessions returns parsed sessions without client sort');
    it('getAllSessions returns empty array on Firestore error');
  });
  ```

---

## Часть 2. Кросс-стор зависимости

### [X-01] Циклическая зависимость: `useTimerStore` ↔ `useContentStore`
- **Severity:** High
- **Category:** Architecture
- **Location:**
  - `useTimerStore` читает `useContentStore.wordCount` → строки 70, 152, 167
  - `useContentStore` читает `useTimerStore.status/sessionStartWords/wordGoal` → строки 74, 93, 94
  - `useContentStore` пишет `useTimerStore.wordGoalReached` → строки 70, 109
- **Description:** Цикл данных:
  ```
  Timer читает Content.wordCount → устанавливает sessionStartWords
  Content читает Timer.sessionStartWords + wordGoal → вычисляет wordGoalReached
  Content пишет Timer.wordGoalReached → Timer теперь имеет флаг
  ```
  Это хрупко: при рефакторинге одного стора легко сломать другой. `useContentStore.recalcStats()` — самая опасная точка: она читает из Timer и пишет обратно в Timer, создавая побочный эффект внутри «вычисления контента».
- **Suggested Fix:** Два варианта:

  **Вариант A (минимальный, Recommended):** Вынести `wordGoalReached`-логику из `useContentStore.recalcStats` в `storeActions` или отдельную функцию, вызываемую после `recalcStats`:
  ```ts
  // useContentStore — убрать запись в Timer
  recalcStats: () => {
    // ... вычисляет wordCount, wpm, wordSnapshots
    set({ wordCount, wpm, wordSnapshots });
    // НЕ писать в useTimerStore отсюда!
  },

  // Новая функция в storeActions.ts
  export function checkWordGoal() {
    const { wordCount } = useContentStore.getState();
    const { sessionStartWords, wordGoal } = useTimerStore.getState();
    const sessionWords = wordCount - sessionStartWords;
    const wordGoalReached = wordGoal > 0 && sessionWords >= wordGoal;
    useTimerStore.setState({ wordGoalReached });
  }
  
  // Вызывать после recalcStats:
  // В setContent callback или в checkGoals interval
  ```
  Теперь `useContentStore` не знает о `useTimerStore` — зависимость однонаправленная.

  **Вариант B (радикальный):** Объединить `useContentStore` и `useTimerStore` в единый `useWritingStore` с чёткими подсекциями. Это устраняет цикл полностью, но требует рефакторинга всех потребителей.

---

### [X-02] `useTimerStore` читает `useContentStore.wordCount` для `sessionStartWords`
- **Severity:** Medium
- **Category:** Architecture
- **Location:** `useTimerStore.ts:70,152,167` — `useContentStore.getState().wordCount`
- **Description:** Три метода TimerStore (`setSessionStart`, `setWordGoal`, `startFreeSession`) читают `useContentStore.getState().wordCount`. Это violates принцип: «стор не должен знать о другом сторе». Если `useContentStore` ещё не инициализирован или wordCount неактуален, `sessionStartWords` будет установлен некорректно.
- **Suggested Fix:** Передавать `wordCount` как параметр:
  ```ts
  // Было:
  setSessionStart: () => set((state) => ({
    sessionStartWords: useContentStore.getState().wordCount,
    // ...
  })),
  
  // Стало:
  setSessionStart: (wordCount: number) => set((state) => ({
    sessionStartWords: wordCount,
    sessionStartSeconds: state.getElapsedSeconds(),
    sessionStartAccMs: state._accumulatedMs,
    sessionStartWallMs: state._startWallMs,
  })),
  ```
  Вызывающая сторона (компонент/hook) предоставляет `wordCount` из `useContentStore`.

---

### [X-03] `storeActions.setSessionConfig` — динамическая маршрутизация полей по ключам
- **Severity:** Low
- **Category:** Architecture
- **Location:** `src/features/writing/store/storeActions.ts:80-106`
- **Description:** Функция принимает `Record<string, unknown>` и распределяет поля по 3 сторам на основе Set-ов ключей. Это хрупко: при добавлении нового поля в один из Storov нужно не забыть обновить `contentKeys`/`timerKeys`/`metaKeys`. При опечатке в ключе — поле тихо теряется.
- **Suggested Fix:**
  1. Добавить DEV-mode предупреждение о неизвестных ключах:
     ```ts
     if (import.meta.env.DEV) {
       const allKnown = new Set([...contentKeys, ...timerKeys, ...metaKeys]);
       const unknown = Object.keys(config).filter(k => !allKnown.has(k));
       if (unknown.length > 0) {
         console.warn('[setSessionConfig] Unknown keys dropped:', unknown);
       }
     }
     ```
  2. Рассмотреть типизированную альтернативу: `setSessionConfig({ content: {...}, timer: {...}, meta: {...} })`.

---

## Часть 3. Обработка ошибок

### [E-01] `LoginPage.tsx:90` — потеря ключей шифрования при регистрации
- **Severity:** High
- **Category:** Security / Error Handling
- **Location:** `src/features/auth/pages/LoginPage.tsx:90`
- **Description:** При регистрации пользователь устанавливает шифрование. Если запись в Firestore падает (строка 84 — ошибка залогирована), код пытается сохранить ключи в `sessionStorage` как фоллбэк (строка 90). Если и `sessionStorage.setItem` падает — ключи теряются навсегда. Пользователь только что создал vault, и он уже безвозвратно заблокирован.
- **Suggested Fix:**
  ```ts
  try {
    sessionStorage.setItem('pending_encryption_keys', JSON.stringify({ ... }));
  } catch (storageErr) {
    reportError(storageErr, { action: 'saveEncryptionKeys_fallback', userId });
    showToast(t('error_encryption_key_save_failed'), 'error');
    // Не продолжать — пользователь должен знать, что ключи не сохранены
    return;
  }
  ```

---

### [E-02] `useDraftAutosave.ts:93` — автосохранение молча проваливается
- **Severity:** High
- **Category:** Error Handling
- **Location:** `src/features/writing/hooks/useDraftAutosave.ts:93`
- **Description:** При `visibilitychange` (пользователь переключает вкладку) autosave пытается записать черновик. Если `localStorage.setItem` падает (quota exceeded), catch-блок молча игнорирует ошибку. Пользователь переключает вкладку, ожидая что работа сохранена — но это не так.
- **Suggested Fix:**
  ```ts
  catch (err) {
    const isQuota = err instanceof DOMException && err.name === 'QuotaExceededError';
    if (isQuota) {
      reportError(err, { action: 'autosave_quota_exceeded', userId }, 'warning');
      setSaveStatus('error');
    } else {
      reportError(err, { action: 'autosave_visibility', userId });
      setSaveStatus('error');
    }
  }
  ```

---

### [E-03] `GuestDraftService` — 7 молчащих catch-блоков, из них 2 критических
- **Severity:** High
- **Category:** Error Handling
- **Location:** `src/features/writing/services/GuestDraftService.ts` — строки 23, 24, 35, 53, 64, 72, 78
- **Description:** Гостевой черновик — единственные данные неавторизованного пользователя. Если IDB-запись (строка 23) И localStorage-запись (строка 24) обе падают молча — черновик потерян безвозвратно. Пользователь не получает никакого сигнала. Остальные 5 catch-блоков (чтение, миграция, удаление) менее критичны, но тоже заслуживают логирования в DEV-режиме.
- **Suggested Fix:**
  ```ts
  export async function saveGuestDraftToStorage(draft: GuestDraftData): Promise<void> {
    const withMeta = { ...draft, updatedAt: Date.now() };
    let idbOk = false;
    let lsOk = false;
    
    try {
      const db = await getLocalDb();
      if (db.objectStoreNames.contains('drafts')) {
        await db.put('drafts', { ...withMeta, userId: GUEST_IDB_KEY } as LocalDraft);
        idbOk = true;
      }
    } catch (e) {
      reportError(e, { action: 'saveGuestDraft_idb' }, 'warning');
    }
    
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(withMeta));
      lsOk = true;
    } catch (e) {
      reportError(e, { action: 'saveGuestDraft_ls' }, 'warning');
    }
    
    if (!idbOk && !lsOk) {
      throw new Error('GUEST_DRAFT_SAVE_FAILED: both IDB and localStorage failed');
    }
  }
  ```
  Вызывающая сторона (`useDraftManager`) обработает эту ошибку и покажет toast.

---

### [E-04] `useTagEditor` — 4 fire-and-forget `.catch(() => {})` для критических операций
- **Severity:** High
- **Category:** Error Handling
- **Location:** `src/features/archive/hooks/useTagEditor.ts:14,16,23,25`
- **Description:** Переименование и удаление тегов — операции, которые модифицируют данные пользователя. Все 4 вызова используют `.catch(() => {})`:
  - Строка 14: `DocumentService.renameTagInAllDocs(...).catch(() => {})` — облако не обновлено
  - Строка 16: `LocalDocumentService.renameTagInAllDocs(...).then(fetchSessions).catch(() => {})` — локальные данные + refresh не работают
  - Строки 23, 25: аналогично для удаления тегов
  
  Результат: UI показывает успешное переименование, но данные не изменены. При следующей синхронизации старый тег вернётся.
- **Suggested Fix:**
  ```ts
  // Переименование тега
  const handleRenameTag = useCallback(async (tag: string, trimmed: string) => {
    if (!trimmed || trimmed === tag) return;
    try {
      await Promise.all([
        DocumentService.renameTagInAllDocs(userId, tag, trimmed),
        LocalDocumentService.renameTagInAllDocs(userId, tag, trimmed),
      ]);
      await fetchSessions();
      showToast(t('tag_renamed'), 'success');
    } catch (err) {
      reportError(err, { action: 'renameTag', tag, newTag: trimmed });
      showToast(t('error_tag_rename_failed'), 'error');
    } finally {
      setRenamingTag(null);
    }
  }, [userId, fetchSessions, showToast, t]);
  ```

---

### [E-05] `encryptMigration.ts:31` — потеря чекпоинта миграции
- **Severity:** Medium
- **Category:** Error Handling
- **Location:** `src/core/crypto/encryptMigration.ts:31`
- **Description:** Если сохранение чекпоинта миграции в localStorage падает, `catch { /* ignore */ }` молча проглатывает ошибку. Без чекпоинта миграция при перезапуске начнёт сначала, потенциально повторно шифруя уже зашифрованные документы. Это может привести к двойному шифрованию (данные станут нечитаемыми).
- **Suggested Fix:**
  ```ts
  try {
    localStorage.setItem(CHECKPOINT_KEY, JSON.stringify([...processedIds]));
  } catch (e) {
    reportError(e, { action: 'encryptMigration_checkpoint_save', processedCount: processedIds.size }, 'warning');
    // Продолжаем — чекпоинт не сохранён, но миграция не останавливается
    // При следующем запуске будет переработка — это приемлемый компромисс
  }
  ```

---

### [E-06] `useDocuments.ts:44` — пустой список документов при ошибке загрузки
- **Severity:** Medium
- **Category:** Error Handling
- **Location:** `src/features/writing/hooks/useDocuments.ts:44`
- **Description:** При ошибке загрузки документов `catch { /* ignore */ }` устанавливает `loading=false` в `finally`, но не устанавливает ошибку и не показывает пользователю, что что-то пошло не так. Пользователь видит пустой список и думает, что документов нет, хотя на самом деле они не загрузились.
- **Suggested Fix:**
  ```ts
  const [error, setError] = useState<string | null>(null);
  
  // В fetch-функции:
  try {
    setError(null);
    // ... load documents
  } catch (err) {
    reportError(err, { action: 'fetchDocuments', userId });
    setError(t('error_documents_load_failed'));
  } finally {
    setLoading(false);
  }
  ```
  В компоненте: если `error !== null`, показать сообщение с кнопкой «Повторить».

---

### [E-07] `useEncryptionStore.ts:51` — молчаливое отключение шифрования
- **Severity:** Medium
- **Category:** Security / Error Handling
- **Location:** `src/core/crypto/useEncryptionStore.ts:51`
- **Description:** Если чтение флага `encryptionEnabled` из localStorage падает, `catch {}` возвращает `false`. Это означает, что шифрование будет считаться отключённым, и новые данные будут записаны без шифрования в документы, которые должны быть зашифрованы. Нарушение конфиденциальности.
- **Suggested Fix:**
  ```ts
  try {
    const val = localStorage.getItem(`enc_enabled_${userId}`);
    if (val !== null) {
      const enabled = val === '1';
      encryptionEnabledCache[userId] = enabled;
      return enabled;
    }
  } catch (e) {
    reportError(e, { action: 'isEncryptionEnabled_read', userId }, 'warning');
    // Не возвращаем false — лучше считать включённым, чем потерять шифрование
    // Если кэш есть — использовать его
    if (encryptionEnabledCache[userId] !== undefined) {
      return encryptionEnabledCache[userId];
    }
    // Если кэша нет — conservative default: true для авторизованных пользователей
    return !userId.startsWith('guest_') && userId !== 'guest';
  }
  ```

---

### [E-08] `useLocalStorage.ts` — три молчаливых catch с потерей пользовательских настроек
- **Severity:** Low
- **Category:** Error Handling
- **Location:** `src/shared/hooks/useLocalStorage.ts:20,26,53`
- **Description:** Три catch-блока:
  1. Строка 20: Не удаляется повреждённый ключ → повторный парсинг на каждом рендере
  2. Строка 26: Молча откатывается к defaultValue → настройки «сбрасываются» без объяснения
  3. Строка 53: `quota exceeded` — значение в стейте обновлено, но не сохранено → потеряно при перезагрузке
  
  Все три проблемы приводят к тому, что пользовательские настройки молча теряются.
- **Suggested Fix:**
  ```ts
  // Строка 26: логировать в DEV-режиме
  } catch (e) {
    if (import.meta.env.DEV) console.warn(`[useLocalStorage] Failed to parse key "${key}":`, e);
    return initialValueRef.current;
  }
  
  // Строка 53: уведомлять о quota exceeded
  } catch (e) {
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      reportError(e, { action: 'useLocalStorage_quota', key }, 'warning');
    }
    // Значение в стейте обновлено — это OK для текущей сессии
    // Но при перезагрузке будет потеряно — стоит сообщить пользователю
  }
  ```

---

### [E-09] `AIPanel.tsx:57` — потеря контекста AI-диалога
- **Severity:** Low
- **Category:** Error Handling
- **Location:** `src/features/writing/components/AIPanel.tsx:57`
- **Description:** `AIContextService.append(...).catch(() => {})` — fire-and-forget. Если запись в IDB падает, история AI-диалога теряется. Следующие запросы к AI не будут иметь контекста предыдущих ответов — качество AI-помощи деградирует молча.
- **Suggested Fix:**
  ```ts
  AIContextService.append(savedDocumentId, content.slice(0, 2000), res.text)
    .catch(e => reportError(e, { action: 'aiContext_append' }, 'warning'));
  ```

---

### [E-10] `AuthContext.tsx:86` — накопление мусорных ключей в localStorage
- **Severity:** Low
- **Category:** Error Handling
- **Location:** `src/features/auth/contexts/AuthContext.tsx:86`
- **Description:** При смене пользователя (login/logout) код чистит `local_session_*` ключи из localStorage. Если `localStorage.removeItem` падает — catch игнорирует. Со временем мусорные ключи накапливаются, исчерпая квоту localStorage и вызывая последующие сбои записи.
- **Suggested Fix:**
  ```ts
  } catch (e) {
    reportError(e, { action: 'cleanupOldSessionKeys', uid: newUid }, 'warning');
  }
  ```

---

## Сводка

| Категория | Тикеты | High | Medium | Low |
|-----------|--------|------|--------|-----|
| Тесты     | T-01…T-09 | 2 | 6 | 1 |
| Кросс-стор зависимости | X-01…X-03 | 1 | 1 | 1 |
| Обработка ошибок | E-01…E-10 | 4 | 3 | 3 |
| **Итого** | **22** | **7** | **10** | **5** |

### Приоритет выполнения

**Immediate (защита от потери данных):**
1. [E-01] — потеря ключей шифрования при регистрации
2. [E-03] — потеря гостевого черновика
3. [E-04] — молчаливая потеря операций с тегами
4. [T-01] — тесты countWords
5. [T-02] — тесты encryptMigration

**Short-term:**
6. [X-01] — разрыв циклической зависимости Timer ↔ Content
7. [E-02] — autosave молча проваливается
8. [E-05] — потеря чекпоинта миграции
9. [E-07] — шифрование молча отключается
10. [T-05] — тесты draftUtils

**Medium-term:**
11. [X-02] — параметризация sessionStartWords
12. [E-06] — пустой список документов при ошибке
13. [T-03] — тесты encryptionStore
14. [T-04] — тесты DiffService
15. [T-06] — реальные тесты ExportService

**Backlog:**
16-22. Остальные Low-приоритетные тикеты
