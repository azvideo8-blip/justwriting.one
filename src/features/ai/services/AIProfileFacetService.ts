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

function normalize(v: number[]): number[] {
  let mag = 0;
  for (const x of v) mag += x * x;
  mag = Math.sqrt(mag);
  return mag === 0 ? v.slice() : v.map(x => x / mag);
}

const STOPWORDS = new Set([
  'это','эта','этот','что','чтобы','когда','если','или','как','так','тоже','также','уже','ещё','еще','очень','только','просто',
  'меня','мной','мне','мой','моя','моё','мои','тебя','тебе','него','неё','них','свой','своя','свои','себя','себе',
  'был','была','было','были','быть','есть','будет','чтото','что-то','потому','потом','тогда','сейчас','сегодня','завтра','вчера',
  'день','утро','доброе','время','раз','нужно','надо','хочу','могу','буду','делать','сделать','которые','который','которая',
  'нет','да','ну','вот','там','тут','здесь','этом','этого','всё','все','весь','очень','более','менее','этим','будто','например',
  'может','можн','пока','ничего','делаю','понимаю','знаю','пишу','писал','говорю','сказал','типа','пофиг','вообще','думаю',
  'чувствую','получается','значит','нормально','какой','какая','каков','чей','чья','кому','кого','кем','чем','чего',
  'однако','впрочем','конечно','наверное','пожалуй','видимо','кажется','действительно','просто','именно','особенно',
  'должен','должна','должно','можно','нельзя','обязательно','наверняка','точно','вероятно',
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

    // 2. Assign each CHUNK to ALL matching domains (multi-assignment).
    //    Primary: argmax if cosine ≥ domain's threshold (or global DOMAIN_THRESHOLD).
    //    Secondary: any other domain where cosine ≥ threshold + SECONDARY_BUMP.
    const SECONDARY_BUMP = 0.03;
    const domainData = new Map<string, { label: string; vec: number[]; noteIds: Set<string>; texts: string[] }>();
    const leftover: ChunkItem[] = [];
    for (const ch of chunks) {
      const scores = domainVecs.map(d => ({
        id: d.id, label: d.label, vec: d.vec,
        sim: cosineSimilarity(ch.vector, d.vec),
        threshold: LIFE_DOMAINS.find(ld => ld.id === d.id)?.threshold ?? DOMAIN_THRESHOLD,
      }));
      const best = scores.reduce((a, b) => a.sim >= b.sim ? a : b);
      let assigned = false;
      if (best.sim >= best.threshold) {
        let dd = domainData.get(best.id);
        if (!dd) { dd = { label: best.label, vec: best.vec, noteIds: new Set(), texts: [] }; domainData.set(best.id, dd); }
        dd.noteIds.add(ch.noteId);
        if (ch.text) dd.texts.push(ch.text);
        assigned = true;
      }
      for (const s of scores) {
        if (s.id === best.id) continue;
        const secThreshold = s.threshold + SECONDARY_BUMP;
        if (s.sim >= secThreshold) {
          let dd = domainData.get(s.id);
          if (!dd) { dd = { label: s.label, vec: s.vec, noteIds: new Set(), texts: [] }; domainData.set(s.id, dd); }
          dd.noteIds.add(ch.noteId);
          if (ch.text) dd.texts.push(ch.text);
          assigned = true;
        }
      }
      if (!assigned) {
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

    const summaries = await db.getAll('aiSummaries');
    const summaryMap = new Map(summaries.map(s => [s.documentId, s]));

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
        insightDensity: spec.noteIds.length > 0
          ? spec.noteIds.filter(id => { const s = summaryMap.get(id); return s && s.insights.length > 0; }).length / spec.noteIds.length
          : 0,
      });
      await new Promise(r => setTimeout(r, 150));
    }

    // PROF-7: Person facets from mentionedPeople in summaries.
    const personNotes = new Map<string, { name: string; role: string; noteIds: string[] }>();
    for (const s of summaries) {
      for (const p of s.mentionedPeople ?? []) {
        const key = p.name.toLowerCase();
        let entry = personNotes.get(key);
        if (!entry) {
          entry = { name: p.name, role: p.role, noteIds: [] };
          personNotes.set(key, entry);
        }
        if (!entry.noteIds.includes(s.documentId)) entry.noteIds.push(s.documentId);
        if (p.role && (!entry.role || entry.role === p.role)) entry.role = p.role;
      }
    }

    for (const [, pn] of personNotes) {
      if (pn.noteIds.length < MIN_FACET_NOTES) continue;
      onProgress?.({ done: facets.length + 1, total: facets.length + personNotes.size });

      let firstAt = Infinity;
      let lastAt = 0;
      const texts: string[] = [];
      for (const id of pn.noteIds) {
        const ts = docMap.get(id)?.lastSessionAt ?? 0;
        if (ts) { firstAt = Math.min(firstAt, ts); lastAt = Math.max(lastAt, ts); }
        for (const e of embeddings) {
          if (e.documentId === id) texts.push(...(e.chunkTexts ?? []));
        }
      }

      const excerpts = texts.filter(t => t.trim()).slice(0, MAX_EXCERPTS).map(t => ({ title: '(фрагмент)', excerpt: t.slice(0, EXCERPT_CHARS) }));
      let summary = '';
      if (excerpts.length > 0) {
        const focus = `${pn.name} (${pn.role})`;
        let res = await AIService.summarizeFacet({ notes: excerpts, focus });
        if (!res.ok || (!res.label && !res.summary)) {
          await new Promise(r => setTimeout(r, 300));
          res = await AIService.summarizeFacet({ notes: excerpts, focus });
        }
        if (res.ok && res.summary) summary = res.summary;
      }

      const meanVec = embeddings
        .filter(e => pn.noteIds.includes(e.documentId) && e.vectors.length > 0)
        .flatMap(e => e.vectors);
      const centroid = meanVec.length > 0
        ? normalize(meanVec.reduce((acc, v) => acc.map((x, i) => x + (v[i] ?? 0)), new Array(meanVec[0]!.length).fill(0) as number[]))
        : [];

      facets.push({
        id: `${buildId}_${facets.length}`,
        label: pn.name,
        summary: summary || `Упоминания о ${pn.name} (${pn.role}) в ${pn.noteIds.length} заметках.`,
        centroid,
        noteIds: pn.noteIds,
        noteCount: pn.noteIds.length,
        firstAt: firstAt === Infinity ? 0 : firstAt,
        lastAt,
        updatedAt: Date.now(),
        buildId,
        insightDensity: pn.noteIds.length > 0
          ? pn.noteIds.filter(id => { const s = summaryMap.get(id); return s && s.insights.length > 0; }).length / pn.noteIds.length
          : 0,
      });
      await new Promise(r => setTimeout(r, 150));
    }

    await db.clear('aiProfileFacets');
    for (const f of facets) await db.put('aiProfileFacets', f);
    return { ok: true, count: facets.length };
  },

  /**
   * Incremental update: assign new note chunks to existing facets by centroid
   * proximity. Dirty facets get re-summarized. Returns number of facets updated.
   * Call this after a new note is embedded (from useEmbeddingIndexer).
   */
  async incrementalUpdate(noteId: string): Promise<{ updated: number }> {
    const db = await getLocalDb();
    const facets = await db.getAll('aiProfileFacets');
    if (facets.length === 0) return { updated: 0 };

    const emb = await AIEmbeddingService.get(noteId);
    if (!emb || !emb.vectors?.length) return { updated: 0 };

    const chunks: { vector: number[]; text: string }[] = [];
    for (let i = 0; i < emb.vectors.length; i++) {
      chunks.push({ vector: emb.vectors[i]!, text: emb.chunkTexts?.[i] ?? '' });
    }

    const INCREMENT_THRESHOLD = 0.48;
    const dirty = new Set<string>();

    for (const ch of chunks) {
      let bestFacet: AIProfileFacet | null = null;
      let bestSim = INCREMENT_THRESHOLD;
      for (const f of facets) {
        const s = cosineSimilarity(ch.vector, f.centroid);
        if (s >= bestSim) { bestSim = s; bestFacet = f; }
      }
      if (bestFacet) {
        if (!bestFacet.noteIds.includes(noteId)) {
          bestFacet.noteIds.push(noteId);
          bestFacet.noteCount = bestFacet.noteIds.length;
        }
        bestFacet.dirty = true;
        dirty.add(bestFacet.id);
      }
    }

    const doc = (await db.getAll('documents')).find(d => d.id === noteId);
    const ts = doc?.lastSessionAt ?? Date.now();

    for (const f of facets) {
      if (dirty.has(f.id)) {
        if (ts < f.firstAt || !f.firstAt) f.firstAt = ts;
        if (ts > f.lastAt) f.lastAt = ts;
      }
      await db.put('aiProfileFacets', f);
    }

    return { updated: dirty.size };
  },

  /**
   * Re-summarize all dirty facets. Call this after incrementalUpdate, ideally
   * debounced so multiple new notes in one session batch together.
   */
  async resummarizeDirty(onProgress?: (p: FacetBuildProgress) => void): Promise<{ count: number }> {
    const db = await getLocalDb();
    const facets = await db.getAll('aiProfileFacets');
    const dirty = facets.filter(f => f.dirty);
    if (dirty.length === 0) return { count: 0 };

    const _docs = await db.getAll('documents');
    let done = 0;

    for (const f of dirty) {
      onProgress?.({ done: ++done, total: dirty.length });

      const embForNote = await AIEmbeddingService.getAll();
      const texts: string[] = [];
      for (const e of embForNote) {
        if (!f.noteIds.includes(e.documentId)) continue;
        for (const t of e.chunkTexts ?? []) {
          if (t.trim()) texts.push(t);
        }
      }

      const excerpts = texts.slice(0, MAX_EXCERPTS).map(t => ({ title: '(фрагмент)', excerpt: t.slice(0, EXCERPT_CHARS) }));
      if (excerpts.length > 0) {
        const focus = f.label;
        let res = await AIService.summarizeFacet({ notes: excerpts, focus });
        if (!res.ok || (!res.label && !res.summary)) {
          await new Promise(r => setTimeout(r, 300));
          res = await AIService.summarizeFacet({ notes: excerpts, focus });
        }
        if (res.ok && res.summary) {
          f.summary = res.summary;
          if (res.label && !f.label.startsWith('Отношения')) f.label = res.label;
        }
      }

      f.dirty = false;
      f.updatedAt = Date.now();
      await db.put('aiProfileFacets', f);
      await new Promise(r => setTimeout(r, 150));
    }

    return { count: dirty.length };
  },
};
