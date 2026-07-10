import { getLocalDb, randomUUID } from '../../../core/storage/localDb';
import { AIEmbeddingService } from './AIEmbeddingService';
import { AIService } from './AIService';
import { AIBackgroundBudget } from './AIBackgroundBudget';
import { cosineSimilarity } from '../utils/vectorSearch';
import { reportError } from '../../../shared/errors/reportError';

interface Thread {
  id: string;
  noteIds: string[];
  summary: string;
  centroid: number[];
  lastNoteAt: number;
  memberHash: string;
  updatedAt: number;
}

export const AIThreadService = {
  async rebuildThreads(): Promise<void> {
    try {
      const db = await getLocalDb();
      const documents = await db.getAll('documents');
      const embeddings = await AIEmbeddingService.getAll();

      if (documents.length === 0 || embeddings.length === 0) return;

      const embMap = new Map(embeddings.map(e => [e.documentId, e.vectors?.[0]]));
      // Sort documents by lastSessionAt ascending
      const sortedDocs = [...documents].sort((a, b) => (a.lastSessionAt ?? 0) - (b.lastSessionAt ?? 0));

      const clusters: Thread[] = [];

      for (const doc of sortedDocs) {
        const v = embMap.get(doc.id);
        if (!v) continue;

        let bestIndex = -1;
        let bestScore = -1;

        const docTime = doc.lastSessionAt ?? Date.now();

        for (let i = 0; i < clusters.length; i++) {
          const c = clusters[i]!;
          const sim = cosineSimilarity(v, c.centroid);

          // Time decay bias: penalty of 0.1 for every 14 days of age difference
          const deltaDays = Math.max(0, docTime - c.lastNoteAt) / (24 * 60 * 60 * 1000);
          const score = sim - (deltaDays / 14) * 0.1;

          if (score > 0.62 && score > bestScore) {
            bestScore = score;
            bestIndex = i;
          }
        }

        if (bestIndex !== -1) {
          const c = clusters[bestIndex]!;
          c.noteIds.push(doc.id);
          c.lastNoteAt = Math.max(c.lastNoteAt, docTime);
          // Recompute centroid
          const count = c.noteIds.length;
          c.centroid = c.centroid.map((val, idx) => (val * (count - 1) + v[idx]!) / count);
        } else {
          clusters.push({
            id: randomUUID(),
            noteIds: [doc.id],
            summary: '',
            centroid: [...v],
            lastNoteAt: docTime,
            memberHash: '',
            updatedAt: Date.now(),
          });
        }
      }

      // Sync clusters to db
      const existingThreads = await db.getAll('aiThreads');

      for (const c of clusters) {
        // Compute stable member hash
        const sortedIds = [...c.noteIds].sort();
        const hashStr = sortedIds.join(',');
        c.memberHash = hashStr;

        // Try to match with existing thread by checking intersection
        let matchedThread = null;
        for (const t of existingThreads) {
          const intersection = t.noteIds.filter(id => c.noteIds.includes(id));
          if (intersection.length > c.noteIds.length * 0.5) {
            matchedThread = t;
            break;
          }
        }

        if (matchedThread) {
          c.id = matchedThread.id;
          c.summary = matchedThread.summary;
          if (matchedThread.memberHash === c.memberHash) {
            // No changes to members, skip regenerating narrative
            await db.put('aiThreads', c);
            continue;
          }
        }

        // Generate narrative if budget allows
        if (AIBackgroundBudget.canSpend(1)) {
          // Gather excerpts
          const notesInput = [];
          for (const id of c.noteIds.slice(-5)) { // Use up to 5 most recent notes in thread
            const doc = documents.find(d => d.id === id);
            const emb = embeddings.find(e => e.documentId === id);
            if (doc && emb) {
              const text = emb.chunkTexts?.[0] || '';
              if (text.trim()) {
                notesInput.push({ title: doc.title || 'Без названия', excerpt: text.slice(0, 1000) });
              }
            }
          }

          if (notesInput.length > 0) {
            const res = await AIService.summarizeFacet({
              notes: notesInput,
              focus: 'выяви общую сюжетную линию и развитие темы',
            });
            if (res.ok && res.summary) {
              c.summary = res.summary;
              c.updatedAt = Date.now();
              AIBackgroundBudget.spend(1);
            }
          }
        }

        await db.put('aiThreads', c);
      }

      // Clean up deleted/pruned threads
      const newIds = clusters.map(c => c.id);
      for (const t of existingThreads) {
        if (!newIds.includes(t.id)) {
          await db.delete('aiThreads', t.id);
        }
      }
    } catch (e) {
      reportError(e, { action: 'ai_thread_rebuild' });
    }
  },

  async getRelevant(queryVector: number[], k = 3): Promise<{ id: string; summary: string; ageDays: number }[]> {
    try {
      const db = await getLocalDb();
      const threads = await db.getAll('aiThreads');
      const matched = [];
      const now = Date.now();

      for (const t of threads) {
        if (!t.summary) continue;
        const sim = cosineSimilarity(queryVector, t.centroid);
        if (sim > 0.6) {
          const ageDays = Math.max(0, now - t.lastNoteAt) / (24 * 60 * 60 * 1000);
          matched.push({
            id: t.id,
            summary: t.summary,
            ageDays,
            sim,
          });
        }
      }

      // Sort by similarity score descending
      return matched
        .sort((a, b) => b.sim - a.sim)
        .slice(0, k)
        .map(t => ({ id: t.id, summary: t.summary, ageDays: Math.round(t.ageDays) }));
    } catch (e) {
      reportError(e, { action: 'ai_thread_get_relevant' });
      return [];
    }
  }
};
