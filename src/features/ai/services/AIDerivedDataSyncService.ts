// src/features/ai/services/AIDerivedDataSyncService.ts
import { getLocalDb } from '../../../core/storage/localDb';
import { DataProvider } from '../../../core/data';
import type { ProviderRecord } from '../../../core/data/types';
import { getEncryptionEnabled } from '../../../core/crypto/cryptoHelpers';
import { getSessionKey } from '../../../core/crypto/encrypt';
import { LocalStoreSyncService, SUPPORTED_LOCAL_STORES, getLocalStoreRecordCounts } from '../../../core/services/LocalStoreSyncService';
import { saveSummaryToCloud } from './AISummaryService';
import { saveEmbeddingToCloud } from './AIEmbeddingService';
import { reportError } from '../../../shared/errors/reportError';
import { canonicalDocumentId } from '../utils/canonicalDocumentId';
import { isExcludedFromAI } from '../utils/isExcludedFromAI';
import { canUploadDerivatives, LOCAL_ONLY_DOCUMENT } from './derivativeUpload';

export interface DerivedSyncProgress {
  phase: 'summaries' | 'embeddings' | 'stores';
  current: number;
  total: number;
}

/** Производные, за которыми не стоит заметки ни на устройстве, ни в облаке. */
export interface OrphanSurvey {
  summaries: string[];
  embeddings: string[];
  /** false — облако недоступно, и вывод о сиротстве делать нельзя. */
  cloudChecked: boolean;
}

export interface DerivedSyncResult {
  /** `orphaned` — разборы, за которыми не стоит заметки: отправлять нечего. */
  summaries: { synced: number; failed: number; orphaned: number };
  embeddings: { synced: number; failed: number; orphaned: number };
  stores: { synced: number; failed: number; skippedOversized: number };
  totalSynced: number;
  totalFailed: number;
  skippedLocked: boolean;
}

/** Одно семейство в сверке. `null` — не удалось посчитать; это не ноль. */
export interface DriftFamily {
  /** Записи на устройстве, которые выгрузка примет. */
  local: number | null;
  cloud: number | null;
}

export interface DerivedDrift {
  /** Заметки, доступные ИИ: с чем сравнивать число векторов. */
  notes: number | null;
  /** `orphaned` — без заметки, отправке не подлежат. */
  summaries: DriftFamily & { orphaned: number | null };
  /** `oversized` — не влезли в строку облака и там не появятся. */
  embeddings: DriftFamily & { orphaned: number | null; oversized: number | null };
  stores: DriftFamily;
}

export const AIDerivedDataSyncService = {
  /**
   * Syncs all local summaries to cloud storage.
   * Explicit manual / backfill pass: exempt from auto_sync_enabled toggle.
   */
  async syncAllSummaries(
    userId: string,
    onProgress?: (current: number, total: number) => void
  ): Promise<{ synced: number; failed: number; orphaned: number; skippedLocked: boolean }> {
    if (!userId) return { synced: 0, failed: 0, orphaned: 0, skippedLocked: false };
    if (getEncryptionEnabled(userId) && !getSessionKey()) {
      return { synced: 0, failed: 0, orphaned: 0, skippedLocked: true };
    }

    const db = await getLocalDb(userId);
    const summaries = await db.getAll('aiSummaries');
    let synced = 0;
    let failed = 0;
    let orphaned = 0;

    for (let i = 0; i < summaries.length; i++) {
      const summary = summaries[i]!;
      onProgress?.(i + 1, summaries.length);
      try {
        await saveSummaryToCloud(userId, summary);
        synced++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('ENCRYPT_REQUIRED') || msg.includes('LOCKED')) {
          return { synced, failed, orphaned, skippedLocked: true };
        }
        // За разбором не стоит заметки: её удалили, а разбор остался. Отправлять
        // нечего — политика доступа такую строку и не примет, — но это пропуск,
        // а не сбой: сыпать красным в журнал и пугать человека тут не за что.
        if (msg.startsWith('NO_CANONICAL_ID')) {
          orphaned++;
          continue;
        }
        // Заметка снята с облака — разбор остаётся на устройстве по её выбору.
        if (msg.startsWith(LOCAL_ONLY_DOCUMENT)) continue;
        failed++;
        reportError(err, { action: 'syncAllSummaries_doc', docId: summary.documentId });
      }
    }

    return { synced, failed, orphaned, skippedLocked: false };
  },

  /**
   * Syncs all local vector embeddings to cloud storage.
   * Explicit manual / backfill pass: exempt from auto_sync_enabled toggle.
   */
  async syncAllEmbeddings(
    userId: string,
    onProgress?: (current: number, total: number) => void
  ): Promise<{ synced: number; failed: number; orphaned: number; skippedLocked: boolean }> {
    if (!userId) return { synced: 0, failed: 0, orphaned: 0, skippedLocked: false };
    if (getEncryptionEnabled(userId) && !getSessionKey()) {
      return { synced: 0, failed: 0, orphaned: 0, skippedLocked: true };
    }

    const db = await getLocalDb(userId);
    const embeddings = await db.getAll('aiEmbeddings');
    let synced = 0;
    let failed = 0;
    let orphaned = 0;

    for (let i = 0; i < embeddings.length; i++) {
      const emb = embeddings[i]!;
      onProgress?.(i + 1, embeddings.length);
      try {
        const { skipped } = await saveEmbeddingToCloud(userId, emb);
        if (skipped) {
          await db.put('aiEmbeddings', { ...emb, cloudSkipped: true });
        } else {
          await db.put('aiEmbeddings', { ...emb, cloudSyncedAt: Date.now() });
          synced++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('ENCRYPT_REQUIRED') || msg.includes('LOCKED')) {
          return { synced, failed, orphaned, skippedLocked: true };
        }
        // За вектором не стоит заметки — тот же случай, что и у разборов:
        // пропуск, а не сбой.
        if (msg.startsWith('NO_CANONICAL_ID')) {
          orphaned++;
          continue;
        }
        if (msg.startsWith(LOCAL_ONLY_DOCUMENT)) continue;
        failed++;
        reportError(err, { action: 'syncAllEmbeddings_doc', docId: emb.documentId });
      }
    }

    return { synced, failed, orphaned, skippedLocked: false };
  },

  /**
   * Comprehensive derived data upload pass covering all three families:
   * 1. Summaries
   * 2. Embeddings
   * 3. 13 Local Stores
   *
   * Idempotent and resumable. Refuses to upload if vault is locked.
   */
  async syncAllDerivedData(
    userId: string,
    onProgress?: (progress: DerivedSyncProgress) => void
  ): Promise<DerivedSyncResult> {
    const result: DerivedSyncResult = {
      summaries: { synced: 0, failed: 0, orphaned: 0 },
      embeddings: { synced: 0, failed: 0, orphaned: 0 },
      stores: { synced: 0, failed: 0, skippedOversized: 0 },
      totalSynced: 0,
      totalFailed: 0,
      skippedLocked: false,
    };

    // Итоги считаются на каждом выходе, а не только на удачном. Иначе проход,
    // прерванный на середине, возвращает «отправлено 0» при сорока уехавших
    // сводках — то есть сделанную работу человек не видит и делает её заново.
    const finish = (): DerivedSyncResult => {
      result.totalSynced = result.summaries.synced + result.embeddings.synced + result.stores.synced;
      result.totalFailed = result.summaries.failed + result.embeddings.failed + result.stores.failed;
      return result;
    };

    if (!userId) return finish();

    if (getEncryptionEnabled(userId) && !getSessionKey()) {
      result.skippedLocked = true;
      return finish();
    }

    // 1. Sync summaries
    const summariesRes = await this.syncAllSummaries(userId, (cur, tot) => {
      onProgress?.({ phase: 'summaries', current: cur, total: tot });
    });
    result.summaries.synced = summariesRes.synced;
    result.summaries.failed = summariesRes.failed;
    result.summaries.orphaned = summariesRes.orphaned;
    if (summariesRes.skippedLocked) {
      result.skippedLocked = true;
      return finish();
    }

    // 2. Sync embeddings
    const embeddingsRes = await this.syncAllEmbeddings(userId, (cur, tot) => {
      onProgress?.({ phase: 'embeddings', current: cur, total: tot });
    });
    result.embeddings.synced = embeddingsRes.synced;
    result.embeddings.failed = embeddingsRes.failed;
    result.embeddings.orphaned = embeddingsRes.orphaned;
    if (embeddingsRes.skippedLocked) {
      result.skippedLocked = true;
      return finish();
    }

    // 3. Sync 13 local stores
    const storesRes = await LocalStoreSyncService.syncAllLocalStores(userId);
    result.stores.synced = storesRes.synced;
    result.stores.failed = storesRes.failed;
    result.stores.skippedOversized = storesRes.skippedOversized;
    if (storesRes.skippedLocked) {
      result.skippedLocked = true;
      return finish();
    }

    return finish();
  },

  /**
   * Разборы и векторы, за которыми не стоит заметки — ни на устройстве, ни в
   * облаке.
   *
   * Такие остаются после удаления заметки по старой логике: она сносила
   * локальные производные, но облачные копии и часть локальных семейств не
   * трогала. Отправить их нельзя (политика доступа требует заметку), и лежат
   * они мёртвым грузом.
   *
   * ОБЛАЧНАЯ СВЕРКА ОБЯЗАТЕЛЬНА, и это главное здесь. «Заметки нет на
   * устройстве» и «заметки нет вообще» — разные вещи: на втором устройстве
   * локально лежит часть архива, и уборка по одному локальному признаку снесла
   * бы разборы живых заметок. Если облако недоступно, проход не возвращает
   * ничего: лучше не убрать, чем убрать лишнее.
   */
  async findOrphanedDerivatives(userId: string): Promise<OrphanSurvey> {
    const empty: OrphanSurvey = { summaries: [], embeddings: [], cloudChecked: false };
    if (!userId || userId.startsWith('guest_')) return empty;

    let cloudUuids: Set<string>;
    try {
      const cloudDocs = await DataProvider.getUserDocuments(userId);
      cloudUuids = new Set(
        cloudDocs.map((d: ProviderRecord) => String((d as { uuid?: unknown; id?: unknown }).uuid ?? (d as { id?: unknown }).id ?? ''))
          .filter(Boolean),
      );
    } catch (e) {
      reportError(e, { action: 'findOrphanedDerivatives_cloudList' }, 'warning');
      return empty;
    }

    const db = await getLocalDb(userId);
    const documents = await db.getAll('documents');
    const known = new Set<string>(cloudUuids);
    for (const doc of documents) {
      known.add(doc.id);
      if (doc.uuid) known.add(doc.uuid);
    }

    const isOrphan = (r: { documentId: string; documentUuid?: string | undefined }): boolean =>
      !known.has(r.documentId) && !(r.documentUuid !== undefined && known.has(r.documentUuid));

    const summaries = (await db.getAll('aiSummaries')).filter(isOrphan).map(r => r.documentId);
    const embeddings = (await db.getAll('aiEmbeddings')).filter(isOrphan).map(r => r.documentId);

    return { summaries, embeddings, cloudChecked: true };
  },

  /**
   * Убирает найденные сироты с устройства. Облачных копий у них нет по
   * определению — база их и не приняла бы.
   *
   * Опись делается заново, а не берётся готовой: между показом числа человеку и
   * нажатием могла приехать синхронизация, и удалять по устаревшему списку
   * значит удалять то, что уже перестало быть сиротой.
   */
  async deleteOrphanedDerivatives(userId: string): Promise<{ summaries: number; embeddings: number }> {
    const survey = await AIDerivedDataSyncService.findOrphanedDerivatives(userId);
    if (!survey.cloudChecked) return { summaries: 0, embeddings: 0 };

    const db = await getLocalDb(userId);
    let summaries = 0;
    let embeddings = 0;
    for (const id of survey.summaries) {
      try { await db.delete('aiSummaries', id); summaries++; } catch { /* намеренно: считаем только удалённое; остаток найдёт следующий проход */ }
    }
    for (const id of survey.embeddings) {
      try { await db.delete('aiEmbeddings', id); embeddings++; } catch { /* намеренно: как выше */ }
    }
    return { summaries, embeddings };
  },

  /**
   * Сверка «на устройстве / в облаке» по трём семействам производных (drift-1).
   *
   * На устройстве считаются только ОТПРАВЛЯЕМЫЕ записи — тем же правилом, что
   * и выгрузка (`canonicalDocumentId`). Разбор удалённой заметки отправить
   * нельзя, и, посчитай мы его, панель вечно показывала бы расхождение, которое
   * нечем закрыть, — такую панель перестают читать. Сироты идут своим числом.
   *
   * `null` везде значит «не удалось посчитать», а не ноль (K-4/N-85): ноль
   * интерфейс читает как «данных нет». Каждое чтение отказывает отдельно —
   * недоступное облако не прячет числа устройства, и наоборот.
   *
   * Только по явному действию человека, не по таймеру: опрос на таймере уже
   * однажды выбрал дневную квоту чтений.
   */
  async getDerivedDrift(userId: string): Promise<DerivedDrift> {
    const orNull = async (action: string, read: () => Promise<number>): Promise<number | null> => {
      try {
        return await read();
      } catch (e) {
        reportError(e, { action }, 'warning');
        return null;
      }
    };

    const readLocal = async () => {
      try {
        const db = await getLocalDb(userId);
        // ponytail: getAll тянет векторы целиком (десятки МБ на больших архивах);
        // если станет заметно — курсор по записям без удержания массива.
        const [documents, summaries, embeddings] = await Promise.all([
          db.getAll('documents'), db.getAll('aiSummaries'), db.getAll('aiEmbeddings'),
        ]);
        const docById = new Map(documents.map(d => [d.id, d]));
        type Rec = { documentId: string; documentUuid?: string | undefined };
        const orphan = (r: Rec) => canonicalDocumentId(r, docById.get(r.documentId)) === null;
        // Производные заметок, снятых с облака, выгрузка пропускает — и здесь
        // они не отправляемые и не сироты, а просто местные.
        const sendable = (r: Rec) => !orphan(r) && canUploadDerivatives(docById.get(r.documentId));

        const sendableSummaries = summaries.filter(sendable).length;
        const sendableEmbeddings = embeddings.filter(sendable);
        // Вектор, не влезший в строку облака, там и не появится — это не сбой.
        const oversized = sendableEmbeddings.filter(e => e.cloudSkipped).length;
        return {
          notes: documents.filter(d => !isExcludedFromAI(d)).length,
          summaries: { local: sendableSummaries, orphaned: summaries.filter(orphan).length },
          embeddings: {
            local: sendableEmbeddings.length - oversized,
            orphaned: embeddings.filter(orphan).length,
            oversized,
          },
        };
      } catch (e) {
        reportError(e, { action: 'getDerivedDrift_local' }, 'warning');
        return {
          notes: null,
          summaries: { local: null, orphaned: null },
          embeddings: { local: null, orphaned: null, oversized: null },
        };
      }
    };

    const [local, localStores, cloudSummaries, cloudEmbeddings, cloudStores] = await Promise.all([
      readLocal(),
      // Свой reportError внутри: отказ чтения возвращается как null.
      getLocalStoreRecordCounts(),
      orNull('getDerivedDrift_cloudSummaries', () => DataProvider.countSummaries(userId)),
      orNull('getDerivedDrift_cloudEmbeddings', () => DataProvider.countEmbeddings(userId)),
      orNull('getDerivedDrift_cloudStores', () => DataProvider.countLocalStoreRecords(userId, SUPPORTED_LOCAL_STORES)),
    ]);

    return {
      notes: local.notes,
      summaries: { ...local.summaries, cloud: cloudSummaries },
      embeddings: { ...local.embeddings, cloud: cloudEmbeddings },
      stores: { local: localStores, cloud: cloudStores },
    };
  },
};
