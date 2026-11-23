import { getLocalDb } from '../../../core/storage/localDb';
import type { AIDocumentSummary, AITimelineEntry } from '../../../core/storage/localDb';
import { getCurrentUser } from '../../../core/auth';
import { DataProvider } from '../../../core/data';
import { maybeEncrypt, maybeDecrypt } from '../../../core/crypto/cryptoHelpers';
import { reportError } from '../../../shared/errors/reportError';
import { LocalStoreSyncService } from '../../../core/services/LocalStoreSyncService';
import { cloudSyncEnabled } from '../../../core/sync/cloudSyncEnabled';
import { localDayKey, localMonthKey } from '../../../core/utils/dateUtils';
import { canonicalDocumentId } from '../utils/canonicalDocumentId';
import { canUploadDerivatives, LOCAL_ONLY_DOCUMENT } from './derivativeUpload';
import { isExcludedFromAI } from '../utils/isExcludedFromAI';

// summary стоит первым не случайно: это пересказ заметки своими словами —
// «автор размышляет о разводе и долгах» — то есть её суть в сжатом виде. Он не
// входил в список и уезжал в облако открытым текстом, пока всё остальное
// шифровалось. Добавляя сюда поле, проверь, что оно не окажется единственным
// читаемым среди зашифрованных соседей.
// contentHash (R3-4): SHA-256 полного текста заметки. Открытым он даёт серверу
// проверку догадки «совпадает ли текст» и связку одинаковых заметок.
// echo (MB-5): больше не пишется и не читается, но в старых локальных сводках
// лежит — из списка не убирать, иначе при выгрузке уйдёт открытым текстом.
const STRING_FIELDS = ['summary', 'tone', 'echo', 'eventDate', 'quotableSentence', 'contentHash'] as const;
const ARRAY_FIELDS = ['frequentWords', 'authorPhrases', 'insights', 'themes', 'extractedFacts', 'commitments'] as const;
const STRING_FIELDS_LIST: string[] = [...STRING_FIELDS];
const ARRAY_FIELDS_LIST: string[] = [...ARRAY_FIELDS];

/**
 * Единственная точка выгрузки сводки в облако — и запись при разборе, и ручной
 * проход выгрузки идут через неё.
 *
 * Политика доступа в базе требует ПОСТОЯННЫЙ номер заметки:
 *   exists (select 1 from documents d where d.uuid = document_id and d.user_id = auth.uid())
 * Локальный `documentId` ей не подходит: строка отклоняется, а `.catch` наверху
 * только пишет в журнал, повтора нет ни на одном пути — сводка остаётся жить
 * ровно в одном браузере. Ровно эта ошибка была починена для векторов в 0.8.22
 * и только для них: сводки ходят своей дорогой и остались с локальным номером.
 */
export async function saveSummaryToCloud(userId: string, summary: AIDocumentSummary): Promise<void> {
  // Заметку читаем всегда: снятую с облака выгружать нельзя, даже если номер
  // у сводки уже есть.
  const db = await getLocalDb(userId);
  const docId = summary.documentId || (summary as unknown as { id?: string }).id;
  const doc = docId ? await db.get('documents', docId) : undefined;
  if (!canUploadDerivatives(doc)) throw new Error(`${LOCAL_ONLY_DOCUMENT}:${docId}`);
  // Старые строки писались до появления documentUuid — постоянный номер
  // берём у самой заметки и запоминаем, чтобы следующий проход не искал заново.
  if (!summary.documentUuid && doc?.uuid) await db.put('aiSummaries', { ...summary, documentUuid: doc.uuid });
  const canonicalId = canonicalDocumentId(summary, doc);
  if (!canonicalId) {
    // Постоянного номера нет ни у сводки, ни у заметки: выгружать под локальным
    // бессмысленно — база всё равно откажет. Отказ громкий, чтобы проход
    // выгрузки посчитал это неудачей, а не тихо отчитался успехом.
    throw new Error(`NO_CANONICAL_ID:${summary.documentId || (summary as unknown as { id?: string }).id}`);
  }

  const encrypted = await maybeEncrypt(
    { ...summary, documentUuid: canonicalId },
    STRING_FIELDS_LIST,
    ARRAY_FIELDS_LIST,
    userId,
  );
  await DataProvider.saveSummary(userId, canonicalId, encrypted);
}

/**
 * Decodes one cloud summary payload. Exported so the bulk restore decodes with
 * exactly this logic instead of growing a second parser that drifts from it.
 */
export async function decodeCloudSummary(
  data: Record<string, unknown>,
  documentId: string,
): Promise<AIDocumentSummary> {
  const decrypted = await maybeDecrypt(data, STRING_FIELDS_LIST, ARRAY_FIELDS_LIST);
  const docId = typeof decrypted.documentId === 'string' ? decrypted.documentId : documentId;
  const tone = typeof decrypted.tone === 'string' ? decrypted.tone : '';
  const frequentWords = Array.isArray(decrypted.frequentWords) ? decrypted.frequentWords.map(String) : [];
  const authorPhrases = Array.isArray(decrypted.authorPhrases) ? decrypted.authorPhrases.map(String) : undefined;
  const insights = Array.isArray(decrypted.insights) ? decrypted.insights.map(String) : [];
  const themes = Array.isArray(decrypted.themes) ? decrypted.themes.map(String) : [];
  const extractedFacts = Array.isArray(decrypted.extractedFacts) ? decrypted.extractedFacts.map(String) : [];
  const commitments = Array.isArray(decrypted.commitments) ? decrypted.commitments.map(String) : [];
  const processedAt = typeof decrypted.processedAt === 'number' ? decrypted.processedAt : 0;
  const valence = typeof decrypted.valence === 'number' ? decrypted.valence : undefined;
  const arousal = typeof decrypted.arousal === 'number' ? decrypted.arousal : undefined;

  const result: AIDocumentSummary = {
    documentId: docId,
    tone,
    frequentWords,
    insights,
    themes,
    extractedFacts,
    processedAt,
  };
  if (typeof decrypted.summary === 'string') result.summary = decrypted.summary;
  if (authorPhrases) result.authorPhrases = authorPhrases;
  if (typeof decrypted.quotableSentence === 'string') result.quotableSentence = decrypted.quotableSentence;
  if (typeof decrypted.promptVersion === 'number') result.promptVersion = decrypted.promptVersion;
  if (commitments.length > 0) result.commitments = commitments;
  if (valence !== undefined) result.valence = valence;
  if (arousal !== undefined) result.arousal = arousal;
  if (typeof decrypted.eventDate === 'string') result.eventDate = decrypted.eventDate;
  const hash = decrypted.contentHash;
  if (typeof hash === 'string') result.contentHash = hash;
  // Круг замыкается здесь: сводка, восстановленная на другом устройстве, знает
  // каноничный id своей заметки и не подбирается по хешу текста.
  if (typeof decrypted.documentUuid === 'string') result.documentUuid = decrypted.documentUuid;
  return result;
}

async function fetchSummaryFromCloud(userId: string, documentId: string): Promise<AIDocumentSummary | undefined> {
  const data = await DataProvider.getSummary(userId, documentId);
  if (!data) return undefined;
  return decodeCloudSummary(data as Record<string, unknown>, documentId);
}

export const AISummaryService = {
  async get(documentId: string): Promise<AIDocumentSummary | undefined> {
    const db = await getLocalDb();
    const local = await db.get('aiSummaries', documentId);
    if (local) return local;

    const uid = getCurrentUser()?.uid;
    if (uid) {
      try {
        const cloud = await fetchSummaryFromCloud(uid, documentId);
        if (cloud) {
          await db.put('aiSummaries', cloud);
          return cloud;
        }
      } catch (e) {
        reportError(e, { action: 'ai_summary_cloud_fetch', documentId });
        // NB-3: «облако не ответило» — не «разбора нет»: вызывающий обязан
        // показать отказ чтения, а не кнопку «Разобрать» (трата ИИ повторно).
        throw e;
      }
    }
    return undefined;
  },

  async save(summary: AIDocumentSummary): Promise<'saved' | 'skipped'> {
    const db = await getLocalDb();
    const tx = db.transaction(['documents', 'aiSummaries', 'aiTimeline'], 'readwrite');
    const doc = await tx.objectStore('documents').get(summary.documentId);
    if (!doc || isExcludedFromAI(doc)) {
      await tx.done;
      // NB-17 №8: пропуск назван — вызывающий не ставит aiProcessed и не зеленеет.
      return 'skipped';
    }
    const withUuid = doc.uuid ? { ...summary, documentUuid: doc.uuid } : summary;
    await tx.objectStore('aiSummaries').put(withUuid);
    if (doc?.lastSessionAt) {
      const d = new Date(doc.lastSessionAt);
      if (!isNaN(d.getTime())) {
        const dateStr = localDayKey(d);
        const monthStr = localMonthKey(d);

        // Save to Timeline
        const timelineEntry: AITimelineEntry = {
          documentId: summary.documentId,
          date: dateStr,
          month: monthStr,
          facts: summary.extractedFacts ?? [],
          tone: summary.tone,
          themes: summary.themes ?? [],
          insights: summary.insights ?? [],
          eventDate: summary.eventDate ?? dateStr,
        };
        if (summary.summary !== undefined) {
          timelineEntry.summary = summary.summary;
        }
        if (summary.valence !== undefined) {
          timelineEntry.valence = summary.valence;
        }
        if (summary.arousal !== undefined) {
          timelineEntry.arousal = summary.arousal;
        }
        await tx.objectStore('aiTimeline').put(timelineEntry);
        await tx.done;
        LocalStoreSyncService.scheduleStoreSync('aiTimeline', timelineEntry.documentId);

        // Очередь тем больше не наполняется: разбирал её фоновый проход, а он
        // убран — заметки обрабатываются только по нажатию. Реестр тем,
        // портрет, грани и дайджесты ждут отдельной кнопки пересчёта (D4.24).

        // Upsert commitments

        if (summary.commitments && summary.commitments.length > 0) {
          try {
            const { AICommitmentService } = await import('./AICommitmentService');
            await AICommitmentService.upsertCommitments(summary.documentId, summary.commitments, dateStr);
          } catch (e) {
            console.warn('[AISummaryService] Failed to upsert commitments:', e);
          }
        }

      }
    }

    await tx.done;
    const fresh = await db.get('documents', summary.documentId);
    if (!fresh || isExcludedFromAI(fresh)) return 'saved';
    const uid = getCurrentUser()?.uid;
    // SEC-8: Background write-time upload respects cloudSyncEnabled switch
    if (uid && cloudSyncEnabled(uid)) {
      await saveSummaryToCloud(uid, withUuid).catch(e => {
        // Заметка снята с облака — сводка остаётся здесь, это не сбой.
        if (e instanceof Error && e.message.startsWith(LOCAL_ONLY_DOCUMENT)) return;
        reportError(e, { action: 'ai_summary_cloud_save' });
      });
    }
    return 'saved';
  },

  async delete(documentId: string): Promise<void> {
    const db = await getLocalDb();
    await db.delete('aiSummaries', documentId);
    await db.delete('aiTimeline', documentId);
    LocalStoreSyncService.scheduleStoreDelete('aiTimeline', documentId);
  },

  async hasAll(): Promise<Record<string, boolean>> {
    const db = await getLocalDb();
    const all = await db.getAll('aiSummaries');
    const map: Record<string, boolean> = {};
    for (const s of all) {
      map[s.documentId] = true;
    }
    return map;
  },
};
