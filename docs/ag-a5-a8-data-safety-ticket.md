# AG-A5…A8 — четыре правки сохранности данных

**Приоритет:** P1 · пункты A5–A8 бэклога (`docs/backlog-pre-migration.md`) · Объём: средний
**Ветка от:** `main` (сейчас `55283fb9`).

Четыре независимые задачи в одном файле. Делай **по порядку**, каждую — отдельным
коммитом, со своим тестом. Если какая-то не пойдёт — останови её и переходи к
следующей, не переделывай уже сделанные.

Ниже точный код «Было»/«Стало». Отклоняться не нужно: соседние места правились на этой
неделе, и вольная правка даст конфликт.

**Общие границы для всех четырёх:**

- не трогать `addCloudCopy`, `addLocalCopy`, `relinkOrphaned`, `restoreMissingDocuments`,
  обрезку версий и бюджеты записи/чтения — там свежие изменения;
- не менять версию приложения и `CHANGELOG.md`;
- не поднимать версию IndexedDB (`localDb.ts`, `upgrade`) — ни одна из задач этого не
  требует, а откат фронтенда после такого подъёма ломает клиентов;
- заканчивать проверки командой `npm run lint`, а не `npx eslint <файлы>`: репозиторный
  скрипт идёт с `--max-warnings 0`, и именно на этой разнице недавно уехал красный `main`.

---

# A5 — первое сохранение заметки не атомарно

## Что сломано

`src/core/services/LocalStorageService.ts`, метод `saveNew` — три независимые операции
подряд, каждая со своей транзакцией:

```ts
const localId = await LocalDocumentService.createDocument(...);   // 1
await LocalVersionService.addVersion(...);                        // 2
await LocalDocumentService.updateAfterSession(...);               // 3
```

Сбой между ними (закрытая вкладка, переполнение квоты браузера, отказ IndexedDB)
оставляет мусор: документ без единой версии, либо документ с версией, но со счётчиками
`currentVersion: 0` и `totalWords: 0`. Первое — заметка, которая открывается пустой;
второе — заметка, которую синхронизация и поиск считают пустышкой.

Продолжение существующей заметки (`saveVersionToLocal`) уже пишет документ и версию в
одной транзакции — здесь нужно то же самое.

## Правка

Заменить метод `saveNew` целиком (файл `src/core/services/LocalStorageService.ts`,
строки 9–34) на:

```ts
  async saveNew(userId: string, data: SaveDocumentData): Promise<{ localId: string }> {
    const db = await getLocalDb();
    const localId = `local_${randomUUID()}`;
    const versionId = `ver_${randomUUID()}`;
    const now = Date.now();
    const diff = computeWordDelta('', data.content);
    const totalWords = data.documentWordCount ?? data.wordCount;

    // Document and its first version in ONE transaction. As three separate
    // writes, a crash in between left either a note with no versions (opens
    // empty) or a note whose counters say it is empty while the text exists —
    // and the first save is exactly when a new user is most likely to close the
    // tab. Continuation already does this atomically; the first save must too.
    const tx = db.transaction(['documents', 'versions'], 'readwrite');
    await tx.objectStore('documents').put({
      id: localId,
      guestId: userId,
      title: data.title || '',
      currentVersion: 1,
      totalWords,
      totalDuration: data.duration,
      sessionsCount: 1,
      firstSessionAt: now,
      lastSessionAt: now,
      tags: data.tags ?? [],
      labelId: data.labelId ?? undefined,
      mood: data.mood,
    });
    await tx.objectStore('versions').put({
      id: versionId,
      documentId: localId,
      guestId: userId,
      version: 1,
      content: data.content,
      wordCount: data.wordCount,
      wordsAdded: diff.wordsAdded,
      charsAdded: diff.charsAdded,
      duration: data.duration,
      wpm: data.wpm,
      goalWords: data.goalWords,
      goalTime: data.goalTime,
      goalReached: data.goalReached ?? false,
      savedAt: now,
      sessionStartedAt: data.sessionStartedAt.getTime(),
      mood: data.mood,
    });
    await tx.done;

    // Profile totals are an aggregate: recomputed after the fact, never a reason
    // to hold the note's own write open.
    try {
      await LocalDocumentService.recomputeProfileTotals(userId);
    } catch (e) {
      reportError(e, { action: 'saveNew_profileTotals', userId });
    }

    return { localId };
  },
```

Добавить в `src/core/services/LocalDocumentService.ts` новый метод (в конец объекта,
перед закрывающей `};`):

```ts
  /** Recomputes the profile aggregate from the documents themselves. Cheap at
   *  this scale and always consistent, unlike incremental deltas that drift
   *  whenever a write in the middle of a sequence fails. */
  async recomputeProfileTotals(guestId: string): Promise<void> {
    const db = await getLocalDb();
    const docs = await db.getAllFromIndex('documents', 'by-guest', guestId);
    const totals = docs.reduce(
      (acc, d) => ({
        totalWords: acc.totalWords + (d.totalWords || 0),
        totalDuration: acc.totalDuration + (d.totalDuration || 0),
        sessionsCount: acc.sessionsCount + (d.sessionsCount || 0),
        lastSessionAt: Math.max(acc.lastSessionAt, d.lastSessionAt || 0),
      }),
      { totalWords: 0, totalDuration: 0, sessionsCount: 0, lastSessionAt: 0 },
    );
    const tx = db.transaction('profile', 'readwrite');
    const existing = await tx.store.get(guestId);
    await tx.store.put({ ...(existing ?? { guestId }), ...totals });
    await tx.done;
  },
```

Проверь, что в `LocalStorageService.ts` уже импортированы `randomUUID`, `computeWordDelta`
и `reportError` — они есть в первых шести строках файла. Если после правки
`LocalDocumentService` или `LocalVersionService` перестанут использоваться в этом файле,
не удаляй их импорты: они нужны другим методам.

## Тест

Новый файл `src/core/services/__tests__/saveNewAtomic.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../storage/localDb';
import { LocalStorageService } from '../LocalStorageService';

const USER = 'user_atomic';

async function clear() {
  const db = await getLocalDb();
  for (const store of ['documents', 'versions'] as const) {
    for (const rec of await db.getAll(store)) await db.delete(store, (rec as { id: string }).id);
  }
}

// Three separate writes could leave a note with no versions, or a note whose
// counters claim it is empty while the text exists.
describe('saveNew is atomic', () => {
  beforeEach(clear);

  it('writes the document and its first version together, with counters set', async () => {
    const { localId } = await LocalStorageService.saveNew(USER, {
      title: 'Заголовок', content: 'первый текст', wordCount: 2, duration: 60, wpm: 2,
      tags: ['тег'], sessionStartedAt: new Date(1000),
    } as never);

    const db = await getLocalDb();
    const doc = await db.get('documents', localId);
    const versions = await db.getAllFromIndex('versions', 'by-document', localId);

    expect(versions).toHaveLength(1);
    expect(versions[0]!.content).toBe('первый текст');
    // The counters must not say "empty note" while the text is right there.
    expect(doc!.currentVersion).toBe(1);
    expect(doc!.totalWords).toBe(2);
    expect(doc!.sessionsCount).toBe(1);
    expect(doc!.title).toBe('Заголовок');
    expect(doc!.tags).toEqual(['тег']);
  });

  it('leaves nothing behind when the write fails', async () => {
    const db = await getLocalDb();
    const before = (await db.getAll('documents')).length;

    await expect(
      LocalStorageService.saveNew(USER, { title: 'x', content: 'y' } as never),
    ).rejects.toBeTruthy();

    expect((await db.getAll('documents')).length).toBe(before);
    expect((await db.getAll('versions')).length).toBe(0);
  });
});
```

Второй тест опирается на то, что `data.sessionStartedAt` отсутствует и обращение к
`.getTime()` бросает **до** `tx.done`, поэтому транзакция откатывается. Если у тебя он
падает иначе — не подгоняй тест, напиши в отчёте, что именно произошло.

---

# A6 — продолжение заметки теряет заголовок, теги и метку

## Что сломано

`src/core/services/LocalStorageService.ts`, метод `saveVersionToLocal`. Payload
(`SaveDocumentData`) содержит `title`, `tags`, `labelId`, но запись документа их
игнорирует:

```ts
      await docStore.put({
        ...existing,
        totalWords,
        totalDuration: data.duration,
        currentVersion: newVersion,
        sessionsCount: (existing.sessionsCount || 0) + 1,
        lastSessionAt: now,
        mood: data.mood,
      });
```

Если во время продолжения сессии пользователь поменял заголовок, теги или метку — новая
версия текста сохранится, а метаданные после перезагрузки останутся прежними.

## Правка

Заменить этот вызов `docStore.put` на:

```ts
      await docStore.put({
        ...existing,
        // Metadata edited during the session travels in the same payload as the
        // text and must be persisted in the same write. Only counters were
        // written before, so a title or tag changed while continuing a note was
        // silently discarded on reload.
        title: data.title || existing.title,
        tags: data.tags ?? existing.tags,
        labelId: data.labelId ?? existing.labelId,
        totalWords,
        totalDuration: data.duration,
        currentVersion: newVersion,
        sessionsCount: (existing.sessionsCount || 0) + 1,
        lastSessionAt: now,
        mood: data.mood,
      });
```

Обрати внимание на `data.title || existing.title`: пустой заголовок из payload не должен
затирать существующий. Для `tags` и `labelId` — `??`, потому что пустой массив это
осмысленное «тегов больше нет», а `undefined` означает «не менялось».

**Облачную сторону не трогай.** Аудит верно отмечает, что `updateDocumentAfterSession`
тоже не переносит метаданные, но её схема и правила Firestore ограничивают набор полей,
и это отдельная задача. Здесь — только локальная запись.

## Тест

Дописать в конец существующего файла `src/features/writing/__tests__/storageService.test.ts`:

```ts
// Metadata edited while continuing a note travels in the same payload as the
// text; writing only the counters silently discarded it on reload.
describe('saveVersionToLocal keeps metadata', () => {
  it('persists a title, tags and label changed during the session', async () => {
    const db = await getLocalDb();
    const { localId } = await LocalStorageService.saveNew('user_meta', {
      title: 'Старый', content: 'раз', wordCount: 1, duration: 0, wpm: 0,
      tags: ['старый'], sessionStartedAt: new Date(1000),
    } as never);

    await LocalStorageService.saveVersionToLocal(db, localId, {
      title: 'Новый', content: 'раз два', wordCount: 2, duration: 0, wpm: 0,
      tags: ['новый'], labelId: 'label_1', sessionStartedAt: new Date(2000),
    } as never, Date.now());

    const doc = await db.get('documents', localId);
    expect(doc!.title).toBe('Новый');
    expect(doc!.tags).toEqual(['новый']);
    expect(doc!.labelId).toBe('label_1');
  });

  it('does not wipe an existing title when the payload has none', async () => {
    const db = await getLocalDb();
    const { localId } = await LocalStorageService.saveNew('user_meta2', {
      title: 'Держится', content: 'раз', wordCount: 1, duration: 0, wpm: 0,
      tags: [], sessionStartedAt: new Date(1000),
    } as never);

    await LocalStorageService.saveVersionToLocal(db, localId, {
      title: '', content: 'раз два', wordCount: 2, duration: 0, wpm: 0,
      sessionStartedAt: new Date(2000),
    } as never, Date.now());

    expect((await db.get('documents', localId))!.title).toBe('Держится');
  });
});
```

Импорты (`getLocalDb`, `LocalStorageService`, `describe/it/expect`) в этом файле уже
есть — проверь и добавь недостающие, ничего не удаляя.

---

# A7 — очередь синхронизации не знает владельца

## Что сломано

`src/core/storage/localDb.ts`, тип хранилища:

```ts
  syncQueue: {
    key: string;
    value: { id: string; documentId: string; type: 'document' | 'version' | 'delete' | 'portrait'; createdAt: number; };
```

У задачи нет владельца. `_drainPendingQueue(userId)` берёт **все** записи и выполняет их
под текущим пользователем — включая `removeCloudCopy`, то есть удаление в облаке. При
смене аккаунта, гонке вкладок или восстановлении после сбоя задача, поставленная одним
пользователем, может выполниться под другим.

## Правка 1 — тип

`src/core/storage/localDb.ts`, в объявлении `syncQueue`:

```ts
  syncQueue: {
    key: string;
    value: { id: string; documentId: string; type: 'document' | 'version' | 'delete' | 'portrait'; createdAt: number; ownerId?: string | undefined; };
```

Поле **опциональное** — это добавление к значению, а не к индексу, поэтому подъём версии
IndexedDB не нужен и делать его нельзя. Старые записи без `ownerId` остаются валидными.

## Правка 2 — проставить владельца во всех семи местах записи

Везде добавляется одно поле в объект, передаваемый в `put`. Ничего другого не меняется.

1. `src/core/services/SyncService.ts`, `addToQueue` — идентификатора пользователя в
   сигнатуре нет, поэтому владелец берётся у самого документа:

```ts
  async addToQueue(documentId: string): Promise<void> {
    const db = await getLocalDb();
    // The queue task inherits the note's owner. A task with no owner could be
    // drained under whichever account happens to be signed in next.
    const doc = await db.get('documents', documentId);
    const tx = db.transaction('syncQueue', 'readwrite');
    const existing = await tx.store.getAll();
    const cutoff = Date.now() - 60_000;
    const hasRecent = existing.some(item => item.documentId === documentId && item.createdAt >= cutoff);
    if (!hasRecent) {
      await tx.store.put({
        id: `sync_${documentId}_${Date.now()}`,
        documentId,
        type: 'document' as const,
        createdAt: Date.now(),
        ownerId: doc?.guestId,
      });
    }
    await tx.done;
  },
```

2. `src/core/services/CloudSyncService.ts` — **три** места в `syncVersionToCloud`
   (ветка «нет соединения», ветка «облачный документ не найден» и `catch`). В каждом в
   объект `put` добавить `ownerId: userId,` — `userId` уже есть в области видимости.

3. `src/core/services/ConflictResolver.ts`, `resolveConflict` — добавить
   `ownerId: userId,` (параметр `userId` есть в сигнатуре).

4. `src/core/services/StorageService.ts`, `deleteDocument` — добавить `ownerId: userId,`.

5. `src/features/ai/services/AIProfileService.ts` — добавить `ownerId: uid,`.

## Правка 3 — не выполнять чужие задачи

`src/core/services/SyncService.ts`, функция `_drainPendingQueue`. Найти:

```ts
  const pending = queue.filter(item => {
    if (item.id.startsWith('lock_cloud_')) return false;
    return true;
  });
```

Заменить на:

```ts
  // A task belongs to the account that created it. Draining someone else's —
  // after an account switch, a multi-tab race or a crash recovery — would upload
  // or DELETE their cloud documents under this user. Tasks predating the owner
  // field have no stamp and are treated as this user's: they can only have come
  // from this device's own earlier session.
  const foreign = queue.filter(item => item.ownerId !== undefined && item.ownerId !== userId);
  if (foreign.length > 0) {
    reportError(
      new Error(`Sync queue holds ${foreign.length} task(s) belonging to another account`),
      { action: 'drainPendingQueue_foreignOwner', count: foreign.length },
      'warning',
    );
  }

  const pending = queue.filter(item => {
    if (item.id.startsWith('lock_cloud_')) return false;
    if (item.ownerId !== undefined && item.ownerId !== userId) return false;
    return true;
  });
```

Проверь, что `reportError` импортирован в `SyncService.ts`; если нет — добавь
`import { reportError } from '../../shared/errors/reportError';`.

**Чужие задачи не удаляются** — они остаются в очереди на случай, если их владелец
снова войдёт. Удалять чужие данные, разбираясь с чужими данными, нельзя.

## Тест

Новый файл `src/core/services/__tests__/syncQueueOwner.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../storage/localDb';
import { SyncService } from '../SyncService';
import { CloudSyncService } from '../CloudSyncService';

const ME = 'user_me';
const SOMEONE_ELSE = 'user_other';

async function clearQueue() {
  const db = await getLocalDb();
  for (const rec of await db.getAll('syncQueue')) await db.delete('syncQueue', (rec as { id: string }).id);
  localStorage.setItem('auto_sync_enabled', 'true');
}

// _drainPendingQueue executes every task under the CURRENT user, including
// removeCloudCopy — deleting cloud documents. A task with no owner could be
// drained under whichever account signed in next.
describe('sync queue respects the owner', () => {
  beforeEach(clearQueue);

  it('does not run a task belonging to another account', async () => {
    const db = await getLocalDb();
    await db.put('syncQueue', {
      id: 'delete_theirs', documentId: 'cloud_theirs', type: 'delete',
      createdAt: Date.now(), ownerId: SOMEONE_ELSE,
    } as never);
    const remove = vi.spyOn(CloudSyncService, 'removeCloudCopy').mockResolvedValue(undefined);

    await SyncService.syncPending(ME);

    expect(remove).not.toHaveBeenCalled();
    // And it stays: it is not ours to delete either.
    expect(await db.get('syncQueue', 'delete_theirs')).toBeTruthy();
  });

  it('runs a task stamped with this account', async () => {
    const db = await getLocalDb();
    await db.put('syncQueue', {
      id: 'delete_mine', documentId: 'cloud_mine', type: 'delete',
      createdAt: Date.now(), ownerId: ME,
    } as never);
    const remove = vi.spyOn(CloudSyncService, 'removeCloudCopy').mockResolvedValue(undefined);

    await SyncService.syncPending(ME);

    expect(remove).toHaveBeenCalledWith(ME, 'cloud_mine');
  });

  it('stamps the note\'s owner when queueing', async () => {
    const db = await getLocalDb();
    await db.put('documents', {
      id: 'local_owned', guestId: ME, title: 'n', currentVersion: 1, totalWords: 1,
      totalDuration: 0, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1, tags: [],
    } as never);

    await SyncService.addToQueue('local_owned');

    const queued = (await db.getAll('syncQueue')).find(i => i.documentId === 'local_owned');
    expect(queued?.ownerId).toBe(ME);
  });
});
```

---

# A8 — черновик гостя не переносится при регистрации

## Что сломано

`src/features/writing/services/GuestDraftService.ts` хранит гостевой черновик под
**литеральным** ключом:

```ts
const GUEST_IDB_KEY = 'guest_draft';
await db.put('drafts', { ...withMeta, userId: GUEST_IDB_KEY } as LocalDraft);
```

А миграция при регистрации ищет его по сгенерированному идентификатору гостя —
`src/features/auth/components/MigrationPrompt.tsx`:

```ts
  const guestId = getOrCreateGuestId();
  ...
    const guestDraft = await draftStore.get(guestId);
```

Ключи разные, поэтому незаконченный черновик не мигрирует никогда: заметки переезжают,
а текст, который человек не успел сохранить, остаётся сиротой и пропадает из виду.

## Правка

`src/features/auth/components/MigrationPrompt.tsx`, блок «D-3: migrate guest draft».

**Было:**

```ts
  const draftPuts: Promise<unknown>[] = [];
  if (draftStore) {
    const guestDraft = await draftStore.get(guestId);
    if (guestDraft) {
      const existingUserDraft = await draftStore.get(userId);
      if (!existingUserDraft) {
        draftPuts.push(draftStore.put({ ...guestDraft, userId }));
      }
    }
  }
```

**Стало:**

```ts
  const draftPuts: Promise<unknown>[] = [];
  if (draftStore) {
    // GuestDraftService stores the unfinished draft under the literal key
    // 'guest_draft', not under the generated guest id — so looking it up by
    // guestId alone never found it, and the one piece of writing the user had
    // not saved yet was the only thing that did not migrate. Both keys are
    // checked; the literal one wins because that is what the writer uses today.
    const guestDraft = (await draftStore.get('guest_draft')) ?? (await draftStore.get(guestId));
    if (guestDraft) {
      const existingUserDraft = await draftStore.get(userId);
      if (!existingUserDraft) {
        draftPuts.push(draftStore.put({ ...guestDraft, userId }));
      }
    }
  }
```

**Источник не удаляй.** Существующий код его и не удаляет — оставь как есть: черновик
гостя должен пережить неудачную миграцию.

## Тест

Новый файл `src/features/auth/__tests__/guestDraftMigration.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../../core/storage/localDb';

const USER = 'user_new';

// GuestDraftService writes under the literal key 'guest_draft'; the migration
// looked it up by the generated guest id, so the unfinished draft — the one
// thing not yet saved anywhere — never migrated.
describe('guest draft key', () => {
  beforeEach(async () => {
    const db = await getLocalDb();
    for (const rec of await db.getAll('drafts')) {
      await db.delete('drafts', (rec as { userId: string }).userId);
    }
  });

  it('the writer and the migration must agree on the key', async () => {
    const db = await getLocalDb();
    const { GuestDraftService } = await import('../../writing/services/GuestDraftService');

    await GuestDraftService.save({
      userId: 'ignored', title: 'черновик', content: 'незаконченная мысль',
      seconds: 0, wpm: 0, wordCount: 2, updatedAt: Date.now(),
    } as never);

    // Whatever key the writer chose, this is the record the migration has to find.
    const stored = await db.get('drafts', 'guest_draft');
    expect(stored?.content).toBe('незаконченная мысль');
  });

  it('a draft under the literal key reaches the new account', async () => {
    const db = await getLocalDb();
    await db.put('drafts', {
      userId: 'guest_draft', title: '', content: 'незаконченная мысль',
      seconds: 0, wpm: 0, wordCount: 2, updatedAt: Date.now(),
    } as never);

    // Mirrors the lookup the migration performs.
    const guestDraft = (await db.get('drafts', 'guest_draft')) ?? null;
    expect(guestDraft).toBeTruthy();
    await db.put('drafts', { ...guestDraft!, userId: USER });

    expect((await db.get('drafts', USER))?.content).toBe('незаконченная мысль');
  });
});
```

Если сигнатура `GuestDraftService.save` отличается от использованной в тесте — подставь
фактическую, но **не меняй** проверяемое утверждение: запись должна лежать под тем
ключом, который читает миграция.

---

## Проверки перед отчётом (после каждой задачи)

```bash
npx tsc --noEmit
npx vitest run
npm run lint
cd functions && npx tsc --noEmit && npx vitest run
npm run build
```

### Проверка невакуумности — обязательна для каждой задачи

Верни правку в исходное состояние, убедись, что падают именно новые тесты, верни обратно.
**Не откатывай через `git checkout <файл>`** — в файлах есть другие изменения, и он их
снесёт. Правь текстом.

В отчёте по каждой задаче: что менял, вывод `tsc`, `lint`, обоих прогонов тестов и какие
тесты упали при проверке невакуумности. Если тест падает не там, где ожидалось, — пиши
об этом, а не подгоняй тест под поведение.
