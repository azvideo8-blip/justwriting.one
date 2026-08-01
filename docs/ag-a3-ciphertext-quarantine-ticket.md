# AG-A3 — шифротекст не должен попадать в хранилище открытого текста

**Приоритет:** P0 · пункт A3 бэклога (`docs/backlog-pre-migration.md`) · Объём: маленький
**Файлы:** ровно два — `src/core/services/CloudSyncService.ts` и новый тест.
**Ветка от:** `main` (сейчас `140880d5`).

Тикет намеренно подробный: ниже точный код «до» и «после», готовый файл теста и
проверки. Отклоняться от указанного не нужно.

---

## Что сломано

`CloudSyncService.addLocalCopy` скачивает облачную заметку и раскладывает её версии в
локальную IndexedDB. Локальное хранилище содержит **открытый текст** — шифрование
применяется только к облачным записям.

Сейчас в `catch` вокруг расшифровки стоит:

```ts
} catch (decErr) {
  if (decErr instanceof Error && decErr.message.startsWith('LOCKED')) throw decErr;
  // Skip corrupted version but continue importing others
  verContent = ver.content ?? '';
}
```

Комментарий говорит «пропускаем повреждённую версию», а код делает противоположное:
берёт `ver.content` — то есть **сырой Base64-шифротекст облачной версии** — и ниже
записывает его через `LocalVersionService.addVersion` как обычный текст заметки.

Итог: заметка на устройстве превращается в строку вида `k7Hs9x2f…`, которая для
приложения неотличима от настоящего текста. Она попадёт в поиск, в экспорт, в резервную
копию и в контекст ИИ. Исходная запись при этом цела в облаке, но локально
пользователь видит мусор.

Та же ошибка есть на строке выше, в успешной ветке:

```ts
verContent = typeof decryptedVer.content === 'string' ? decryptedVer.content : (ver.content ?? '');
```

Если `maybeDecrypt` вернул не строку, снова подставляется сырой `ver.content`.

## Что должно стать

Три правила, в порядке важности:

1. **Никогда** не записывать `ver.content` в локальное хранилище, если расшифровка не
   удалась. Ни при `DecryptionError`, ни при неожиданном типе.
2. Повреждённая версия **пропускается** — импорт остальных продолжается.
3. **Но если повреждена самая свежая версия — импорт документа прерывается целиком.**
   Иначе заметка тихо покажет старый текст как актуальный, а это хуже, чем её
   отсутствие: пользователь не узнает, что видит не то. Существующий `catch` ниже уже
   удаляет наполовину созданный локальный документ и пробрасывает ошибку — этого
   достаточно, ничего дописывать не надо.

Поведение при `LOCKED` (запертый сейф) не меняется: как и сейчас, ошибка пробрасывается.

---

## Правка 1 — импорт

Файл `src/core/services/CloudSyncService.ts`, строка 8.

**Было:**

```ts
import { maybeEncrypt, maybeDecrypt, type VersionEncryptPayload, getEncryptionEnabled } from '../crypto/cryptoHelpers';
```

**Стало:**

```ts
import { maybeEncrypt, maybeDecrypt, DecryptionError, type VersionEncryptPayload, getEncryptionEnabled } from '../crypto/cryptoHelpers';
```

`DecryptionError` уже экспортируется из `src/core/crypto/cryptoHelpers.ts:79`, объявлять
его заново не нужно.

## Правка 2 — цикл импорта версий

Файл тот же, метод `addLocalCopy`, строки 139–169.

**Было** (весь блок, от `let prevContent` до закрывающей скобки цикла):

```ts
      let prevContent = '';
      for (const ver of versions) {
        let startedAt = toDate(ver.sessionStartedAt) ?? toDate(ver.savedAt) ?? new Date();
        if (isNaN(startedAt.getTime())) startedAt = new Date();

        const verRecord: Record<string, unknown> = { ...ver };
        let verContent = '';
        try {
          const decryptedVer = await maybeDecrypt(verRecord, ['content'], []);
          verContent = typeof decryptedVer.content === 'string' ? decryptedVer.content : (ver.content ?? '');
        } catch (decErr) {
          if (decErr instanceof Error && decErr.message.startsWith('LOCKED')) throw decErr;
          // Skip corrupted version but continue importing others
          verContent = ver.content ?? '';
        }

        await LocalVersionService.addVersion(userId, localId, {
          content: verContent,
          previousContent: prevContent,
          wordCount: ver.wordCount,
          duration: ver.duration,
          wpm: ver.wpm,
          versionNumber: ver.version ?? 1,
          goalWords: ver.goalWords,
          goalTime: ver.goalTime,
          goalReached: ver.goalReached,
          sessionStartedAt: startedAt,
          savedAt: ver.savedAt ? toDate(ver.savedAt) ?? undefined : undefined,
        });
        prevContent = verContent;
      }
```

**Стало** (заменить целиком на это):

```ts
      let prevContent = '';
      // Versions whose ciphertext could not be turned back into text. The local
      // store holds PLAINTEXT, so a failed decrypt must never be written to it:
      // `ver.content` is Base64 ciphertext, and saving it made the note read as
      // gibberish that the app cannot tell from real writing — it would reach
      // search, export, backups and the AI context.
      const corruptedVersions: number[] = [];
      const latestVersionNo = versions.reduce((max, v) => Math.max(max, v.version ?? 1), 0);

      for (const ver of versions) {
        let startedAt = toDate(ver.sessionStartedAt) ?? toDate(ver.savedAt) ?? new Date();
        if (isNaN(startedAt.getTime())) startedAt = new Date();

        const verRecord: Record<string, unknown> = { ...ver };
        let verContent: string | null = null;
        try {
          const decryptedVer = await maybeDecrypt(verRecord, ['content'], []);
          // A non-string here means the payload is not what we think it is —
          // treated as corrupt rather than falling back to the raw field.
          verContent = typeof decryptedVer.content === 'string' ? decryptedVer.content : null;
        } catch (decErr) {
          if (decErr instanceof Error && decErr.message.startsWith('LOCKED')) throw decErr;
          if (!(decErr instanceof DecryptionError)) throw decErr;
          verContent = null;
        }

        if (verContent === null) {
          corruptedVersions.push(ver.version ?? 1);
          continue;
        }

        await LocalVersionService.addVersion(userId, localId, {
          content: verContent,
          previousContent: prevContent,
          wordCount: ver.wordCount,
          duration: ver.duration,
          wpm: ver.wpm,
          versionNumber: ver.version ?? 1,
          goalWords: ver.goalWords,
          goalTime: ver.goalTime,
          goalReached: ver.goalReached,
          sessionStartedAt: startedAt,
          savedAt: ver.savedAt ? toDate(ver.savedAt) ?? undefined : undefined,
        });
        prevContent = verContent;
      }

      // The newest version is what the note IS. If it could not be read, importing
      // the rest would show older text as if it were current — worse than not
      // having the note here at all, because nothing tells the user. The catch
      // below deletes the half-built local document and rethrows.
      if (corruptedVersions.includes(latestVersionNo)) {
        throw new Error(`DECRYPT_FAILED_LATEST: cloud document ${cloudDocumentId} version ${latestVersionNo}`);
      }

      if (corruptedVersions.length > 0) {
        reportError(
          new Error(`Skipped ${corruptedVersions.length} unreadable version(s) while importing a note`),
          { action: 'addLocalCopy_corruptedVersions', cloudDocumentId, versions: corruptedVersions.join(',') },
          'warning',
        );
        useActivityLogStore.getState().addActivity(
          `Часть истории заметки не читается и пропущена (версий: ${corruptedVersions.length})`,
          { action: 'addLocalCopy_corruptedVersions', cloudDocumentId },
          'warning',
          'sync',
        );
      }
```

**Ничего больше в этом файле не трогать.** В частности, не трогай `addCloudCopy` — там
на днях менялась семантика неполной выгрузки (`incomplete`, `highestContiguousVersion`),
и параллельные правки конфликтуют.

---

## Тест

Создать файл `src/core/services/__tests__/addLocalCopyDecrypt.test.ts` **ровно с таким
содержимым**:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { CloudSyncService } from '../CloudSyncService';
import { DocumentService } from '../DocumentService';
import { VersionService } from '../VersionService';
import { LocalStorageService } from '../LocalStorageService';
import { LocalVersionService } from '../LocalVersionService';
import * as CryptoHelpers from '../../crypto/cryptoHelpers';

vi.mock('../../firebase/firestore', () => ({ isFirestoreConnected: true }));

const CIPHERTEXT = 'k7Hs9x2fQ0aZ==';

const cloudVersion = (v: number) => ({
  id: `v${v}`, version: v, content: CIPHERTEXT, wordCount: 1,
  duration: 0, wpm: 0, savedAt: 1, sessionStartedAt: 1, _encrypted: true,
});

// The local store holds plaintext. Writing `ver.content` after a failed decrypt
// put Base64 ciphertext there, and the note became gibberish the app could not
// tell from real writing.
describe('addLocalCopy — a failed decrypt never becomes local text', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(LocalStorageService, 'getGuestDocuments').mockResolvedValue([]);
    vi.spyOn(LocalStorageService, 'createDocument').mockResolvedValue('local_new');
    vi.spyOn(LocalStorageService, 'updateDocument').mockResolvedValue(undefined as never);
    vi.spyOn(LocalStorageService, 'updateLinkedCloudId').mockResolvedValue(undefined);
    vi.spyOn(LocalStorageService, 'deleteDocument').mockResolvedValue(undefined as never);
    vi.spyOn(DocumentService, 'getDocument').mockResolvedValue({
      id: 'cloud_1', title: 'n', tags: [], totalWords: 1, totalDuration: 0,
      currentVersion: 2, sessionsCount: 1, firstSessionAt: new Date(1), lastSessionAt: new Date(2),
    } as never);
  });

  afterEach(() => vi.restoreAllMocks());

  it('skips an unreadable older version instead of storing its ciphertext', async () => {
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue([cloudVersion(1), cloudVersion(2)] as never);
    vi.spyOn(CryptoHelpers, 'maybeDecrypt').mockImplementation(async (doc) => {
      if ((doc as { version?: number }).version === 1) throw new CryptoHelpers.DecryptionError('content');
      return { ...(doc as object), content: 'настоящий текст' } as never;
    });
    const addVersion = vi.spyOn(LocalVersionService, 'addVersion').mockResolvedValue(undefined as never);

    await CloudSyncService.addLocalCopy('user_1', 'cloud_1');

    expect(addVersion).toHaveBeenCalledTimes(1);
    const written = addVersion.mock.calls.map(c => (c[2] as { content: string }).content);
    expect(written).toEqual(['настоящий текст']);
    expect(written.join()).not.toContain(CIPHERTEXT);
  });

  it('aborts the whole import when the NEWEST version cannot be read', async () => {
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue([cloudVersion(1), cloudVersion(2)] as never);
    vi.spyOn(CryptoHelpers, 'maybeDecrypt').mockImplementation(async (doc) => {
      if ((doc as { version?: number }).version === 2) throw new CryptoHelpers.DecryptionError('content');
      return { ...(doc as object), content: 'старый текст' } as never;
    });
    vi.spyOn(LocalVersionService, 'addVersion').mockResolvedValue(undefined as never);
    const removePartial = vi.spyOn(LocalStorageService, 'deleteDocument').mockResolvedValue(undefined as never);

    await expect(CloudSyncService.addLocalCopy('user_1', 'cloud_1')).rejects.toThrow(/DECRYPT_FAILED_LATEST/);
    // The half-built local note must not stay behind showing older text as current.
    expect(removePartial).toHaveBeenCalledWith('local_new');
  });

  it('treats a non-string payload as corrupt rather than falling back to the raw field', async () => {
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue([cloudVersion(1)] as never);
    vi.spyOn(CryptoHelpers, 'maybeDecrypt').mockResolvedValue({ content: { not: 'a string' } } as never);
    vi.spyOn(LocalVersionService, 'addVersion').mockResolvedValue(undefined as never);

    await expect(CloudSyncService.addLocalCopy('user_1', 'cloud_1')).rejects.toThrow(/DECRYPT_FAILED_LATEST/);
  });

  it('still rethrows LOCKED untouched — a locked vault is not corruption', async () => {
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue([cloudVersion(1)] as never);
    vi.spyOn(CryptoHelpers, 'maybeDecrypt').mockRejectedValue(new Error('LOCKED: session key not available'));
    vi.spyOn(LocalVersionService, 'addVersion').mockResolvedValue(undefined as never);

    await expect(CloudSyncService.addLocalCopy('user_1', 'cloud_1')).rejects.toThrow(/LOCKED/);
  });
});
```

### Обязательная проверка невакуумности

Верни `catch`-блок к прежнему виду (`verContent = ver.content ?? '';`), убедись, что
падают именно первый и третий тесты, и верни правку обратно. **Не используй для отката
`git checkout <файл>`** — в файле есть другие несохранённые изменения, и он их снесёт;
правь текстом.

---

## Проверки перед отчётом

```bash
npx tsc --noEmit
npx vitest run
npm run lint          # именно так, не `npx eslint <файлы>` — см. ниже
cd functions && npx tsc --noEmit && npx vitest run
npm run build
```

**Про линт отдельно.** `npm run lint` запускается с `--max-warnings 0`. Прогон по
отдельным файлам (`npx eslint src/...`) этого флага не несёт и пропускает
предупреждения, на которых CI падает. Ровно так на прошлой неделе в `main` уехала
красная сборка из-за одной неиспользуемой переменной. Заканчивай репозиторным скриптом.

В отчёт приложи вывод `tsc`, `lint`, обоих прогонов тестов и результат проверки
невакуумности.

## Границы

- Меняются **два** файла: `CloudSyncService.ts` (импорт + один блок в `addLocalCopy`) и
  новый файл теста. Больше ничего.
- Не трогать `addCloudCopy`, `relinkOrphaned`, `restoreMissingDocuments`, обрезку версий
  и логику бюджета записи.
- Не менять `LocalVersionService`, `cryptoHelpers` и формат локального хранилища.
- Не поднимать версию приложения и не править `CHANGELOG.md` — это сделаю я при релизе.
