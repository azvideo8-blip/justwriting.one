import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AIDerivedDataSyncService } from '../AIDerivedDataSyncService';
import { getLocalDb } from '../../../../core/storage/localDb';
import { DataProvider } from '../../../../core/data';
import { setEncryptionEnabled, setProfileLoaded } from '../../../../core/crypto/cryptoHelpers';
import { useEncryptionStore } from '../../../../core/crypto/useEncryptionStore';
import * as auth from '../../../../core/auth';

vi.mock('../../../../core/data', () => ({
  DataProvider: {
    saveSummary: vi.fn().mockResolvedValue(undefined),
    saveEmbedding: vi.fn().mockResolvedValue(undefined),
    saveLocalStoreRecord: vi.fn().mockResolvedValue(undefined),
    // S0-1: выгрузка скаляра — условная запись; облако пусто, база null.
    saveLocalStoreRecordIfUnstamped: vi.fn().mockResolvedValue({ written: true, stampedAt: null }),
    getLocalStoreRecord: vi.fn().mockResolvedValue(null),
    deleteLocalStoreRecord: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../../core/auth', () => ({
  getCurrentUser: vi.fn(),
}));

describe('SEC-6: AIDerivedDataSyncService cloud backfill pass', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    setProfileLoaded('user_1', true);
    setEncryptionEnabled('user_1', false);
    useEncryptionStore.getState().setKey(null);
    vi.mocked(auth.getCurrentUser).mockReturnValue({ uid: 'user_1' } as unknown as auth.AppUser);

    const db = await getLocalDb();
    await db.clear('aiSummaries');
    await db.clear('aiEmbeddings');
    await db.clear('aiPortrait');
  });

  it('syncs summaries, embeddings, and local stores when present locally and reports counts', async () => {
    const db = await getLocalDb();
    await db.put('aiSummaries', {
      documentId: 'doc_1',
      documentUuid: 'uuid-doc_1',
      summary: 'Разбор 1',
      tone: 'нейтральный',
      frequentWords: [],
      insights: [],
      themes: [],
      extractedFacts: [],
      processedAt: Date.now(),
    });
    await db.put('aiEmbeddings', {
      documentId: 'doc_1',
      documentUuid: 'uuid-doc_1',
      vectors: [[0.1, 0.2]],
      model: 'm1',
      dim: 2,
      contentHash: 'hash-1',
      processedAt: Date.now(),
    });
    await db.put('aiPortrait', { id: 'p1', portrait: 'Портрет', updatedAt: Date.now(), generatedAtDelta: 0 });

    const result = await AIDerivedDataSyncService.syncAllDerivedData('user_1');

    expect(result.summaries.synced).toBe(1);
    expect(result.embeddings.synced).toBe(1);
    expect(result.stores.synced).toBe(1);
    expect(result.totalSynced).toBe(3);
    expect(result.totalFailed).toBe(0);
    expect(result.skippedLocked).toBe(false);

    expect(DataProvider.saveSummary).toHaveBeenCalledTimes(1);
    expect(DataProvider.saveEmbedding).toHaveBeenCalledTimes(1);
    expect(DataProvider.saveLocalStoreRecordIfUnstamped).toHaveBeenCalledTimes(1);
  });

  it('is idempotent: running twice does not throw and maintains consistency', async () => {
    const db = await getLocalDb();
    await db.put('aiSummaries', {
      documentId: 'doc_1',
      documentUuid: 'uuid-doc_1',
      summary: 'Разбор 1',
      tone: 'нейтральный',
      frequentWords: [],
      insights: [],
      themes: [],
      extractedFacts: [],
      processedAt: Date.now(),
    });

    const res1 = await AIDerivedDataSyncService.syncAllDerivedData('user_1');
    expect(res1.summaries.synced).toBe(1);

    const res2 = await AIDerivedDataSyncService.syncAllDerivedData('user_1');
    expect(res2.summaries.synced).toBe(1);
    expect(res2.totalFailed).toBe(0);
  });

  it('with locked vault, upload pass refuses to upload and reports skippedLocked=true', async () => {
    setEncryptionEnabled('user_1', true);
    useEncryptionStore.getState().setKey(null); // Locked!

    const db = await getLocalDb();
    await db.put('aiSummaries', {
      documentId: 'doc_1',
      documentUuid: 'uuid-doc_1',
      summary: 'Разбор 1',
      tone: 'нейтральный',
      frequentWords: [],
      insights: [],
      themes: [],
      extractedFacts: [],
      processedAt: Date.now(),
    });

    const result = await AIDerivedDataSyncService.syncAllDerivedData('user_1');

    expect(result.skippedLocked).toBe(true);
    expect(result.totalSynced).toBe(0);
    expect(DataProvider.saveSummary).not.toHaveBeenCalled();
    expect(DataProvider.saveEmbedding).not.toHaveBeenCalled();
    expect(DataProvider.saveLocalStoreRecord).not.toHaveBeenCalled();
    expect(DataProvider.saveLocalStoreRecordIfUnstamped).not.toHaveBeenCalled();
  });

  // Проход прерывается на середине штатно: сейф может закрыться по бездействию,
  // пока едут сотни записей. Отчёт «отправлено 0» при уехавших сводках — это не
  // мелкая неточность в цифре, а повод для человека проделать всё заново.
  it('прерванный проход отчитывается о том, что успело уехать', async () => {
    const db = await getLocalDb();
    await db.put('aiSummaries', {
      documentId: 'doc_1',
      documentUuid: 'uuid-doc_1',
      tone: 'спокойный',
      frequentWords: [],
      insights: [],
      themes: [],
      extractedFacts: [],
      processedAt: Date.now(),
    });
    await db.put('aiEmbeddings', {
      documentId: 'doc_2',
      documentUuid: 'uuid-doc_2',
      vectors: [[0.1, 0.2]],
      chunkTexts: ['кусок'],
      model: 'test',
      dim: 2,
      contentHash: 'h',
      processedAt: Date.now(),
    } as never);

    // Сводка уезжает, на векторах сейф закрывается.
    vi.mocked(DataProvider.saveEmbedding).mockRejectedValueOnce(
      new Error('LOCKED: session key not available')
    );

    const result = await AIDerivedDataSyncService.syncAllDerivedData('user_1');

    expect(result.skippedLocked).toBe(true);
    expect(result.summaries.synced).toBe(1);
    expect(result.totalSynced).toBe(1);
  });

  /**
   * Разбор, за которым не стоит заметки (её удалили), отправить нельзя: политика
   * доступа в базе такую строку не примет. Но это пропуск, а не сбой — иначе
   * успешный проход заканчивается пачкой красных ошибок и человек считает, что
   * ничего не выгрузилось.
   */
  it('counts an analysis with no note behind it as skipped, not failed', async () => {
    const db = await getLocalDb();
    await db.put('aiSummaries', {
      documentId: 'uuid-ghost',
      summary: 'Разбор удалённой заметки',
      tone: 'нейтральный',
      frequentWords: [],
      insights: [],
      themes: [],
      extractedFacts: [],
      processedAt: Date.now(),
    });

    const result = await AIDerivedDataSyncService.syncAllDerivedData('user_1');

    expect(result.summaries.orphaned).toBe(1);
    expect(result.summaries.failed).toBe(0);
    expect(result.totalFailed).toBe(0);
    expect(DataProvider.saveSummary).not.toHaveBeenCalled();
  });
});
