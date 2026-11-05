// DW6-5.3 (находка ревью 0.11.6): облачная половина сверяла эпоху ДО ожидания
// очереди строки. `rememberCloudSend` — это `queueDraftRowWrite`, то есть точка,
// где запись может простоять сколько угодно; пока она ждала, заметку сохраняли
// (эпоха поднята, черновик закрыт), а нагрузка всё равно уходила в облако —
// поверх закрытого черновика. Между освобождением очереди и отправкой нужна та же
// сверка, что и перед ней.
//
// Мутации: убрать `isEpochStale` между `rememberCloudSend` и `DataProvider.saveDraft`
// — краснеет кейс 1; вернуть его в начало функции (то есть сверять один раз) —
// краснеет кейс 2.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocalDb, resetDbInstance, type LocalDraft } from '../../../../core/storage/localDb';
import { applySave, getDraftGeneration, queueDraftRowWrite } from '../draftWriter';
import { WritingDraftService } from '../WritingDraftService';

vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));
vi.mock('../../../../core/crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => false,
  maybeEncrypt: async (d: Record<string, unknown>) => d,
  maybeDecrypt: async (d: Record<string, unknown>) => d,
  isProfileLoaded: () => true,
}));
const reportError = vi.hoisted(() => vi.fn());
vi.mock('../../../../shared/errors/reportError', () => ({ reportError }));

const sends = vi.hoisted(() => [] as string[]);
vi.mock('../../../../core/data', () => ({
  DataProvider: {
    getDraft: async () => null,
    saveDraft: async (_uid: string, payload: Record<string, unknown>) => {
      sends.push(String(payload.content));
      return null;
    },
    updateDraft: async () => {},
    deleteDraft: async () => {},
  },
}));

const UID = 'u_dw653';
const T0 = 1_800_000_000_000;

function draft(content: string): LocalDraft {
  return {
    userId: UID, owner: UID, content, title: '', seconds: 10, wpm: 20, wordCount: 3,
    pinnedThoughts: [], tags: [], activeSessionId: null, savedDocumentId: null,
    sessionStartTime: null, updatedAt: T0,
  } as unknown as LocalDraft;
}

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  resetDbInstance();
  vi.clearAllMocks();
  sends.length = 0;
  const db = await getLocalDb(UID);
  await db.put('drafts', draft('СТРОКА_DW653'));
});

describe('DW6-5.3: облачная отправка сверяет эпоху после ожидания очереди', () => {
  it('очередь держали, черновик закрыли в это время — в облако ничего не ушло', async () => {
    let release!: () => void;
    const hold = new Promise<void>(resolveHold => { release = resolveHold; });
    void queueDraftRowWrite(() => hold);
    const epoch = getDraftGeneration(UID);

    const pending = WritingDraftService.saveDraftToCloud(draft('ОТПРАВКА_DW653'), epoch);
    await new Promise(r => { setTimeout(r, 20); }); // писатель стоит в очереди строки
    applySave(UID);                                 // сохранение заметки подняло эпоху
    release();

    const ok = await pending;
    expect(sends, 'опоздавшая нагрузка ушла в облако поверх закрытого черновика').toEqual([]);
    expect(ok).toBe(false);
  });

  it('очередь отдала строку, эпоха та же — отправка проходит как раньше', async () => {
    const epoch = getDraftGeneration(UID);

    const ok = await WritingDraftService.saveDraftToCloud(draft('ОТПРАВКА_2_DW653'), epoch);

    expect(ok).toBe(true);
    expect(sends).toEqual(['ОТПРАВКА_2_DW653']);
  });
});
