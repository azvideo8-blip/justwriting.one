# JustWriting Audit Tickets

---

## 🔴 P0 — КРИТИЧЕСКИЕ (блокирующие архитектуру и performance)

### П0-01 — toBase64/fromBase64: O(n²) → O(n), chunked approach

**Приоритет:** 🔴 Критический (влияет на все криптографические операции)  
**Оценка:** 1 час  
**Файлы:** `src/core/crypto/encrypt.ts` (функции `toBase64`, `fromBase64`)

#### Проблема

Текущая реализация строит строку через `forEach` с конкатенацией:

```ts
// ПЛОХО — O(n²)
let result = '';
for (let byte of bytes) {
  result += String.fromCharCode(byte);
}
```

Для 150 KB текста это занимает ~200 ms вместо ~5 ms.

#### Решение

Использовать chunked подход с размером чанка 32 KB:

```ts
export function toBase64(bytes: Uint8Array): string {
  let result = '';
  const CHUNK_SIZE = 32768;
  
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CHUNK_SIZE);
    result += String.fromCharCode.apply(null, Array.from(chunk));
  }
  
  return btoa(result);
}

export function fromBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  return bytes;
}
```

#### Критерий готовности

- Все unit-тесты в `src/core/crypto/*.test.ts` проходят
- Профайлинг: 150 KB текст обрабатывается за < 10 ms
- Нет регрессий в шифровании/расшифровании заметок

---

### П0-02 — registerTimerBridge: удалить скрытый канал синхронизации

**Приоритет:** 🔴 Критический (архитектурный долг)  
**Оценка:** 1.5 часа  
**Файлы:** `src/features/writing/store/useContentStore.ts`, `src/features/writing/store/storeActions.ts`

#### Проблема

Неявный bidirectional канал через модульные переменные:

```ts
// В useContentStore.ts
let _getTimerState: any;
let _setTimerPartial: any;

export function registerTimerBridge(get: any, set: any) {
  _getTimerState = get;
  _setTimerPartial = set;
}

// Потом используется как:
if (_getTimerState) {
  const timerState = _getTimerState((s: any) => s);
}
```

Это:
- Скрывает зависимость между стором контента и таймера
- Делает код нетестируемым
- Вызывает путаницу при рефакторинге

#### Решение

Использовать стандартный Zustand `subscribe` вместо скрытого канала:

**В `useContentStore.ts`:**
```ts
// Убрать registerTimerBridge и всю логику с _getTimerState/_setTimerPartial

// Вместо этого, при вызове setContent:
const handleSetContent = (content: string) => {
  set({ content });
  
  // Если нужно обновить таймер, делаем это явно через его стор
  useTimerStore.getState().updateContentLength(content.length);
};
```

**В `storeActions.ts`:**
```ts
// Убрать registerTimerBridge() вызов
// Все вычисления должны происходить либо в каждом сторе отдельно,
// либо через явные функции-handlers
```

#### Критерий готовности

- `registerTimerBridge` полностью удалён
- Нет модульных переменных для синхронизации между сторами
- Все интеграционные тесты проходят
- Word count, время сессии обновляются корректно

---

## 🟠 P1 — ВЫСОКИЙ ПРИОРИТЕТ (logic flaws и частые re-renders)

### П1-01 — Consolidate resetAndClear, resetSession, finishSession

**Приоритет:** 🟠 Высокий (путанница логики)  
**Оценка:** 30 минут  
**Файлы:** `src/features/writing/store/storeActions.ts`

#### Проблема

Три идентичные функции, которые делают одно и то же:

```ts
export function resetAndClear(store: WritingStore) {
  store.resetToDefaults();
}

export function resetSession(store: WritingStore) {
  store.resetToDefaults();
}

export function finishSession(store: WritingStore) {
  store.resetToDefaults();
}
```

Неясно, когда какую вызывать. Это создаёт баги.

#### Решение

Оставить одну функцию с параметром:

```ts
export function resetSession(
  store: WritingStore, 
  options: { clear?: boolean } = {}
) {
  store.resetToDefaults();
  if (options.clear) {
    // особая логика очистки если нужна
  }
}

// Убрать resetAndClear и finishSession
// Обновить все callsites на resetSession()
```

Или, если логика действительно отличается:
- Документировать в комментариях для каждой функции **когда её использовать**
- Переименовать в понятные имена

#### Критерий готовности

- Только одна функция reset (или максимум 2 с явной разницей в docstring)
- Все вызовы обновлены
- Тесты проходят

---

### П1-02 — setContent двойной ре-рендер: убрать _wordCalcTimer дебаунс

**Приоритет:** 🟠 Высокий (performance)  
**Оценка:** 45 минут  
**Файлы:** `src/features/writing/store/useContentStore.ts`

#### Проблема

```ts
const setContent = (content: string) => {
  set({ content }); // ← немедленный рендер
  
  clearTimeout(store.state._wordCalcTimer);
  store.state._wordCalcTimer = setTimeout(() => {
    set({ wordCount, charCount, ... }); // ← второй рендер через 100ms
  }, 100);
};
```

Результат: контент обновляется мгновенно, но stats пересчитываются асинхронно → два рендера.

#### Решение

Вычислять stats синхронно или использовать single setState call:

```ts
const setContent = (content: string) => {
  const { wordCount, charCount } = computeWordStats(content);
  
  set({
    content,
    wordCount,
    charCount,
    // ... остальные stats
  }); // ← единый setState, один рендер
};

// Убрать _wordCalcTimer вообще
```

Если вычисление stats действительно дорогое, использовать Web Worker вместо setTimeout.

#### Критерий готовности

- Один setState call при изменении контента
- Нет асинхронных обновлений stats через дебаунс
- Профайл показывает единичный render вместо двойного

---

### П1-03 — loadDraft: параллелизовать I/O (IDB + localStorage + Firestore)

**Приоритет:** 🟠 Высокий (performance на загрузке)  
**Оценка:** 1 час  
**Файлы:** `src/features/writing/services/WritingDraftService.ts`

#### Проблема

```ts
async loadDraft(userId: string, docId: string) {
  // 1. Сначала IDB
  const draft = await idb.get(...);
  
  // 2. Потом localStorage
  const local = await localStorage.get(...);
  
  // 3. Потом Firestore
  const remote = await firestore.get(...);
  
  // Если первый есть — используем, иначе переходим к следующему
}
```

Все операции **последовательные**, хотя можно делать параллельно.

#### Решение

```ts
async loadDraft(userId: string, docId: string) {
  const results = await Promise.allSettled([
    idb.get(docId),
    this.getLocalStorage(docId),
    StorageService.loadDraft(userId, docId),
  ]);

  // Приоритет: IDB > localStorage > Firestore
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      return result.value;
    }
  }
  
  return null;
}
```

#### Критерий готовности

- Все 3 I/O операции идут параллельно
- Время загрузки снизилось на ~60% (с 300 ms до ~100 ms)
- Логика fallback работает корректно

---

## 🟡 P2 — СРЕДНИЙ ПРИОРИТЕТ (bugs, code health)

### П2-01 — saveVersion: fix lock cleanup на исключение

**Приоритет:** 🟡 Средний (deadlock risk)  
**Оценка:** 45 минут  
**Файлы:** `src/features/writing/services/StorageService.ts` (метод `saveVersion`)

#### Проблема

```ts
async saveVersion(userId: string, ...) {
  this.saveLocks[key] = new Promise(async (resolve) => {
    try {
      // долгая операция
      await firestore.update(...);
    } finally {
      delete this.saveLocks[key]; // ← проблема здесь
      resolve();
    }
  });
  
  return this.saveLocks[key];
}
```

Если во время операции бросится исключение и **новый Promise будет присвоен** `this.saveLocks[key]`, старый Promise в `finally` удалит key, но **новый Promise остаётся в очереди** → deadlock.

Правильно: очищать lock только когда Promise **окончательно разрешён**.

#### Решение

```ts
async saveVersion(userId: string, ...) {
  const key = `${userId}:${docId}`;
  
  // Если уже есть save в процессе — подождать и вернуть
  if (this.saveLocks[key]) {
    return this.saveLocks[key];
  }
  
  let resolve: () => void = () => {};
  this.saveLocks[key] = new Promise(r => { resolve = r; });

  try {
    // выполнить операцию
    await firestore.update(...);
  } catch (e) {
    reportError(e, { action: 'saveVersion', userId });
    throw e; // пробросить ошибку
  } finally {
    delete this.saveLocks[key];
    resolve();
  }
}
```

Или, более чистый вариант с `using`:

```ts
async saveVersion(userId: string, ...) {
  const lockKey = `${userId}:${docId}`;
  const lock = this.acquireLock(lockKey);
  
  try {
    await firestore.update(...);
  } finally {
    this.releaseLock(lockKey); // атомная операция
  }
}
```

#### Критерий готовности

- Нет deadlock при исключениях в saveVersion
- Lock корректно очищается в любом сценарии
- Unit-тест проверяет очистку lock на ошибку

---

### П2-02 — checkGoals: сделать idempotent (вызывать set только если значения изменились)

**Приоритет:** 🟡 Средний (unnecessary re-renders)  
**Оценка:** 30 минут  
**Файлы:** `src/features/writing/store/useTimerStore.ts`

#### Проблема

```ts
checkGoals() {
  setInterval(() => {
    this.set({
      goalsProgress: computeProgress(),
      ...
    });
  }, 500);
  // Вызывает set() КАЖДЫЕ 500 ms, даже если значения не изменились
  // → trigger всех Zustand subscribers
}
```

#### Решение

```ts
checkGoals = () => {
  const interval = setInterval(() => {
    const current = this.get();
    const progress = computeProgress();
    
    // Обновить только если значения изменились
    if (current.goalsProgress !== progress) {
      this.set({ goalsProgress: progress });
    }
  }, 500);
  
  return () => clearInterval(interval);
};
```

#### Критерий готовности

- checkGoals вызывает set() только если данные изменились
- Re-render count снизился на ~80% во время работы таймера
- Тест проверяет, что никакие subscribers не срабатывают при неизменённых значениях

---

### П2-03 — tsconfig.json: включить strict mode

**Приоритет:** 🟡 Средний (code health, type safety)  
**Оценка:** 2–3 часа (может потребоваться fix типов)  
**Файлы:** `tsconfig.json`

#### Проблема

```json
{
  "compilerOptions": {
    "strict": false,  // ← отключен
    "skipLibCheck": true  // ← скрывает type errors в зависимостях
  }
}
```

Это маскирует потенциальные type errors.

#### Решение

```json
{
  "compilerOptions": {
    "strict": true,
    "skipLibCheck": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true
  }
}
```

Потом запустить TypeScript compiler и fix все ошибки.

#### Критерий готовности

- `tsconfig.json` имеет `strict: true`
- `tsc --noEmit` проходит без ошибок
- CI не ломается

---

### П2-04 — useWpm.ts: cleanup не сбрасывает WPM на ноль

**Приоритет:** 🟡 Средний (UX bug)  
**Оценка:** 15 минут  
**Файлы:** `src/features/writing/hooks/useWpm.ts`

#### Проблема

```ts
useEffect(() => {
  if (status !== 'writing') return;
  
  const interval = setInterval(() => {
    setWpm(calculateWpm());
  }, 1000);
  
  return () => clearInterval(interval);
  // ← но WPM не сбрасывается на 0!
}, [status]);
```

После паузы (status → 'paused'), WPM остаётся на последнем значении. Должен быть 0.

#### Решение

```ts
useEffect(() => {
  if (status !== 'writing') {
    setWpm(0); // сбросить когда не пишем
    return;
  }
  
  const interval = setInterval(() => {
    setWpm(calculateWpm());
  }, 1000);
  
  return () => {
    clearInterval(interval);
    setWpm(0); // сбросить при unmount
  };
}, [status]);
```

#### Критерий готовности

- WPM = 0 когда status !== 'writing'
- После паузы WPM становится 0
- Test проверяет переходы status → WPM

---

## 🔵 P3 — НИЗКИЙ ПРИОРИТЕТ (refactoring, long-term improvements)

### П3-01 — AnimatedRoutes: split на AppShell + AppRoutes + useLayoutKeyboardShortcut

**Приоритет:** 🔵 Низкий (архитектура)  
**Оценка:** 2 часа  
**Файлы:** `src/app/AnimatedRoutes.tsx`

#### Проблема

Компонент делает слишком много:
- Управляет routing
- Управляет layout mode
- Обрабатывает keyboard shortcuts
- Контролирует sidebar visibility

```tsx
export function AnimatedRoutes() {
  const layoutModeRef = useRef(null);
  
  useEffect(() => {
    const handleKeydown = (e) => {
      // keyboard shortcuts
    };
  }, []);
  
  return (
    <div className={layoutMode}>
      <Sidebar />
      <Routes>
        ...
      </Routes>
    </div>
  );
}
```

#### Решение

Разбить на три компонента:

```tsx
// 1. AppShell — управляет layout и sidebar
export function AppShell() {
  const [layoutMode, setLayoutMode] = useState('editing');
  
  return (
    <div className={layoutMode}>
      <Sidebar />
      <AppRoutes />
    </div>
  );
}

// 2. AppRoutes — только routing
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/editor" element={<EditorPage />} />
      ...
    </Routes>
  );
}

// 3. Custom hook для keyboard shortcuts
export function useLayoutKeyboardShortcut() {
  useEffect(() => {
    const handleKeydown = (e) => {
      // ...
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, []);
}

// Использование:
export function AnimatedRoutes() {
  useLayoutKeyboardShortcut();
  return <AppShell />;
}
```

#### Критерий готовности

- Каждый компонент отвечает за одно
- Keyboard shortcuts работают в hook
- layoutModeRef больше не нужна (используется state)

---

### П3-02 — useSessionFlow: убрать useMemo на объект

**Приоритет:** 🔵 Низкий (unnecessary optimization)  
**Оценка:** 15 минут  
**Файлы:** `src/features/writing/hooks/useSessionFlow.ts`

#### Проблема

```ts
const memoizedValue = useMemo(() => ({
  started: sessionStartTime !== null,
  paused: sessionStatus === 'paused',
}), [sessionStartTime, sessionStatus]);
```

useMemo на объект — это cargo cult. Рендер-то будет всё равно, а объект создаётся за микросекунды.

#### Решение

```ts
// Просто вернуть объект, React позаботится о сравнении
return {
  started: sessionStartTime !== null,
  paused: sessionStatus === 'paused',
};
```

Если компонент действительно перерендерится 10K раз, то проблема в коде выше, не в объекте.

#### Критерий готовности

- useMemo удалён
- Функция работает так же
- No performance regression

---

### П3-03 — Unify error handling strategy

**Приоритет:** 🔵 Низкий (code consistency)  
**Оценка:** 2 часа  
**Файлы:** Все сервис-слои и компоненты

#### Проблема

Нет единого подхода к обработке ошибок:

```ts
// Где-то:
try {
  ...
} catch (e) {
  console.error(e);
}

// Где-то:
try {
  ...
} catch (e) {
  showToast(t('error_generic'));
}

// Где-то:
try {
  ...
} catch (e) {
  reportError(e);
  throw e;
}

// Где-то:
try {
  ...
} catch (e) {
  // silent fail
}
```

Это создаёт баги:
- Пользователь не видит ошибку
- DevTools не видят ошибку
- Можно пропустить important error

#### Решение

Принять соглашение:

1. **В сервисах** (StorageService, WritingDraftService):
   ```ts
   try {
     ...
   } catch (e) {
     reportError(e, { action: 'saveDraft', docId });
     throw e; // пробросить, чтобы компонент мог обработать
   }
   ```

2. **В компонентах** (обработка пользовательского действия):
   ```ts
   try {
     await service.doSomething();
   } catch (e) {
     showToast(t('error_generic_action'), 'error');
     // reportError уже был вызван в сервисе
   }
   ```

3. **Silent fails только если явно задокументировано**:
   ```ts
   try {
     // опциональное улучшение, не critical
     await analytics.track(...);
   } catch {
     // ignore — analytics не должна ломать app
   }
   ```

#### Критерий готовности

- Все сервисы используют reportError + throw
- Все компоненты ловят ошибки и показывают пользователю
- Documentation в CONTRIBUTING.md объясняет strategy

---

## 📊 Резюме

| P | Количество | Примерное время | Блокирующие |
|---|-----------|-----------------|------------|
| 🔴 P0 | 2 | 2.5 часа | toBase64 O(n²), registerTimerBridge |
| 🟠 P1 | 3 | 2.5 часа | double render, loadDraft parallelization |
| 🟡 P2 | 4 | 3.5 часа | lock cleanup, strict mode, checkGoals idempotency |
| 🔵 P3 | 3 | 4.5 часа | refactoring (nice to have) |
| **Всего** | **12** | **~12 часов** | |

**Рекомендуемый порядок:**
1. P0-01 (toBase64) — базовая performance, влияет на все
2. P0-02 (registerTimerBridge) — архитектурный долг, блокирует P1-01
3. P1-02 (double render) — быстро и заметно улучшает UX
4. P1-03 (loadDraft parallelization) — заметное улучшение загрузки
5. P1-01 (consolidate reset) — рефакторинг
6. P2-* в любом порядке
7. P3-* в свободное время
