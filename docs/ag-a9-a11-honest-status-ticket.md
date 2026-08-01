# AG-A9…A11 — три правки честного статуса

**Приоритет:** P1 · пункты A9–A11 бэклога (`docs/backlog-pre-migration.md`) · Объём: небольшой
**Ветка от:** `main` (сейчас `9e801edf`).

Три независимые задачи в одном файле. Делай **по порядку**, каждую — отдельным
коммитом, со своим тестом. Если какая-то не пойдёт — останови её и переходи к
следующей, не переделывай уже сделанные.

Общая тема у всех трёх одна: **код сообщает об успехе там, где успеха не было.**
Не «косметика статусов» — в A9 и A10 за неправдивым статусом стоит потерянная работа,
которую никто больше не подберёт.

Ниже точный код «Было»/«Стало». Отклоняться не нужно: соседние места правились на этой
неделе, и вольная правка даст конфликт.

**Общие границы для всех трёх:**

- не трогать `addCloudCopy`, `addLocalCopy`, `relinkOrphaned`, `restoreMissingDocuments`,
  обрезку версий и сам модуль `writeBudget.ts` — там свежие изменения;
- не менять версию приложения и `CHANGELOG.md`;
- не поднимать версию IndexedDB (`localDb.ts`, `upgrade`) — ни одна из задач этого не
  требует;
- не откатывать свои же правки через `git checkout <файл>` — так уже был потерян готовый фикс;
  правь файл обратно руками;
- заканчивать проверки командой `npm run lint`, а не `npx eslint <файлы>`: репозиторный
  скрипт идёт с `--max-warnings 0`, и именно на этой разнице недавно уехал красный `main`;
- **тест обязан падать на старом коде.** Написал тест — верни правку в исходное состояние,
  убедись, что тест красный, верни правку назад. Тест, который зелёный в обе стороны,
  не считается сделанной работой;
- **не создавай в тесте копию проверяемой функции.** В `migration.test.ts` такая копия
  уже жила, разошлась с боевым кодом и держала 22 зелёных теста при сломанном продакшене.
  Тест импортирует настоящую функцию, иначе он бесполезен.

---

# A9 — перенос гостевых заметок закрывается при неудачной выгрузке

## Что сломано

`src/features/auth/components/MigrationPrompt.tsx`, `handleMigrate`:

```ts
const { synced, failed } = await SyncService.syncAllUnlinked(userId);
if (synced > 0) onCloudSynced?.(synced);
if (failed > 0 && import.meta.env.DEV) {
  console.warn(`Migration: ${synced} synced, ${failed} failed`);
}
```

`import.meta.env.DEV` — в продакшене эта ветка не выполняется вообще. Пользователь
видит только зелёный тост «Синхронизировано с облаком: N», где N — число **удавшихся**,
и закрывает окно в уверенности, что перенос завершён.

Хуже, чем неправдивый статус. Я проверил всех, кто вызывает `syncAllUnlinked`: это
`MigrationPrompt` и ручная кнопка в диагностике. Автоматического повтора нет нигде.
Заметка, чья выгрузка упала, остаётся `linkedCloudId: ''` — то есть только локальной —
и так и лежит, пока пользователь случайно не откроет диагностику. При переустановке
браузера или чистке хранилища она исчезнет, и человек будет уверен, что она в облаке.

## Что делать

Две правки. Первая — важнее.

### A9.1 — упавшую выгрузку ставим в очередь повтора

Очередь `syncQueue` уже умеет ровно это: `_drainPendingQueue` берёт локальный id,
дёргает `addCloudCopy` и чистит задачу только при успехе, а сам дренаж запускается
автоматически при восстановлении сети (`SyncManager` в `src/app/AppProviders.tsx`).
Значит правку надо делать **в самой `syncAllUnlinked`**, а не в компоненте: id упавшего
документа известен только там, и от неё же выиграет вторая вызывающая сторона.

`src/core/services/SyncService.ts`, метод `syncAllUnlinked`.

**Было:**

```ts
      const results = await Promise.allSettled(unlinked.map(doc =>
        limit(() => StorageService.addCloudCopy(userId, doc.id).then(cloudId => {
          if (!cloudId) throw new Error('no cloudId');
        }))
      ));

      let synced = 0;
      let failed = 0;
      for (const r of results) {
        if (r.status === 'fulfilled') synced++;
        else failed++;
      }

      return { synced, failed };
```

**Стало:**

```ts
      const results = await Promise.allSettled(unlinked.map(doc =>
        limit(() => StorageService.addCloudCopy(userId, doc.id).then(cloudId => {
          if (!cloudId) throw new Error('no cloudId');
        }))
      ));

      let synced = 0;
      const failedIds: string[] = [];
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') synced++;
        else failedIds.push(unlinked[i]!.id);
      });

      // Ставим упавшую выгрузку в очередь: иначе её никто не повторит. Эту
      // функцию зовут только перенос гостевых заметок и ручная кнопка в
      // диагностике, автоматического прохода по несвязанным заметкам нет, и
      // заметка молча остаётся только локальной.
      for (const id of failedIds) {
        try {
          await SyncService.addToQueue(id);
        } catch (e) {
          reportError(e, { action: 'syncAllUnlinked_queueFailed', documentId: id });
        }
      }

      return { synced, failed: failedIds.length };
```

`Promise.allSettled` сохраняет порядок входного массива, поэтому `unlinked[i]` — это
именно тот документ, чей результат лежит в `results[i]`.

Проверь импорты в начале файла: `reportError` из `'../../shared/errors/reportError'`
там **пока нет** — добавь рядом с `logger`. `SyncService.addToQueue` — метод того же
объекта, обращайся к нему через `SyncService.`, а не по короткому имени.

### A9.2 — честный текст пользователю

`src/features/auth/components/MigrationPrompt.tsx`.

**Было:**

```ts
          const { synced, failed } = await SyncService.syncAllUnlinked(userId);
          if (synced > 0) onCloudSynced?.(synced);
          if (failed > 0 && import.meta.env.DEV) {
            console.warn(`Migration: ${synced} synced, ${failed} failed`);
          }
```

**Стало:**

```ts
          const { synced, failed } = await SyncService.syncAllUnlinked(userId);
          if (synced > 0) onCloudSynced?.(synced);
          // Заметки перенесены в аккаунт локально в любом случае; в облако —
          // не все. Молчать об этом нельзя: человек закрывает окно с мыслью,
          // что копия в облаке есть.
          if (failed > 0) {
            showToast(t('migration_cloud_pending', { count: failed }), 'error');
          }
```

Новый ключ в `src/shared/i18n/translations/auth.ts` — вставь **сразу после**
`migration_synced_cloud`, соблюдая выравнивание соседних строк:

```ts
  migration_cloud_pending:      { ru: 'В облако пока не ушло: {count}. Заметки сохранены на устройстве, попробуем позже.', en: 'Not yet uploaded: {count}. Saved on this device, we will retry later.' },
```

Окно по-прежнему закрывается (`onDone()`) — это правильно, локальный перенос
действительно состоялся. Меняется только то, что пользователю говорят.

## Тест

Новый файл `src/core/services/__tests__/syncAllUnlinkedRetry.test.ts`. Тест на
`syncAllUnlinked`, не на компонент — проверяем поведение, а не тост.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../storage/localDb';
import { SyncService } from '../SyncService';
import { StorageService } from '../StorageService';
import { CloudSyncService } from '../CloudSyncService';

const USER = 'user_retry';

async function seed() {
  const db = await getLocalDb();
  for (const rec of await db.getAll('documents')) await db.delete('documents', (rec as { id: string }).id);
  for (const rec of await db.getAll('syncQueue')) await db.delete('syncQueue', (rec as { id: string }).id);
  await db.put('documents', {
    id: 'local_fails', guestId: USER, title: 'n', currentVersion: 1, totalWords: 1,
    totalDuration: 0, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1,
    tags: [], linkedCloudId: '',
  } as never);
}

// syncAllUnlinked зовут только перенос гостевых заметок и ручная кнопка в
// диагностике. Автоматического прохода по несвязанным заметкам нет: если
// выгрузка упала и задачу никто не поставил в очередь, заметка остаётся только
// локальной навсегда.
describe('syncAllUnlinked queues what it could not upload', () => {
  beforeEach(async () => {
    await seed();
    vi.restoreAllMocks();
    vi.spyOn(CloudSyncService, 'relinkOrphanedDocuments').mockResolvedValue(undefined as never);
  });

  it('puts a failed upload into the sync queue', async () => {
    vi.spyOn(StorageService, 'addCloudCopy').mockRejectedValue(new Error('network'));

    const { synced, failed } = await SyncService.syncAllUnlinked(USER);

    expect(synced).toBe(0);
    expect(failed).toBe(1);
    const db = await getLocalDb();
    const queued = (await db.getAll('syncQueue')).filter(i => i.documentId === 'local_fails');
    expect(queued).toHaveLength(1);
    // A7: задача принадлежит своему аккаунту, иначе дренаж её пропустит.
    expect(queued[0]!.ownerId).toBe(USER);
  });

  it('does not queue anything when the upload succeeds', async () => {
    vi.spyOn(StorageService, 'addCloudCopy').mockResolvedValue('cloud_1');

    const { synced, failed } = await SyncService.syncAllUnlinked(USER);

    expect(synced).toBe(1);
    expect(failed).toBe(0);
    const db = await getLocalDb();
    expect((await db.getAll('syncQueue')).filter(i => i.documentId === 'local_fails')).toHaveLength(0);
  });
});
```

Если фактическая сигнатура `relinkOrphanedDocuments` или `addCloudCopy` отличается —
подставь настоящую, но **утверждения не меняй**. Тест подгоняют под поведение, а не
наоборот. Если тест красный не из-за мока, а по существу — значит правка не сделана.

**Проверка на невакуумность:** убери из `syncAllUnlinked` цикл постановки в очередь —
первый тест обязан упасть.

---

# A10 — миграция шифрования рапортует успех после исчерпания бюджета записи

## Что сломано

`src/core/crypto/encryptMigration.ts`, `_encryptAllExistingNotesInner`. Два места
выходят из цикла по исчерпании дневного бюджета записей:

```ts
if (!tryReserveBulkWriteBudget()) break;   // строка ~153, версии документов
if (!tryReserveBulkWriteBudget()) break;   // строка ~207, черновики
```

Ни одно не ставит `hadErrors`. В конце:

```ts
if (!hadErrors) clearCheckpoint(userId);
```

Чекпойнт — единственная память о том, что уже зашифровано. Его сносят, хотя обработана
лишь часть. Последствия ровно две:

1. UI показывает `settings_encrypt_done` («Зашифровано заметок: N») и ноль ошибок.
   Пользователь считает, что весь архив зашифрован. Часть заметок лежит в облаке
   открытым текстом.
2. Следующий запуск начинает с нуля и заново перебирает всё, что уже зашифровано.
   Повторные заметки отсеются по `_encrypted`, но **прочитаны** будут все — а именно
   чтения выбили лимит 31 июля (см. историю квот).

Есть и третье, менее очевидное. `break` в цикле по версиям выходит только из
**внутреннего** цикла. Внешний продолжает идти по всем оставшимся документам, и на
каждом делает `getDocs(...versions)` — полное чтение подколлекции ради того, чтобы
сразу же сломаться на первом же `tryReserveBulkWriteBudget()`. Бюджет записи кончился,
а чтения продолжают гореть до конца списка документов.

## Что делать

### A10.1 — запомнить, что бюджет кончился

В начале `_encryptAllExistingNotesInner`, рядом с `let hadErrors = false;`:

```ts
  let hadErrors = false;
  let budgetExhausted = false;
```

Оба места с `break` (версии, ~153; черновики, ~207):

**Было:**

```ts
          if (!tryReserveBulkWriteBudget()) break;
```

**Стало:**

```ts
          if (!tryReserveBulkWriteBudget()) { budgetExhausted = true; break; }
```

Отступы разные — во внутреннем цикле по версиям их больше. Сохрани существующие.

### A10.2 — не сносить чекпойнт и не жечь чтения

**Было:**

```ts
  if (!hadErrors) clearCheckpoint(userId);
  return progress;
```

**Стало:**

```ts
  // Чекпойнт — единственная память о проделанной работе. Снести его после
  // обрыва по бюджету значит на следующем запуске перечитать весь архив
  // заново: повторные заметки отсеются по _encrypted, но чтения уже потрачены.
  if (!hadErrors && !budgetExhausted) clearCheckpoint(userId);
  return progress;
```

И прекратить обход документов, когда бюджет уже кончился. В цикле
`for (const documentDoc of docsSnap.docs) {` первой строкой тела:

```ts
    for (const documentDoc of docsSnap.docs) {
      // Бюджет записи кончился — дальше идти незачем. Иначе на каждый
      // оставшийся документ уходит полное чтение подколлекции версий ради
      // мгновенного выхода по тому же бюджету.
      if (budgetExhausted) break;
      const documentId = documentDoc.id;
```

### A10.3 — сказать это пользователю

В интерфейс `MigrationProgress` (начало файла) добавь поле:

```ts
export interface MigrationProgress {
  total: number;
  processed: number;
  encrypted: number;
  errors: number;
  /** Прервано дневным лимитом записей, а не доведено до конца. */
  incomplete?: boolean;
}
```

И перед `return progress;` в конце `_encryptAllExistingNotesInner`:

```ts
  if (budgetExhausted) progress.incomplete = true;
```

`src/features/settings/components/AccountVaultSection.tsx`, блок готовности
(строка ~289, `{t('settings_encrypt_done', ...)}`).

**Было:**

```tsx
              <div className="text-sm text-green-400">{t('settings_encrypt_done', { count: migrationProgress?.encrypted ?? 0 })}</div>
```

**Стало:**

```tsx
              <div className={migrationProgress?.incomplete ? 'text-sm text-text-main' : 'text-sm text-green-400'}>
                {t('settings_encrypt_done', { count: migrationProgress?.encrypted ?? 0 })}
              </div>
              {migrationProgress?.incomplete && (
                <div className="text-xs text-text-main/60 mt-1">{t('settings_encrypt_budget_stop')}</div>
              )}
```

Новый ключ в `src/shared/i18n/translations/settings.ts`, сразу после
`settings_encrypt_errors`, с тем же выравниванием:

```ts
  settings_encrypt_budget_stop:{ ru: 'Дневной лимит записей исчерпан — зашифровано не всё. Продолжится завтра с того же места.', en: 'Daily write limit reached — not everything was encrypted. It will resume tomorrow where it stopped.' },
```

## Тест

Добавь в существующий `src/core/crypto/__tests__/encryptMigration.test.ts` новый
`describe` в конец файла. Мок `writeBudget` придётся объявить рядом с остальными
`vi.mock` в **начале** файла (`vi.mock` поднимается наверх, внутри `describe` он не
сработает):

```ts
const mockTryReserve = vi.fn(() => true);
vi.mock('../../firebase/writeBudget', () => ({
  tryReserveBulkWriteBudget: () => mockTryReserve(),
  areCloudWritesBlockedToday: () => false,
  isGlobalWriteFailure: () => false,
  blockCloudWritesToday: () => {},
}));
```

Сам тест:

```ts
// Чекпойнт — единственная память о том, что уже зашифровано. Раньше обрыв по
// бюджету не считался ошибкой, чекпойнт сносился, и следующий запуск перечитывал
// весь архив заново — при том, что лимит выбивают именно чтения.
describe('encryptAllExistingNotes — обрыв по бюджету записей', () => {
  const userId = 'user_budget';
  const key = `encryptionMigration_${userId}_checkpoint`;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockTryReserve.mockReturnValue(true);
  });

  it('сохраняет чекпойнт и помечает результат неполным', async () => {
    localStorage.setItem(key, JSON.stringify(['v_doc1_ver_old']));
    mockGetDocs.mockResolvedValue(createMockSnapshot([]));
    mockTryReserve.mockReturnValue(false);

    const progress = await encryptAllExistingNotes(userId);

    expect(progress.incomplete).toBe(true);
    expect(localStorage.getItem(key)).not.toBeNull();
  });

  it('чистит чекпойнт, когда бюджета хватило', async () => {
    localStorage.setItem(key, JSON.stringify(['v_doc1_ver_old']));
    mockGetDocs.mockResolvedValue(createMockSnapshot([]));

    const progress = await encryptAllExistingNotes(userId);

    expect(progress.incomplete).toBeFalsy();
    expect(localStorage.getItem(key)).toBeNull();
  });
});
```

`createMockSnapshot` и `mockGetDocs` уже объявлены в этом файле — используй их, не
заводи вторые. Если пустой снапшот не доводит выполнение до `break` (бюджет
проверяется внутри цикла по версиям), подай снапшот с одним документом и одной
версией — но **утверждения оставь как есть**.

**Проверка на невакуумность:** верни `if (!hadErrors) clearCheckpoint(userId);` —
первый тест обязан упасть на `localStorage.getItem(key)`.

---

# A11 — согласие с политикой конфиденциальности проверяется до восстановления сессии

## Что сломано

`src/features/auth/components/PrivacyModal.tsx`, хук `usePrivacyCheck`:

```ts
  useEffect(() => {
    const check = async () => {
      const user = auth.currentUser;
      if (!user) return;
      ...
    };
    void check();
  }, []);
```

Пустой массив зависимостей: эффект выполняется один раз при монтировании и больше
никогда. Firebase восстанавливает сессию асинхронно, и в момент монтирования
`auth.currentUser` почти всегда `null` — проверка выходит на первой строке и не
повторяется, когда пользователь появится.

Отсюда: модалка не показывается тому, кто согласия ещё не давал (проверка просто не
сработала), и не появляется после входа в аккаунт в той же вкладке.

## Что делать

Взять пользователя из контекста, который уже подписан на `onAuthStateChanged`, вместо
разового чтения `auth.currentUser`. Ничего нового заводить не нужно: `AuthContext`
это делает, а `usePrivacyCheck` вызывается внутри `PrivacyGuard`, который уже под
`AuthProvider`.

**Было:**

```ts
export function usePrivacyCheck() {
  const [showPrivacy, setShowPrivacy] = useState(false);

  useEffect(() => {
    const check = async () => {
      const user = auth.currentUser;
      if (!user) return;

      const cached = localStorage.getItem(`privacy_accepted_${user.uid}`);
      if (cached === 'true') return;

      try {
        const { db, mod } = await getClient();
        const { doc, getDoc } = mod;
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (snap.exists() && snap.data()?.privacyAcceptedAt) {
          localStorage.setItem(`privacy_accepted_${user.uid}`, 'true');
          return;
        }
        setShowPrivacy(true);
      } catch {
        setShowPrivacy(true);
      }
    };
    void check();
  }, []);

  return { showPrivacy, setShowPrivacy };
}
```

**Стало:**

```ts
export function usePrivacyCheck() {
  const [showPrivacy, setShowPrivacy] = useState(false);
  // Firebase восстанавливает сессию асинхронно: на момент монтирования
  // auth.currentUser почти всегда null. Разовое чтение выходило на первой
  // строке и не повторялось — согласие не спрашивали ни у кого.
  const { user } = useAuth();
  const uid = user?.uid;

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;

    const check = async () => {
      const cached = localStorage.getItem(`privacy_accepted_${uid}`);
      if (cached === 'true') return;

      try {
        const { db, mod } = await getClient();
        const { doc, getDoc } = mod;
        const snap = await getDoc(doc(db, 'users', uid));
        if (cancelled) return;
        if (snap.exists() && snap.data()?.privacyAcceptedAt) {
          localStorage.setItem(`privacy_accepted_${uid}`, 'true');
          return;
        }
        setShowPrivacy(true);
      } catch {
        if (!cancelled) setShowPrivacy(true);
      }
    };
    void check();
    return () => { cancelled = true; };
  }, [uid]);

  return { showPrivacy, setShowPrivacy };
}
```

`cancelled` нужен потому, что теперь эффект может перезапуститься при смене аккаунта,
а `getDoc` — асинхронный: без флага ответ по старому uid показал бы модалку уже
другому пользователю.

Импорты в начале файла:

```ts
import { useAuth } from '../contexts/AuthContext';
```

После правки `auth` в этом файле остаётся нужен — его использует `handleAccept`
(`auth.currentUser` там читается по клику, когда сессия заведомо есть, это корректно).
Импорт `auth` **не удаляй**. Если `npm run lint` скажет обратное — значит ты задел
`handleAccept`, чего делать не нужно.

## Тест

Новый файл `src/features/auth/__tests__/privacyCheck.test.tsx`. Проверяем именно то,
что сломано: пользователь появляется **после** монтирования.

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePrivacyCheck } from '../components/PrivacyModal';

const mockGetDoc = vi.fn();
vi.mock('../../../core/firebase/firestoreClient', () => ({
  getClient: async () => ({
    db: {},
    mod: { doc: (_db: unknown, ...p: string[]) => ({ path: p.join('/') }), getDoc: mockGetDoc },
  }),
}));

let currentUser: { uid: string } | null = null;
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: currentUser }),
}));

// Firebase восстанавливает сессию асинхронно. Разовое чтение auth.currentUser
// при монтировании видело null и больше не повторялось.
describe('usePrivacyCheck ждёт восстановления сессии', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    currentUser = null;
    mockGetDoc.mockResolvedValue({ exists: () => false, data: () => ({}) });
  });

  it('спрашивает согласие у пользователя, появившегося после монтирования', async () => {
    const { result, rerender } = renderHook(() => usePrivacyCheck());
    expect(result.current.showPrivacy).toBe(false);

    currentUser = { uid: 'u1' };
    rerender();

    await waitFor(() => expect(result.current.showPrivacy).toBe(true));
  });

  it('не спрашивает второй раз, если согласие уже сохранено локально', async () => {
    localStorage.setItem('privacy_accepted_u1', 'true');
    currentUser = { uid: 'u1' };

    const { result } = renderHook(() => usePrivacyCheck());

    await waitFor(() => expect(mockGetDoc).not.toHaveBeenCalled());
    expect(result.current.showPrivacy).toBe(false);
  });
});
```

`@testing-library/react` в репозитории есть, `renderHook`/`waitFor` уже используются —
образец рядом: `src/features/auth/hooks/__tests__/useAdminStatus.test.ts`, он тоже
мокает `AuthContext`. Повтори его способ, новых зависимостей не ставь.

**Проверка на невакуумность:** верни `}, []);` вместо `}, [uid]);` — первый тест обязан
упасть.

---

# Как закончить

После каждой задачи — свой коммит, Conventional Commits:

- `fix(sync): a failed migration upload must be retried, not forgotten (A9)`
- `fix(crypto): a budget stop is not a finished migration (A10)`
- `fix(auth): privacy check must wait for the restored session (A11)`

После всех трёх, из корня репозитория:

```
npx tsc --noEmit
npm run lint
npx vitest run
npm run build
```

Все четыре обязаны пройти. `npm run lint` — целиком, не по файлам.

Не пушить. В отчёте по каждой задаче укажи: какой тест добавлен, и **что именно
показала проверка на невакуумность** — какой тест упал и на каком утверждении. Если
проверку не делал, так и напиши, не пиши «тесты зелёные».
