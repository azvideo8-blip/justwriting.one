// DW5-3 (находки ревью кода 0.11.5, билет DW-5 §DW5-3). Пункты 3 и 4.1 — оба
// про то, что правило эпохи и правило владельца обязаны действовать в той точке,
// где запись реально ложится в адрес.
//
// 3. `applyWrite` сверял эпоху ДО входа в очередь строки (`draftWriter.ts:284`
//    → `:291`), а `deleteDraftLocalPart` и `clearGuestDraft` удаляют адрес мимо
//    очереди. Запись, вставшая в очередь до подъёма, возвращает удалённую строку:
//    «Сохранить» поднял эпоху и стёр черновик, а очередь дописала старый текст.
// 4.1 Облачная половина (`saveDraftToCloud`) не сверяла владельца: запись с
//    чужим `owner` уезжала в облачную строку адресата (I3 на облаке).
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocalDb, resetDbInstance, type LocalDraft } from '../../../../core/storage/localDb';
import { WritingDraftService } from '../WritingDraftService';
import { applySave, applyWrite, getDraftGeneration, queueDraftRowWrite } from '../draftWriter';

vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));
vi.mock('../../../../core/crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => false,
  maybeEncrypt: async (d: Record<string, unknown>) => d,
  maybeDecrypt: async (d: Record<string, unknown>) => d,
  isProfileLoaded: () => true,
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const cloud = vi.hoisted(() => ({ saves: 0, row: null as Record<string, unknown> | null }));
vi.mock('../../../../core/data', () => ({
  DataProvider: {
    getDraft: async () => cloud.row,
    saveDraft: async (uid: string, payload: Record<string, unknown>) => { cloud.saves++; cloud.row = { ...payload, userId: uid }; return null; },
    updateDraft: async () => {},
    deleteDraft: async () => { cloud.row = null; },
  },
}));

const T0 = 1_800_000_000_000;

async function storedRow(uid: string): Promise<Record<string, unknown> | undefined> {
  const db = await getLocalDb(uid);
  return (await db.get('drafts', uid)) as Record<string, unknown> | undefined;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetDbInstance();
  vi.clearAllMocks();
  cloud.saves = 0;
  cloud.row = null;
  Date.now = () => T0 - 60_000;
});

describe('DW5-3.3: сверка эпохи живёт внутри очереди строки', () => {
  it('запись, вставшая в очередь до подъёма эпохи и удаления, не возвращает строку', async () => {
    const uid = 'u_dw53_queue';
    applySave(uid);
    const epochAtEdit = getDraftGeneration(uid);

    // Очередь занята: чужая служебная правка строки ещё не отпустила цепочку.
    let release!: () => void;
    const hold = new Promise<void>(res => { release = res; });
    void queueDraftRowWrite(async () => { await hold; });

    const inFlight = applyWrite(
      { content: 'MARKER_dw53_в_очереди', owner: uid, updatedAt: T0 - 10_000 },
      'edit',
      { uid, epoch: epochAtEdit },
    );
    // Дать записи открыться базе, пройти сверку и встать в очередь: без этого
    // подъём эпохи случился бы до сверки, и тест проверял бы не очередь.
    await new Promise(r => { setTimeout(r, 25); });

    // «Сохранить»: эпоху подняли, черновик удалили — оба мимо очереди.
    applySave(uid);
    const db = await getLocalDb(uid);
    await db.delete('drafts', uid);

    release();
    const outcome = await inFlight;

    expect(outcome, 'опоздавшая запись не была отвергнута').toBe('stale-epoch');
    expect(await storedRow(uid), 'удалённая строка вернулась из очереди').toBeUndefined();
  });
});

describe('DW5-3.4: облачная половина сверяет владельца', () => {
  it('запись с чужим owner в облачный ряд адресата не уезжает', async () => {
    const uid = 'u_dw53_cloud_owner';
    const foreign: LocalDraft = {
      userId: uid,
      owner: 'u_dw53_cloud_A',
      title: '',
      content: 'MARKER_dw53_чужой_текст',
      seconds: 5,
      wpm: 10,
      wordCount: 2,
      updatedAt: T0 - 5_000,
    } as LocalDraft;

    const ok = await WritingDraftService.saveDraftToCloud(foreign, undefined);

    expect(ok, 'облако приняло запись с чужим владельцем').toBe(false);
    expect(cloud.saves, 'чужой текст уехал в облачную строку адресата').toBe(0);
  });

  it('свой владелец и строка без владельца (строки до 0.11.5) проходят как раньше', async () => {
    const uid = 'u_dw53_cloud_own';
    const own: LocalDraft = {
      userId: uid, owner: uid, title: '', content: 'MARKER_dw53_свой', seconds: 5, wpm: 10, wordCount: 2, updatedAt: T0 - 5_000,
    } as LocalDraft;
    expect(await WritingDraftService.saveDraftToCloud(own, undefined)).toBe(true);

    const legacy: LocalDraft = {
      userId: uid, title: '', content: 'MARKER_dw53_без_владельца', seconds: 5, wpm: 10, wordCount: 2, updatedAt: T0 - 4_000,
    } as LocalDraft;
    expect(await WritingDraftService.saveDraftToCloud(legacy, undefined)).toBe(true);
  });
});
