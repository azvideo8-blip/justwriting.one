# AG-N1…N4 — сеть отвалилась, а приложение винит себя

**Приоритет:** N1–N3 — P1, N4 — P2 · Объём: небольшой
**Ветка от:** `main` (сейчас `e54664d5`, версия 0.7.68).

## Откуда это взялось

Разбор журнала за 2026-08-02. Первый вывод: **самих ошибок в приложении нет.** Всё, что
в консоли, — это `ERR_PROXY_CONNECTION_FAILED`, `ERR_NETWORK_CHANGED`,
`ERR_CONNECTION_CLOSED`, `ERR_NETWORK_IO_SUSPENDED`. Прокси или VPN отваливался, сеть
переключалась, устройство засыпало. Ни одна из этих строк не про наш код.

Проблема в другом: **приложение превращает отвалившуюся сеть в четыре разных неправды.**
Журнал заполняется красным, которое ничего не сообщает и прячет настоящие ошибки, а
пользователю показывают сообщения, не имеющие отношения к происходящему.

Четыре задачи, каждая — отдельным коммитом, со своим тестом.

**Общие границы:**

- не менять код облачных функций (`functions/`) — все четыре правки клиентские;
- не менять версию приложения и оба changelog'а;
- не поднимать версию IndexedDB;
- не откатывать свои правки через `git checkout <файл>` — правь обратно руками;
- проверки заканчивать `npm run lint` целиком, а не по файлам;
- **тест обязан падать на старом коде.** Написал тест — верни правку, убедись, что
  красный, верни назад;
- **не создавай в тесте копию проверяемой функции** — такая копия уже держала 22 зелёных
  теста при сломанном продакшене;
- не пушить.

---

# N1 — защита от лавины запросов не работает, потому что две стороны говорят на разных языках (P1)

## Что сломано

В журнале в 16:12:34 подряд четыре одинаковых `judgeFacets: internal`. Это не совпадение
и не повтор одной записи: сервис был недоступен, а цикл продолжал перебирать порции.

`src/features/ai/services/AIFacetJudgeService.ts`, строки 114–124:

```ts
    // Sequential, and it stops on the first service-level failure. Firing every
    // chunk at once meant one dead endpoint produced one failure per chunk —
    // fifteen in a row in the log — ...
    for (const c of chunks) {
      const r = await AIService.judgeFacets({ facets: c });
      results.push(r);
      if (!r.ok && (r.error === 'SERVER_ERROR' || r.error === 'RATE_LIMIT' || r.error === 'DAILY_LIMIT')) break;
    }
```

Комментарий описывает защиту, которой нет. `AIService.judgeFacets` возвращает **сырой код
Firebase**, а не нормализованный:

```ts
      reportError(e, { action: 'judgeFacets' }, 'warning');
      return { ok: false, error: String((e as { code?: string })?.code ?? 'error') };
```

То есть `'internal'`, `'deadline-exceeded'`, `'unavailable'` — или `'error'`, если это был
наш собственный таймаут (см. N4). Ни одна из этих строк не равна `'SERVER_ERROR'`,
`'RATE_LIMIT'` или `'DAILY_LIMIT'`. **Условие `break` не выполняется никогда.**

В том же файле `AIService.ts` уже есть нормализатор `mapAIError` — им пользуются
одиннадцать методов из тринадцати. Мимо него идут ровно два: `deriveTaxonomy` (строка
209) и `judgeFacets` (строка 223).

## Что делать

`src/features/ai/services/AIService.ts`.

**Было** (метод `deriveTaxonomy`, строка ~209):

```ts
      reportError(e, { action: 'deriveTaxonomy' }, 'warning');
      return { ok: false, error: String((e as { code?: string })?.code ?? 'error') };
```

**Стало:**

```ts
      reportError(e, { action: 'deriveTaxonomy' }, 'warning');
      // Сырой код Firebase здесь бесполезен: вызывающая сторона сравнивает его с
      // нормализованными кодами, и сравнение не совпадало никогда.
      return { ok: false, error: mapAIError(e) };
```

**Было** (метод `judgeFacets`, строка ~223):

```ts
      reportError(e, { action: 'judgeFacets' }, 'warning');
      return { ok: false, error: String((e as { code?: string })?.code ?? 'error') };
```

**Стало:**

```ts
      reportError(e, { action: 'judgeFacets' }, 'warning');
      // Из-за сырого кода Firebase остановка перебора в AIFacetJudgeService не
      // срабатывала ни разу: недоступный сервис давал по ошибке на каждую порцию.
      return { ok: false, error: mapAIError(e) };
```

Заодно поправь объявленные типы возврата обоих методов: сейчас там `error: string`,
должно быть то же объединение, что возвращает `mapAIError`. Если `tsc` после этого
укажет на несовпадения у вызывающих — это и есть места, которые сравнивали строки
вслепую; поправь сравнения, но **логику не меняй**.

## Тест

Новый файл `src/features/ai/services/__tests__/facetJudgeStops.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIService } from '../AIService';

// В журнале 2026-08-02 в 16:12:34 подряд четыре одинаковых judgeFacets: internal.
// Перебор порций должен останавливаться на первом отказе сервиса — доступен он
// или нет, это свойство сервиса, а не порции. Останов сравнивал ответ с
// нормализованными кодами, а метод возвращал сырой код Firebase, поэтому
// сравнение не совпадало никогда.
describe('judgeFacets reports a normalised error code', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('maps a transport failure to a code the caller actually checks', async () => {
    const res = await AIService.judgeFacets({ facets: [] });
    // Подставь мок httpsCallable так, как это уже делают соседние тесты
    // AIService — способ повтори у них, не изобретай свой.
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(['SERVER_ERROR', 'RATE_LIMIT', 'DAILY_LIMIT', 'AUTH_REQUIRED', 'UPSTREAM', 'TOO_LONG', 'NETWORK'])
        .toContain(res.error);
      // Именно это и было сломано: сырой код Firebase сюда не попадает.
      expect(res.error).not.toBe('internal');
    }
  });
});
```

**Отдельный файл, скорее всего, не нужен.** Рядом уже лежат
`src/features/ai/services/__tests__/AIService.test.ts` и `AIFacetJudgeService.test.ts` —
там мок `httpsCallable` уже поднят. Добавь случай в них и повтори их способ, а свой мок
не изобретай. Новый файл заводи только если в обоих мока нет.

**Проверка на невакуумность:** верни `String((e as { code?: string })?.code ?? 'error')` —
тест обязан упасть на `not.toBe('internal')`.

---

# N2 — обрыв сети записывается как ошибка приложения (P1)

## Что сломано

`mapAIError` в `src/features/ai/services/AIService.ts` знает про отказ авторизации,
лимиты, слишком длинный запрос и падение провайдера. Про **отсутствие связи он не знает
ничего**, поэтому любой обрыв транспорта попадает в `SERVER_ERROR` — «ошибка сервиса», —
а `reportError` записывает его уровнем `error`.

В журнале за день из-за этого: `ERROR chat: deadline-exceeded`, `ERROR chat: internal`,
`WARNING judgeFacets: internal` — и всё это при живом сервисе и мёртвом прокси.

**`internal` здесь доказуемо транспортный, а не наш.** Я проверил обе функции:

- `chatWithAI` бросает `internal` только через `classifyProviderFailure`, и тот всегда
  кладёт в сообщение слово-причину: `UNKNOWN`, `BAD_REQUEST` или `MISCONFIGURED`;
- `judgeFacets` не бросает `internal` **ни на одном пути**: там либо конкретный
  `HttpsError`, либо мягкий успех с пустыми вердиктами.

Значит `internal` с сообщением, равным строке `internal`, — это SDK, который не смог
достучаться до функции. Это надёжный признак, а не догадка.

`navigator.onLine` тут не спасает и добавлять его не надо: при живом интерфейсе и мёртвом
прокси он возвращает `true`. Проверка на него уже стоит в `useAIChat.ts:197` и в этот
день не сработала ни разу.

## Что делать

### N2.1 — научить `mapAIError` различать обрыв связи

`src/features/ai/services/AIService.ts`.

**Было:**

```ts
function mapAIError(e: unknown): 'AUTH_REQUIRED' | 'DAILY_LIMIT' | 'RATE_LIMIT' | 'TOO_LONG' | 'UPSTREAM' | 'SERVER_ERROR' {
  const code = (e as { code?: string }).code;
  const message = (e as { message?: string }).message ?? '';
  if (code === 'functions/unauthenticated') return 'AUTH_REQUIRED';
```

**Стало:**

```ts
export type AIErrorCode =
  | 'AUTH_REQUIRED' | 'DAILY_LIMIT' | 'RATE_LIMIT' | 'TOO_LONG'
  | 'UPSTREAM' | 'SERVER_ERROR' | 'NETWORK';

function mapAIError(e: unknown): AIErrorCode {
  const code = (e as { code?: string }).code;
  const message = (e as { message?: string }).message ?? '';
  // Связь оборвалась, а не сервис сломался. Раньше всё это попадало в
  // SERVER_ERROR и писалось в журнал уровнем error, так что день с отвалившимся
  // прокси выглядел как день с поломанным приложением.
  //
  // 'internal' с сообщением ровно 'internal' — это SDK, не наша функция:
  // chatWithAI бросает internal только с причиной (UNKNOWN / BAD_REQUEST /
  // MISCONFIGURED), а judgeFacets не бросает его ни на одном пути.
  if (code === 'functions/deadline-exceeded') return 'NETWORK';
  if (code === 'functions/internal' && message.trim().toLowerCase() === 'internal') return 'NETWORK';
  if (message === 'Timeout' || (e as { isTimeout?: boolean }).isTimeout) return 'NETWORK';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'NETWORK';
  if (code === 'functions/unauthenticated') return 'AUTH_REQUIRED';
```

Остальное тело `mapAIError` не трогай. Обнови объявления возвращаемых типов, где
перечислено старое объединение (строка ~15 и другие места, на которые укажет `tsc`) —
заменяй на `AIErrorCode`, дублировать список не надо.

### N2.2 — не писать обрыв связи уровнем ошибки

Метод `chat` в том же файле.

**Было:**

```ts
    } catch (e: unknown) {
      reportError(e, { action: 'chat', personaId: params.personaId });
      return { ok: false, error: mapAIError(e) };
    }
```

**Стало:**

```ts
    } catch (e: unknown) {
      const code = mapAIError(e);
      // Обрыв связи — не ошибка приложения. Уровнем error он забивал журнал и
      // прятал настоящие поломки среди записей о мёртвом прокси.
      reportError(e, { action: 'chat', personaId: params.personaId, aiError: code },
        code === 'NETWORK' ? 'warning' : 'error');
      return { ok: false, error: code };
    }
```

Проделай то же самое **во всех методах `AIService`, где `reportError` вызывается
уровнем `error`** (то есть без третьего аргумента). Там, где уже стоит `'warning'`,
достаточно добавить `aiError: code` в контекст.

### N2.3 — показать пользователю то, что произошло

Ключ `ai_error_offline` уже есть в `src/shared/i18n/translations/writing.ts`:
`'Данная функция работает только при подключении к сети'`. Он подходит.

В каждом месте, где строится соответствие кода и текста, добавь `NETWORK`. Их два:
`src/features/archive/components/ArchiveNoteList.tsx` (~строка 105) и
`src/features/writing/components/AIPanel.tsx` (~строка 73):

```ts
          NETWORK: t('ai_error_offline'),
```

Заодно там же отсутствует `UPSTREAM` — он молча проваливается в `ai_error_server`.
Добавь и его, если в переводах есть подходящий ключ; если нет — **не заводи новый**,
выпиши в отчёт.

### N2.4 — фоновая работа должна отступать при обрыве связи

`src/features/ai/hooks/useEmbeddingIndexer.ts`, карта `BACKOFF_MS` (~строка 21). Добавь:

```ts
  // Связи нет — пауза, как и при недоступном сервисе. Без этого фоновый проход
  // продолжал долбить мёртвую сеть каждые два минуты и писать по ошибке за проход.
  NETWORK: 300_000,
```

И в условиях, которые проверяют `res.error === 'DAILY_LIMIT' || … === 'SERVER_ERROR'`
(строки ~231 и ~322), добавь `'NETWORK'` в тот же список. **Проверь оба места**, не
только первое.

## Тест

Добавь в существующий `src/features/ai/services/__tests__/AIService.test.ts` — мок
`httpsCallable` там уже есть. Проверяй `mapAIError` через публичный метод (функция не
экспортируется — **не экспортируй её ради теста**, вызывай через метод с моком).

Случаи, каждый — отдельное утверждение:

- `{ code: 'functions/deadline-exceeded' }` → `NETWORK`;
- `{ code: 'functions/internal', message: 'internal' }` → `NETWORK`;
- `{ code: 'functions/internal', message: 'UNKNOWN' }` → **`SERVER_ERROR`**, не `NETWORK`
  — это настоящая ошибка нашей функции, и понизить её до сетевой нельзя;
- `{ code: 'functions/unauthenticated' }` → `AUTH_REQUIRED` (не сломалось);
- `{ code: 'functions/unavailable' }` → `UPSTREAM` (не сломалось).

Третий случай — самый важный: он охраняет границу, за которой мы начали бы прятать
собственные поломки под видом проблем со связью.

**Проверка на невакуумность:** убери строку про `deadline-exceeded` — первый тест обязан
упасть.

---

# N3 — «Нужна регистрация» человеку, который вошёл в аккаунт (P1)

## Что сломано

В журнале: `ERROR chat: Registration required.` в 19:23:13, и рядом с ним в консоли —
`securetoken.googleapis.com … ERR_CONNECTION_CLOSED` и `chatWithAI … 401`.

Цепочка целиком: обновление токена не прошло из-за сети → вызов ушёл без действующего
токена → `functions/src/ai/chatWithAI.ts:34` отказал с `unauthenticated` и текстом
`Registration required.` → клиент показал `ai_error_auth`, то есть **«Нужна
регистрация»**.

Пользователь зарегистрирован и вошёл. Ему сообщают, что нужно зарегистрироваться. Это то
же самое семейство, что и вся дорожка A: неудачная проверка выдаётся за вывод о
состоянии данных.

## Что делать

Отличить «не вошёл» от «не удалось подтвердить сессию прямо сейчас», и один раз
попробовать обновить токен принудительно.

В `src/features/ai/services/AIService.ts` заведи вспомогательную функцию рядом с
`mapAIError`:

```ts
/** Один повтор после принудительного обновления токена. Отказ авторизации при
 *  живом пользователе почти всегда значит, что обновление токена не прошло по
 *  сети, а не что человек не зарегистрирован: securetoken отвалился, вызов ушёл
 *  без действующего токена, функция отказала. */
async function retryAfterTokenRefresh<T>(call: () => Promise<T>): Promise<T> {
  const user = getAuth().currentUser;
  if (!user) throw new Error('NOT_SIGNED_IN');
  await user.getIdToken(true);
  return call();
}
```

`getAuth` в этом файле, скорее всего, ещё не импортирован — добавь из `'firebase/auth'`.

В методе `chat` оберни повтор вокруг вызова:

```ts
    } catch (e: unknown) {
      const code = mapAIError(e);
      if (code === 'AUTH_REQUIRED' && getAuth().currentUser) {
        try {
          const { data } = await retryAfterTokenRefresh(() => withTimeout(fn(params), GEN_TIMEOUT_MS));
          return { ok: true, text: data.result };
        } catch { /* второй отказ — сообщаем честно ниже */ }
      }
      ...
```

Повтор ровно один. Второй отказ не повторяем: если обновление токена не проходит, оно не
пройдёт и на третий раз, а лишний вызов — это ещё один запрос и ещё одна запись в учёт.

Для текста заведи разделение. Новый ключ в `src/shared/i18n/translations/writing.ts`,
рядом с `ai_error_auth`, с тем же выравниванием:

```ts
  ai_error_session: { ru: 'Не удалось подтвердить сессию — похоже, пропала связь. Попробуй ещё раз.', en: 'Could not confirm your session — the connection seems to be down. Try again.' },
```

И в обоих местах с соответствием кодов (`ArchiveNoteList.tsx`, `AIPanel.tsx`): если
пользователь в аккаунте, при `AUTH_REQUIRED` показывать `ai_error_session`, а
`ai_error_auth` («Нужна регистрация») оставить только для случая, когда
`getAuth().currentUser` пуст.

## Тест

Новый файл `src/features/ai/services/__tests__/authRetry.test.ts`:

- вызов отказал с `functions/unauthenticated`, пользователь есть → `getIdToken(true)`
  вызван ровно один раз, вызов повторён, при успехе возвращён `ok: true`;
- второй отказ подряд → `ok: false`, и `getIdToken` **не** вызван второй раз;
- пользователя нет → повтора нет вообще, сразу `AUTH_REQUIRED`.

**Проверка на невакуумность:** убери блок повтора — первый тест обязан упасть.

---

# N4 — наш собственный таймаут приходит без кода (P2)

## Что сломано

`src/shared/utils/withTimeout.ts` бросает `new Error(message)` — по умолчанию с текстом
`'Timeout'` и **без поля `code`**. Поэтому:

- в сыром пути (`judgeFacets` до N1) он превращался в строку `'error'`;
- в журнале он выглядит как `WARNING judgeFacets: Timeout` — ровно такая запись есть в
  16:11:03;
- в `mapAIError` он не отличим от чего угодно другого и попадает в `SERVER_ERROR`.

Клиентский таймаут — это не ошибка сервера. Мы просто не дождались.

## Что делать

**Было:**

```ts
export function withTimeout<T>(promise: Promise<T>, ms: number, message = 'Timeout'): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
  ]).finally(() => clearTimeout(timer));
}
```

**Стало:**

```ts
/** Ошибка клиентского таймаута. Отдельный тип, потому что «мы не дождались» — не
 *  то же самое, что «сервер сломался», а по голому Error(message) их не различить. */
export class TimeoutError extends Error {
  readonly isTimeout = true;
  constructor(message = 'Timeout') {
    super(message);
    this.name = 'TimeoutError';
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, message = 'Timeout'): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new TimeoutError(message)), ms); }),
  ]).finally(() => clearTimeout(timer));
}
```

Проверку `isTimeout` в `mapAIError` из N2.1 это и обслуживает — сделай N2 раньше, тогда
здесь ничего дописывать не придётся.

**Ничего больше не меняй.** `withTimeout` используется во многих местах; поведение
(отклонение с сообщением) сохраняется, добавляется только различимость.

## Тест

Дополни существующий тест `withTimeout`, если он есть (`grep -rn "withTimeout"
src/**/__tests__`), иначе заведи `src/shared/utils/__tests__/withTimeout.test.ts`:

- при срабатывании таймаута отклонение — `instanceof TimeoutError` и `isTimeout === true`;
- сообщение по умолчанию по-прежнему `'Timeout'`, переданное сообщение по-прежнему
  доходит;
- при успевшем промисе таймер не оставляет висящего отклонения (случай уже описан в
  комментарии функции — проверь, что он не сломался).

**Проверка на невакуумность:** верни `new Error(message)` — первый тест обязан упасть.

---

# Как закончить

По коммиту на задачу:

- `fix(ai): normalise the error code the facet judge actually checks (N1)`
- `fix(ai): a dropped connection is not an application error (N2)`
- `fix(ai): a failed token refresh is not a missing registration (N3)`
- `fix(shared): make a client-side timeout tell itself apart (N4)`

После всех четырёх, из корня:

```
npx tsc --noEmit
npm run lint
npm run test:ci
npm run build
```

Все обязаны пройти. `npm run lint` — целиком, не по файлам.

Не пушить. В отчёте по каждой задаче: что изменено, какой тест добавлен, **что показала
проверка на невакуумность** (какой тест упал и на каком утверждении). Если команду не
запускал — так и напиши, не подставляй ожидаемый результат вместо фактического.
Отдельным списком — всё, что решил не делать: в частности, нашёлся ли подходящий ключ
перевода для `UPSTREAM` и какие вызывающие стороны пришлось поправить после смены типов
в N1.
