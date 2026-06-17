import { getLocalDb } from '../../../core/storage/localDb';
import type { AIProfileFacet } from '../../../core/storage/localDb';
import { AIEmbeddingService } from './AIEmbeddingService';
import { AIService } from './AIService';
import { clusterChunks, mergeSimilarClusters, suggestK, type ChunkItem } from '../utils/facetClustering';
import { cosineSimilarity } from '../utils/vectorSearch';
import { LIFE_DOMAINS } from '../utils/lifeDomains';

const MIN_FACET_NOTES = 2;          // drop facets with fewer notes (noise)
const MAX_EXCERPTS = 12;            // chunk excerpts sent to the facet summarizer
const EXCERPT_CHARS = 1_200;
const MERGE_THRESHOLD = 0.80;       // collapse near-duplicate discovered facets
const MAX_DISCOVERED = 6;           // keep the "other" bucket from re-fragmenting
const DOMAIN_THRESHOLD = 0.45;      // min cosine (chunk ↔ domain seed) to assign

export interface FacetBuildProgress { done: number; total: number }
export type FacetBuildResult =
  | { ok: true; count: number }
  | { ok: false; error: 'NO_EMBEDDINGS' | 'NO_CLUSTERS' | 'NO_CHUNK_TEXTS' };

interface Chunk { noteId: string; vector: number[]; text: string }
interface FacetSpec { label: string; fixedLabel: boolean; noteIds: string[]; texts: string[]; centroid: number[] }

const STOPWORDS = new Set([
  'это','эта','этот','что','чтобы','когда','если','или','как','так','тоже','также','уже','ещё','еще','очень','только','просто',
  'меня','мной','мне','мой','моя','моё','мои','тебя','тебе','него','неё','них','свой','своя','свои','себя','себе',
  'был','была','было','были','быть','есть','будет','чтото','что-то','потому','потом','тогда','сейчас','сегодня','завтра','вчера',
  'день','утро','доброе','время','раз','нужно','надо','хочу','могу','буду','делать','сделать','которые','который','которая',
  'нет','да','ну','вот','там','тут','здесь','этом','этого','всё','все','весь','очень','более','менее','этим','будто','например',
]);

/** Clean keyword fallback — never raw chunk text (could be mid-sentence / explicit). */
function fallbackFromTexts(texts: string[]): { label: string; summary: string } {
  const freq = new Map<string, number>();
  const words = texts.join(' ').toLowerCase().match(/[а-яё]{4,}/gi) ?? [];
  for (const w of words) {
    if (STOPWORDS.has(w)) continue;
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w]) => w);
  const label = top.slice(0, 2).join(', ');
  const summary = top.length ? `Часто упоминается: ${top.join(', ')}.` : '';
  return { label, summary };
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
   * Chunk-level facets: assign each note CHUNK to its best life-domain (Деньги,
   * дети, партнёр, родители, коллеги, самореализация) by embedding similarity,
   * cluster leftover chunks into "discovered" facets, and summarize each facet
   * from ITS OWN chunk texts (so a domain describes only its slice, not the whole
   * rambling note). Replaces the previous generation.
   */
  async build(onProgress?: (p: FacetBuildProgress) => void): Promise<FacetBuildResult> {
    const db = await getLocalDb();

    const embeddings = await AIEmbeddingService.getAll();
    const chunks: Chunk[] = [];
    let haveTexts = false;
    for (const e of embeddings) {
      const vecs = e.vectors ?? [];
      const texts = e.chunkTexts ?? [];
      if (texts.length) haveTexts = true;
      for (let i = 0; i < vecs.length; i++) {
        chunks.push({ noteId: e.documentId, vector: vecs[i]!, text: texts[i] ?? '' });
      }
    }
    if (chunks.length === 0) return { ok: false, error: 'NO_EMBEDDINGS' };
    if (!haveTexts) return { ok: false, error: 'NO_CHUNK_TEXTS' }; // need a re-index (schema v3)

    // 1. Embed each life-domain seed.
    const domainVecs: { id: string; label: string; vec: number[] }[] = [];
    for (const d of LIFE_DOMAINS) {
      const res = await AIService.embed({ content: d.seed });
      if (res.ok && res.vectors[0]) domainVecs.push({ id: d.id, label: d.label, vec: res.vectors[0] });
    }

    // 2. Assign each CHUNK to its single best domain (argmax above threshold).
    const domainData = new Map<string, { label: string; vec: number[]; noteIds: Set<string>; texts: string[] }>();
    const leftover: ChunkItem[] = [];
    for (const ch of chunks) {
      let best: { id: string; label: string; vec: number[] } | null = null;
      let bestSim = DOMAIN_THRESHOLD;
      for (const d of domainVecs) {
        const s = cosineSimilarity(ch.vector, d.vec);
        if (s >= bestSim) { bestSim = s; best = d; }
      }
      if (best) {
        let dd = domainData.get(best.id);
        if (!dd) { dd = { label: best.label, vec: best.vec, noteIds: new Set(), texts: [] }; domainData.set(best.id, dd); }
        dd.noteIds.add(ch.noteId);
        if (ch.text) dd.texts.push(ch.text);
      } else {
        leftover.push({ noteId: ch.noteId, vector: ch.vector, text: ch.text });
      }
    }

    // 3. Discover extra themes from chunks that matched no domain (e.g. котята).
    let discovered: { centroid: number[]; noteIds: string[]; texts: string[]; chunkCount: number }[] = [];
    if (leftover.length > 0) {
      const noteCount = new Set(leftover.map(c => c.noteId)).size;
      discovered = mergeSimilarClusters(clusterChunks(leftover, Math.min(suggestK(noteCount), MAX_DISCOVERED)), MERGE_THRESHOLD)
        .filter(c => c.noteIds.length >= MIN_FACET_NOTES);
    }

    // 4. Build specs (domains first, then discovered).
    const specs: FacetSpec[] = [];
    for (const d of domainVecs) {
      const dd = domainData.get(d.id);
      if (dd && dd.noteIds.size >= MIN_FACET_NOTES) {
        specs.push({ label: dd.label, fixedLabel: true, noteIds: [...dd.noteIds], texts: dd.texts, centroid: dd.vec });
      }
    }
    for (const c of discovered) {
      specs.push({ label: '', fixedLabel: false, noteIds: c.noteIds, texts: c.texts, centroid: c.centroid });
    }
    if (specs.length === 0) return { ok: false, error: 'NO_CLUSTERS' };
    specs.sort((a, b) => b.noteIds.length - a.noteIds.length);

    const docs = await db.getAll('documents');
    const docMap = new Map(docs.map(d => [d.id, d]));
    const totalNotes = new Set(chunks.map(c => c.noteId)).size;

    const buildId = `${Date.now()}`;
    const facets: AIProfileFacet[] = [];

    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i]!;
      onProgress?.({ done: i + 1, total: specs.length });

      let firstAt = Infinity;
      let lastAt = 0;
      for (const id of spec.noteIds) {
        const ts = docMap.get(id)?.lastSessionAt ?? 0;
        if (ts) { firstAt = Math.min(firstAt, ts); lastAt = Math.max(lastAt, ts); }
      }

      const excerpts = spec.texts
        .filter(t => t.trim().length > 0)
        .slice(0, MAX_EXCERPTS)
        .map(t => ({ title: '(фрагмент)', excerpt: t.slice(0, EXCERPT_CHARS) }));

      let label = spec.fixedLabel ? spec.label : '';
      let summary = '';
      let llmOk = false;
      if (excerpts.length > 0) {
        const focus = spec.fixedLabel ? spec.label : undefined;
        let res = await AIService.summarizeFacet({ notes: excerpts, focus });
        if (!res.ok || (!res.label && !res.summary)) {
          await new Promise(r => setTimeout(r, 300));
          res = await AIService.summarizeFacet({ notes: excerpts, focus });
        }
        if (res.ok && res.summary) {
          summary = res.summary;
          llmOk = true;
          if (!spec.fixedLabel && res.label) label = res.label;
        }
      }

      // Drop noisy "discovered" facets: the AI couldn't name them, or they're a
      // catch-all (greetings/logistics residue across most of the corpus). Keep
      // every life-domain (with a clean keyword fallback if the LLM failed).
      if (!spec.fixedLabel && (!llmOk || spec.noteIds.length > totalNotes * 0.4)) {
        await new Promise(r => setTimeout(r, 150));
        continue;
      }

      if (!summary || !label) {
        const fb = fallbackFromTexts(spec.texts);
        if (!summary) summary = fb.summary;
        if (!label) label = fb.label || spec.label || 'Тема';
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
      await new Promise(r => setTimeout(r, 150));
    }

    await db.clear('aiProfileFacets');
    for (const f of facets) await db.put('aiProfileFacets', f);
    return { ok: true, count: facets.length };
  },
};
