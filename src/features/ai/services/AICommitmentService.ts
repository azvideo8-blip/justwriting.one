import { getLocalDb, randomUUID } from '../../../core/storage/localDb';
import { AIService } from './AIService';
import { cosineSimilarity } from '../utils/vectorSearch';
import { reportError } from '../../../shared/errors/reportError';

export const AICommitmentService = {
  async upsertCommitments(documentId: string, commitments: string[], dateStr: string): Promise<void> {
    if (commitments.length === 0) return;
    try {
      const db = await getLocalDb();
      const now = Date.now();
      const existing = await db.getAll('aiCommitments');
      const openCommitments = existing.filter(c => c.status === 'open');

      for (const text of commitments) {
        if (!text.trim()) continue;
        const trimmed = text.trim();

        // Get embedding for duplicate checking
        const embResult = await AIService.embed({ content: trimmed });
        const vector = embResult.ok && embResult.vectors[0] ? embResult.vectors[0] : undefined;

        let isDuplicate = false;
        if (vector) {
          for (const open of openCommitments) {
            if (open.vector && cosineSimilarity(vector, open.vector) > 0.9) {
              isDuplicate = true;
              break;
            }
          }
        }

        if (!isDuplicate) {
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
        }
      }
    } catch (e) {
      reportError(e, { action: 'ai_commitment_upsert', documentId });
    }
  },

  async getOpenCommitments(): Promise<{ id: string; text: string; createdAt: number; date: string }[]> {
    try {
      const db = await getLocalDb();
      const allCommitments = await db.getAll('aiCommitments');
      const openCommitments = allCommitments.filter(c => c.status === 'open');
      if (openCommitments.length === 0) return [];

      const embeddings = await db.getAll('aiEmbeddings');
      const documents = await db.getAll('documents');
      const embMap = new Map(embeddings.map(e => [e.documentId, e]));

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
        } else if (now - c.createdAt > ageLimitMs) {
          c.status = 'stale';
          await db.put('aiCommitments', c);
        } else {
          result.push({
            id: c.id,
            text: c.text,
            createdAt: c.createdAt,
            date: c.date,
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
  },

  async deleteAll(): Promise<void> {
    const db = await getLocalDb();
    await db.clear('aiCommitments');
  }
};
