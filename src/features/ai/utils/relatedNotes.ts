import { AIEmbeddingService } from '../services/AIEmbeddingService';
import { AIService } from '../services/AIService';
import { getLocalDb } from '../../../core/storage/localDb';
import { cosineSimilarity } from './vectorSearch';
import { RESURFACE_FLOOR } from './noteRetriever';
import { reportError } from '../../../shared/errors/reportError';

export interface RelatedNote {
  documentId: string;
  title: string;
  date: string; // YYYY-MM-DD
  score: number;
}

export interface FindRelatedNotesOptions {
  maxResults?: number;
  minAgeDays?: number;
  ignoredDocIds?: Set<string> | string[];
}

export async function findRelatedNotes(
  seed: { text?: string; docId?: string },
  opts?: FindRelatedNotesOptions,
): Promise<RelatedNote[]> {
  let queryVec: number[] | undefined;

  if (seed.docId) {
    const seedEmb = await AIEmbeddingService.get(seed.docId);
    if (!seedEmb || !seedEmb.vectors?.length) return [];

    // Average vectors to represent the whole document
    if (seedEmb.vectors.length === 1) {
      queryVec = seedEmb.vectors[0];
    } else {
      const len = seedEmb.vectors[0]!.length;
      const acc = new Array<number>(len).fill(0);
      for (const v of seedEmb.vectors) {
        for (let i = 0; i < len; i++) {
          acc[i] = acc[i]! + (v[i] ?? 0);
        }
      }
      for (let i = 0; i < len; i++) {
        acc[i] = acc[i]! / seedEmb.vectors.length;
      }
      queryVec = acc;
    }
  } else if (seed.text) {
    const embedResult = await AIService.embed({ content: seed.text });
    if (!embedResult.ok || !embedResult.vectors?.length) {
      if (!embedResult.ok) {
        reportError(embedResult.error, { action: 'find_related_notes_embed' });
      }
      return [];
    }
    queryVec = embedResult.vectors[0];
  }

  if (!queryVec) return [];

  const allEmbeddings = await AIEmbeddingService.getAll();
  const db = await getLocalDb();
  const docs = await db.getAll('documents');
  const docMap = new Map(docs.map(d => [d.id, d]));

  const candidates: {
    documentId: string;
    title: string;
    lastSessionAt: number;
    bestScore: number;
    bestChunkVector: number[];
  }[] = [];

  const ignored = new Set<string>();
  if (seed.docId) ignored.add(seed.docId);
  if (opts?.ignoredDocIds) {
    const optIgnored = opts.ignoredDocIds instanceof Set ? opts.ignoredDocIds : new Set(opts.ignoredDocIds);
    for (const id of optIgnored) ignored.add(id);
  }

  for (const emb of allEmbeddings) {
    if (ignored.has(emb.documentId)) continue;
    const doc = docMap.get(emb.documentId);
    if (!doc) continue;

    // Age filter
    const ts = doc.lastSessionAt || doc.firstSessionAt || 0;
    if (opts?.minAgeDays !== undefined && opts.minAgeDays > 0) {
      const limit = Date.now() - opts.minAgeDays * 24 * 60 * 60 * 1000;
      if (ts > limit) continue;
    }

    // Find best similarity chunk
    let bestScore = -1;
    let bestVec: number[] | null = null;
    const vectors = emb.vectors?.length ? emb.vectors : (emb.vector ? [emb.vector] : []);
    for (const vec of vectors) {
      const sim = cosineSimilarity(queryVec, vec);
      if (sim > bestScore) {
        bestScore = sim;
        bestVec = vec;
      }
    }

    // Relevance floor
    if (bestScore < RESURFACE_FLOOR) continue;

    if (bestVec) {
      candidates.push({
        documentId: emb.documentId,
        title: doc.title || 'Без названия',
        lastSessionAt: ts,
        bestScore,
        bestChunkVector: bestVec,
      });
    }
  }

  // Sort by score descending, then by age descending (recent first) as tiebreak
  candidates.sort((a, b) => {
    if (Math.abs(a.bestScore - b.bestScore) < 1e-6) {
      return b.lastSessionAt - a.lastSessionAt;
    }
    return b.bestScore - a.bestScore;
  });

  const selected: typeof candidates = [];
  const maxResults = opts?.maxResults ?? 5;

  for (const cand of candidates) {
    if (selected.length >= maxResults) break;

    // MMR-lite check (diversity check against already selected candidates)
    let isDuplicate = false;
    for (const sel of selected) {
      const sim = cosineSimilarity(cand.bestChunkVector, sel.bestChunkVector);
      if (sim > 0.85) {
        isDuplicate = true;
        break;
      }
    }
    if (isDuplicate) continue;

    selected.push(cand);
  }

  return selected.map(sel => {
    const dateObj = new Date(sel.lastSessionAt || Date.now());
    const yyyy = dateObj.getFullYear();
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    const dd = String(dateObj.getDate()).padStart(2, '0');
    return {
      documentId: sel.documentId,
      title: sel.title,
      date: `${yyyy}-${mm}-${dd}`,
      score: sel.bestScore,
    };
  });
}
