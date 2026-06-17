import { getLocalDb } from '../../../core/storage/localDb';
import type { AIProfileFacet } from '../../../core/storage/localDb';
import { AIEmbeddingService } from './AIEmbeddingService';
import { AIService } from './AIService';
import { clusterChunks, suggestK, type ChunkItem } from '../utils/facetClustering';

const MIN_FACET_NOTES = 2;          // drop singleton clusters (noise)
const MAX_NOTES_PER_PROMPT = 12;    // cap excerpts sent to the facet summarizer
const EXCERPT_CHARS = 1_800;

export interface FacetBuildProgress { done: number; total: number }
export type FacetBuildResult =
  | { ok: true; count: number }
  | { ok: false; error: 'NO_EMBEDDINGS' | 'NO_CLUSTERS' };

export const AIProfileFacetService = {
  async getAll(): Promise<AIProfileFacet[]> {
    const db = await getLocalDb();
    const all = await db.getAll('aiProfileFacets');
    all.sort((a, b) => b.noteCount - a.noteCount);
    return all;
  },

  async clear(): Promise<void> {
    const db = await getLocalDb();
    await db.clear('aiProfileFacets');
  },

  /** Rebuilds all facets: cluster note embeddings, summarize each cluster, replace
   *  the previous generation. Returns how many facets were produced. */
  async build(onProgress?: (p: FacetBuildProgress) => void): Promise<FacetBuildResult> {
    const db = await getLocalDb();

    const embeddings = await AIEmbeddingService.getAll();
    const items: ChunkItem[] = [];
    for (const e of embeddings) {
      const vecs = e.vectors?.length ? e.vectors : (e.vector ? [e.vector] : []);
      for (const v of vecs) items.push({ noteId: e.documentId, vector: v });
    }
    if (items.length === 0) return { ok: false, error: 'NO_EMBEDDINGS' };

    const noteCount = new Set(items.map(i => i.noteId)).size;
    const clusters = clusterChunks(items, suggestK(noteCount))
      .filter(c => c.noteIds.length >= MIN_FACET_NOTES)
      .sort((a, b) => b.noteIds.length - a.noteIds.length);
    if (clusters.length === 0) return { ok: false, error: 'NO_CLUSTERS' };

    const docs = await db.getAll('documents');
    const docMap = new Map(docs.map(d => [d.id, d]));
    const summaries = await db.getAll('aiSummaries');
    const sumMap = new Map(summaries.map(s => [s.documentId, s]));

    const buildId = `${Date.now()}`;
    const facets: AIProfileFacet[] = [];

    for (const cluster of clusters) {
      let firstAt = Infinity;
      let lastAt = 0;
      const noteInputs: { title: string; excerpt: string }[] = [];

      for (const noteId of cluster.noteIds) {
        const doc = docMap.get(noteId);
        const ts = doc?.lastSessionAt ?? 0;
        if (ts) { firstAt = Math.min(firstAt, ts); lastAt = Math.max(lastAt, ts); }

        if (noteInputs.length < MAX_NOTES_PER_PROMPT) {
          const sum = sumMap.get(noteId);
          let excerpt: string;
          if (sum) {
            excerpt = `Темы: ${sum.themes.join(', ')}. Инсайты: ${sum.insights.join('; ')}. Факты: ${sum.extractedFacts.join('; ')}`;
          } else {
            const versions = await db.getAllFromIndex('versions', 'by-document', noteId);
            versions.sort((a, b) => b.version - a.version);
            excerpt = versions[0]?.content ?? '';
          }
          noteInputs.push({ title: doc?.title || 'Без названия', excerpt: excerpt.slice(0, EXCERPT_CHARS) });
        }
      }

      let label = `Тема (${cluster.noteIds.length})`;
      let summary = '';
      if (noteInputs.length > 0) {
        const res = await AIService.summarizeFacet({ notes: noteInputs });
        if (res.ok) {
          if (res.label) label = res.label;
          summary = res.summary;
        }
      }

      facets.push({
        id: `${buildId}_${facets.length}`,
        label,
        summary,
        centroid: cluster.centroid,
        noteIds: cluster.noteIds,
        noteCount: cluster.noteIds.length,
        firstAt: firstAt === Infinity ? 0 : firstAt,
        lastAt,
        updatedAt: Date.now(),
        buildId,
      });
      onProgress?.({ done: facets.length, total: clusters.length });
      await new Promise(r => setTimeout(r, 150)); // gentle gap between LLM calls
    }

    // Replace the previous generation atomically-ish (clear then write).
    await db.clear('aiProfileFacets');
    for (const f of facets) await db.put('aiProfileFacets', f);
    return { ok: true, count: facets.length };
  },
};
