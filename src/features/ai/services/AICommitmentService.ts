import { getLocalDb, randomUUID, type AIDocumentEmbedding } from '../../../core/storage/localDb';
import { AIService } from './AIService';
import { cosineSimilarity } from '../utils/vectorSearch';
import { reportError } from '../../../shared/errors/reportError';
import { LocalStoreSyncService } from '../../../core/services/LocalStoreSyncService';
import { getCurrentUser } from '../../../core/auth';
import { hasIndexingConsent } from '../../../core/ai/indexingConsent';
import { isExcludedFromAI } from '../utils/isExcludedFromAI';
import { loadVisibleNoteKeys } from '../utils/retrieval/docSnapshot';


export const AICommitmentService = {
  async upsertCommitments(documentId: string, commitments: string[], dateStr: string): Promise<void> {
    if (commitments.length === 0) return;
    try {
      const db = await getLocalDb();
      const now = Date.now();
      const existing = await db.getAll('aiCommitments');
      const openCommitments = existing.filter(c => c.status === 'open');
      const uid = getCurrentUser()?.uid;
      const canEmbed = uid ? hasIndexingConsent(uid) : false;
      // Ревью AP2: заметку могут скрыть посреди цикла — каждый вызов провайдера
      // и каждая запись идут только после свежей проверки.
      const stillVisible = async () => !isExcludedFromAI(await db.get('documents', documentId));

      for (const text of commitments) {
        if (!text.trim()) continue;
        const trimmed = text.trim();
        if (!(await stillVisible())) return;

        // Get embedding for duplicate checking only if indexing consent is granted
        const embResult = canEmbed ? await AIService.embed({ content: trimmed }) : null;
        const vector = embResult?.ok && embResult.vectors[0] ? embResult.vectors[0] : undefined;

        let isDuplicate = false;
        if (vector) {
          for (const open of openCommitments) {
            if (open.vector && cosineSimilarity(vector, open.vector) > 0.9) {
              isDuplicate = true;
              break;
            }
          }
        } else {
          for (const open of openCommitments) {
            if (open.text.trim().toLowerCase() === trimmed.toLowerCase()) {
              isDuplicate = true;
              break;
            }
          }
        }

        if (!isDuplicate) {
          if (!(await stillVisible())) return;
          const item: {
            id: string;
            text: string;
            documentId: string;
            createdAt: number;
            date: string;
            status: 'open' | 'done' | 'stale';
            vector?: number[];
          } = {
            id: randomUUID(),
            text: trimmed,
            documentId,
            createdAt: now,
            date: dateStr,
            status: 'open',
          };
          if (vector !== undefined) item.vector = vector;
          await db.put('aiCommitments', item);
          LocalStoreSyncService.scheduleStoreSync('aiCommitments', item.id);
        }
      }
    } catch (e) {
      reportError(e, { action: 'ai_commitment_upsert', documentId });
    }
  },

  async getOpenCommitments(): Promise<{ id: string; text: string; createdAt: number; date: string; documentId: string }[]> {
    try {
      const db = await getLocalDb();
      const allCommitments = await db.getAll('aiCommitments');
      const documents = await db.getAll('documents');
      // N-4 + ревью 0.10.13: в чат идут планы только видимых заметок. Список
      // скрытых пропускал план удалённой заметки (её нет в documents) — тот же
      // класс, что TH-3 у хронологии: «нет заметки» = «нельзя» (S-51).
      const visible = await loadVisibleNoteKeys();
      const openCommitments = allCommitments.filter(c => c.status === 'open' && visible.has(c.documentId));
      if (openCommitments.length === 0) return [];

      // Векторы всех заметок здесь не нужны целиком: совпадение ищется только
      // по документам, созданным ПОСЛЕ обязательства. Собираем нужные id и
      // читаем их эмбеддинги поштучно (AUD-8: полный getAll десериализовал
      // весь стор векторов на каждый ход чата).
      const earliestNeeded = Math.min(
        ...openCommitments.filter(c => c.vector).map(c => c.createdAt),
      );
      const embMap = new Map<string, AIDocumentEmbedding>();
      if (Number.isFinite(earliestNeeded)) {
        for (const d of documents) {
          if ((d.lastSessionAt ?? 0) <= earliestNeeded) continue;
          const emb = await db.get('aiEmbeddings', d.id);
          if (emb) embMap.set(d.id, emb);
        }
      }

      const now = Date.now();
      const ageLimitMs = 21 * 24 * 60 * 60 * 1000;
      const result = [];

      for (const c of openCommitments) {
        let matched = false;
        if (c.vector) {
          // Find documents created after this commitment
          const laterDocs = documents.filter(d => (d.lastSessionAt ?? 0) > c.createdAt);
          for (const d of laterDocs) {
            const emb = embMap.get(d.id);
            if (emb && emb.vectors !== undefined) {
              for (const v of emb.vectors) {
                if (cosineSimilarity(c.vector, v) > 0.85) {
                  matched = true;
                  break;
                }
              }
            }
            if (matched) break;
          }
        }

        if (matched) {
          c.status = 'done';
          await db.put('aiCommitments', c);
          LocalStoreSyncService.scheduleStoreSync('aiCommitments', c.id);
        } else if (now - c.createdAt > ageLimitMs) {
          c.status = 'stale';
          await db.put('aiCommitments', c);
          LocalStoreSyncService.scheduleStoreSync('aiCommitments', c.id);
        } else {
          result.push({
            id: c.id,
            text: c.text,
            createdAt: c.createdAt,
            date: c.date,
            documentId: c.documentId,
          });
        }
      }

      // Sort by creation date descending (newest first)
      return result.sort((a, b) => b.createdAt - a.createdAt);
    } catch (e) {
      reportError(e, { action: 'ai_commitment_get_open' });
      return [];
    }
  },

  async delete(id: string): Promise<void> {
    const db = await getLocalDb();
    await db.delete('aiCommitments', id);
    LocalStoreSyncService.scheduleStoreDelete('aiCommitments', id);
  },

  async deleteAll(): Promise<void> {
    const db = await getLocalDb();
    const all = await db.getAll('aiCommitments');
    await db.clear('aiCommitments');
    for (const c of all) {
      LocalStoreSyncService.scheduleStoreDelete('aiCommitments', c.id);
    }
  }
};
