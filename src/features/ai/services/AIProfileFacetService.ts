import { getLocalDb } from '../../../core/storage/localDb';
import type { AIProfileFacet } from '../../../core/storage/localDb';
import { AIEmbeddingService } from './AIEmbeddingService';
import { AIService } from './AIService';
import { clusterChunks, mergeSimilarClusters, suggestK } from '../utils/facetClustering';
import { cosineSimilarity } from '../utils/vectorSearch';
import { LIFE_DOMAINS } from '../utils/lifeDomains';

const MIN_FACET_NOTES = 2;          // drop facets with fewer notes (noise)
const MAX_NOTES_PER_PROMPT = 12;    // cap excerpts sent to the facet summarizer
const EXCERPT_CHARS = 1_800;
const MERGE_THRESHOLD = 0.82;       // collapse near-duplicate discovered facets
const DOMAIN_THRESHOLD = 0.50;      // min cosine (note chunk ↔ domain seed) to assign

export interface FacetBuildProgress { done: number; total: number }
export type FacetBuildResult =
  | { ok: true; count: number }
  | { ok: false; error: 'NO_EMBEDDINGS' | 'NO_CLUSTERS' };

interface NoteVecs { noteId: string; chunks: number[][] }
interface FacetSpec { label: string; fixedLabel: boolean; noteIds: string[]; centroid: number[] }

function maxCos(chunks: number[][], v: number[]): number {
  let best = 0;
  for (const c of chunks) {
    const s = cosineSimilarity(c, v);
    if (s > best) best = s;
  }
  return best;
}

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

  /**
   * Rebuilds facets: assign notes to seeded life-domains (Деньги, дети, партнёр,
   * родители, коллеги, самореализация) by embedding similarity, then cluster the
   * leftover (unassigned) notes into "discovered" facets. Summarize each, replace
   * the previous generation.
   */
  async build(onProgress?: (p: FacetBuildProgress) => void): Promise<FacetBuildResult> {
    const db = await getLocalDb();

    const embeddings = await AIEmbeddingService.getAll();
    const noteVecs: NoteVecs[] = embeddings
      .map(e => ({ noteId: e.documentId, chunks: e.vectors?.length ? e.vectors : (e.vector ? [e.vector] : []) }))
      .filter(n => n.chunks.length > 0);
    if (noteVecs.length === 0) return { ok: false, error: 'NO_EMBEDDINGS' };

    // 1. Embed each life-domain seed.
    const domainVecs: { id: string; label: string; vec: number[] }[] = [];
    for (const d of LIFE_DOMAINS) {
      const res = await AIService.embed({ content: d.seed });
      if (res.ok && res.vectors[0]) domainVecs.push({ id: d.id, label: d.label, vec: res.vectors[0] });
    }

    // 2. Assign notes to domains by max chunk-vs-seed cosine (multi-membership).
    const domainNotes = new Map<string, string[]>();
    const assigned = new Set<string>();
    for (const n of noteVecs) {
      for (const d of domainVecs) {
        if (maxCos(n.chunks, d.vec) >= DOMAIN_THRESHOLD) {
          let arr = domainNotes.get(d.id);
          if (!arr) { arr = []; domainNotes.set(d.id, arr); }
          arr.push(n.noteId);
          assigned.add(n.noteId);
        }
      }
    }

    // 3. Discover extra themes from notes that matched no domain (e.g. котята).
    const leftover = noteVecs.filter(n => !assigned.has(n.noteId));
    let discovered: { centroid: number[]; noteIds: string[]; chunkCount: number }[] = [];
    if (leftover.length > 0) {
      const items = leftover.flatMap(n => n.chunks.map(v => ({ noteId: n.noteId, vector: v })));
      discovered = mergeSimilarClusters(clusterChunks(items, suggestK(leftover.length)), MERGE_THRESHOLD)
        .filter(c => c.noteIds.length >= MIN_FACET_NOTES);
    }

    // 4. Build the facet spec list (domains first, then discovered).
    const specs: FacetSpec[] = [];
    for (const d of domainVecs) {
      const ids = domainNotes.get(d.id) ?? [];
      if (ids.length >= MIN_FACET_NOTES) specs.push({ label: d.label, fixedLabel: true, noteIds: ids, centroid: d.vec });
    }
    for (const c of discovered) {
      specs.push({ label: '', fixedLabel: false, noteIds: c.noteIds, centroid: c.centroid });
    }
    if (specs.length === 0) return { ok: false, error: 'NO_CLUSTERS' };
    specs.sort((a, b) => b.noteIds.length - a.noteIds.length);

    const docs = await db.getAll('documents');
    const docMap = new Map(docs.map(d => [d.id, d]));
    const summaries = await db.getAll('aiSummaries');
    const sumMap = new Map(summaries.map(s => [s.documentId, s]));

    const buildId = `${Date.now()}`;
    const facets: AIProfileFacet[] = [];

    for (const spec of specs) {
      let firstAt = Infinity;
      let lastAt = 0;
      const noteInputs: { title: string; excerpt: string }[] = [];

      for (const noteId of spec.noteIds) {
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

      let label = spec.fixedLabel ? spec.label : `Тема (${spec.noteIds.length})`;
      let summary = '';
      if (noteInputs.length > 0) {
        let res = await AIService.summarizeFacet({ notes: noteInputs });
        if (!res.ok || (!res.label && !res.summary)) {
          await new Promise(r => setTimeout(r, 300));
          res = await AIService.summarizeFacet({ notes: noteInputs });
        }
        if (res.ok) {
          summary = res.summary;
          if (!spec.fixedLabel && res.label) label = res.label; // domains keep their canonical label
        }
      }

      facets.push({
        id: `${buildId}_${facets.length}`,
        label,
        summary,
        centroid: spec.centroid,
        noteIds: spec.noteIds,
        noteCount: spec.noteIds.length,
        firstAt: firstAt === Infinity ? 0 : firstAt,
        lastAt,
        updatedAt: Date.now(),
        buildId,
      });
      onProgress?.({ done: facets.length, total: specs.length });
      await new Promise(r => setTimeout(r, 150)); // gentle gap between LLM calls
    }

    // Replace the previous generation.
    await db.clear('aiProfileFacets');
    for (const f of facets) await db.put('aiProfileFacets', f);
    return { ok: true, count: facets.length };
  },
};
