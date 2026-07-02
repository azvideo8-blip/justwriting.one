import { getLocalDb } from '../../../core/storage/localDb';
import type { AIProfileFacet } from '../../../core/storage/localDb';
import { AIEmbeddingService } from './AIEmbeddingService';
import { AIService } from './AIService';
import { clusterChunks, mergeSimilarClusters, suggestK, normalize, type ChunkItem } from '../utils/facetClustering';
import { cosineSimilarity } from '../utils/vectorSearch';
import { AITaxonomyService } from './AITaxonomyService';
import { tuneThresholds } from '../utils/thresholdTuner';

const MIN_FACET_NOTES = 2;
const MAX_EXCERPTS = 14;
const EXCERPT_CHARS = 2_000;
const MERGE_THRESHOLD = 0.80;
const MAX_DISCOVERED = 6;
const DOMAIN_THRESHOLD = 0.45;
const PRIMARY_THRESHOLD = 0.55;
const LLM_DELAY_MS = 200;

export interface FacetBuildProgress { done: number; total: number }
export type FacetBuildResult =
  | { ok: true; count: number }
  | { ok: false; error: 'NO_EMBEDDINGS' | 'NO_CLUSTERS' | 'NO_CHUNK_TEXTS' };

interface Chunk { noteId: string; vector: number[]; text: string }
interface FacetSpec { label: string; fixedLabel: boolean; noteIds: string[]; texts: string[]; centroid: number[]; chunkCount: number; primaryNoteIds?: string[]; secondaryNoteIds?: string[] }

const STOPWORDS = new Set([
  'это','эта','этот','что','чтобы','когда','если','или','как','так','тоже','также','уже','ещё','еще','очень','только','просто',
  'меня','мной','мне','мой','моя','моё','мои','тебя','тебе','него','неё','них','свой','своя','свои','себя','себе',
  'был','была','было','были','быть','есть','будет','чтото','что-то','потому','потом','тогда','сейчас','сегодня','завтра','вчера',
  'день','утро','утра','доброе','время','раз','нужно','надо','хочу','могу','буду','делать','сделать','которые','который','которая',
  'нет','да','ну','вот','там','тут','здесь','этом','этого','всё','все','весь','более','менее','этим','будто','например',
  'может','можн','пока','ничего','делаю','понимаю','знаю','пишу','писал','говорю','сказал','типа','пофиг','вообще','думаю',
  'чувствую','получается','значит','нормально','какой','какая','каков','чей','чья','кому','кого','кем','чем','чего',
  'однако','впрочем','конечно','наверное','пожалуй','видимо','кажется','действительно','именно','особенно',
  'должен','должна','должно','можно','нельзя','обязательно','наверняка','точно','вероятно',
  'вроде','того','общем','даже','дело','какие','такое','чуть','опять','добрый','выходной',
  'идёт','иду','шёл','пришёл','ушёл','пошёл','вернулся','поехал','пошли',
  'больше','меньше','лучше','хуже','первый','второй','последний','следующий','другой','разный',
  'заниматься','много','мало','хотя','которую','сделал','хорошо','каким','вечер','начинаю',
  'вечером','сессия','неделе','следующей','клиентов','аскезу','утром','ночью','проснулся',
  'почему','потому','этому','кроме','против','через','между','перед',
]);

function fallbackFromTexts(texts: string[]): { label: string; summary: string } {
  const freq = new Map<string, number>();
  const words = texts.join(' ').toLowerCase().match(/[а-яё]{3,}/gi) ?? [];
  for (const w of words) {
    if (STOPWORDS.has(w)) continue;
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w]) => w);
  const label = top.slice(0, 2).join(', ');
  const summary = top.length ? `Часто упоминается: ${top.join(', ')}.` : '';
  return { label, summary };
}


const NAME_ALIASES: Record<string, string[]> = {
  'саша': ['саша','сашу','саше','сашей','саш','александр','александра'],
  'юля': ['юля','юлю','юле','юлей','юленька','юлия'],
  'наташа': ['наташа','наташу','наталье','наташе','натальей','наталья'],
  'даша': ['даша','дашу','даше','дашей','дарья','дарьи'],
  'мама': ['мама','маму','маме','мамой','мать','матери'],
  'папа': ['папа','папу','папе','папой','отец','отца','отцу'],
};

function canonicalName(raw: string): string {
  const lower = raw.toLowerCase();
  for (const [canonical, forms] of Object.entries(NAME_ALIASES)) {
    if (forms.includes(lower)) return canonical.charAt(0).toUpperCase() + canonical.slice(1);
  }
  return raw;
}


let facetWriteLock: Promise<unknown> = Promise.resolve();

export function withFacetLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = facetWriteLock.then(fn);
  facetWriteLock = result.then(() => undefined, () => undefined);
  return result;
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

  async build(onProgress?: (p: FacetBuildProgress) => void): Promise<FacetBuildResult> {
    return withFacetLock(async () => {
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
    if (!haveTexts) return { ok: false, error: 'NO_CHUNK_TEXTS' };

    const taxonomy = await AITaxonomyService.getActive();
    const domainVecs: { id: string; label: string; vec: number[] }[] = [];
    for (const d of taxonomy) {
      const res = await AIService.embed({ content: d.seed });
      if (res.ok && res.vectors[0]) domainVecs.push({ id: d.id, label: d.label, vec: res.vectors[0] });
    }

    // B: self-tune each domain's threshold from this user's chunk-score
    // distribution (pure cosine simulation, no LLM) before assigning, so a
    // domain that over- or under-binds for this corpus is corrected.
    const totalNotesForTune = new Set(chunks.map(c => c.noteId)).size;
    const tuned = tuneThresholds(
      chunks.map(c => ({ noteId: c.noteId, vector: c.vector })),
      domainVecs.map(d => ({ id: d.id, vec: d.vec, threshold: taxonomy.find(ld => ld.id === d.id)?.threshold ?? DOMAIN_THRESHOLD })),
      totalNotesForTune,
    ).thresholds;
    // Persist tuned thresholds to the derived taxonomy (skip the hardcoded default).
    const storedTax = AITaxonomyService.getStored();
    if (storedTax && tuned.size > 0) {
      AITaxonomyService.save(storedTax.map(d => ({ ...d, threshold: tuned.get(d.id) ?? d.threshold ?? DOMAIN_THRESHOLD })));
    }

    // Assign each CHUNK to its matching domains. A chunk must earn a PRIMARY
    // (best domain passes its threshold) before any secondary membership — if
    // nothing passes, the chunk goes to leftover (→ discovered clusters) rather
    // than leaking into every weakly-near low-threshold domain. This kills the
    // over-binding seen on real data (partner swallowing 56/90 notes). When a
    // primary exists, secondaries still need to clear threshold + SECONDARY_BUMP.
    const SECONDARY_BUMP = 0.03;
    const domainData = new Map<string, { label: string; noteIds: Set<string>; primaryNoteIds: Set<string>; secondaryNoteIds: Set<string>; texts: string[]; chunkVecs: number[][] }>();
    const leftover: ChunkItem[] = [];
    for (const ch of chunks) {
      const scores = domainVecs.map(d => ({
        id: d.id, label: d.label, vec: d.vec,
        sim: cosineSimilarity(ch.vector, d.vec),
        threshold: tuned.get(d.id) ?? DOMAIN_THRESHOLD,
      }));
      const best = scores.reduce((a, b) => a.sim >= b.sim ? a : b);
      const bestPassed = best.sim >= best.threshold;
      let assigned = false;
      if (bestPassed) {
        let dd = domainData.get(best.id);
        if (!dd) { dd = { label: best.label, noteIds: new Set(), primaryNoteIds: new Set(), secondaryNoteIds: new Set(), texts: [], chunkVecs: [] }; domainData.set(best.id, dd); }
        dd.noteIds.add(ch.noteId);
        dd.primaryNoteIds.add(ch.noteId);
        if (ch.text) dd.texts.push(ch.text);
        dd.chunkVecs.push(ch.vector);
        assigned = true;
      }
      if (bestPassed) {
        for (const s of scores) {
          if (s.id === best.id) continue;
          if (s.sim >= s.threshold + SECONDARY_BUMP) {
            let dd = domainData.get(s.id);
            if (!dd) { dd = { label: s.label, noteIds: new Set(), primaryNoteIds: new Set(), secondaryNoteIds: new Set(), texts: [], chunkVecs: [] }; domainData.set(s.id, dd); }
            dd.noteIds.add(ch.noteId);
            dd.secondaryNoteIds.add(ch.noteId);
            if (ch.text) dd.texts.push(ch.text);
            dd.chunkVecs.push(ch.vector);
            assigned = true;
          }
        }
      }
      if (!assigned) {
        leftover.push({ noteId: ch.noteId, vector: ch.vector, text: ch.text });
      }
    }

    // Discover extra themes from leftover chunks.
    let discovered: { centroid: number[]; noteIds: string[]; texts: string[]; chunkCount: number }[] = [];
    if (leftover.length > 0) {
      const noteCount = new Set(leftover.map(c => c.noteId)).size;
      discovered = mergeSimilarClusters(clusterChunks(leftover, Math.min(suggestK(noteCount), MAX_DISCOVERED)), MERGE_THRESHOLD)
        .filter(c => c.noteIds.length >= MIN_FACET_NOTES);
    }

    // Build specs: domains (centroids from chunk vectors, not seeds) then discovered.
    const specs: FacetSpec[] = [];
    for (const d of domainVecs) {
      const dd = domainData.get(d.id);
      if (dd && dd.noteIds.size >= MIN_FACET_NOTES) {
        const centroid = dd.chunkVecs.length > 0
          ? normalize(dd.chunkVecs.reduce((acc, v) => acc.map((x, i) => x + (v[i] ?? 0)), new Array(dd.chunkVecs[0]!.length).fill(0) as number[]))
          : d.vec;
        specs.push({ label: dd.label, fixedLabel: true, noteIds: [...dd.noteIds], texts: dd.texts, centroid, chunkCount: dd.chunkVecs.length, primaryNoteIds: [...dd.primaryNoteIds], secondaryNoteIds: [...dd.secondaryNoteIds] });
      }
    }
    for (const c of discovered) {
      specs.push({ label: '', fixedLabel: false, noteIds: c.noteIds, texts: c.texts, centroid: c.centroid, chunkCount: c.chunkCount });
    }
    if (specs.length === 0) return { ok: false, error: 'NO_CLUSTERS' };
    specs.sort((a, b) => b.noteIds.length - a.noteIds.length);

    const docs = await db.getAll('documents');
    const docMap = new Map(docs.map(d => [d.id, d]));
    const totalNotes = new Set(chunks.map(c => c.noteId)).size;

    const summaries = await db.getAll('aiSummaries');
    const summaryMap = new Map(summaries.map(s => [s.documentId, s]));

    // PROF-7: Build person facets exclusively from LLM-extracted mentionedPeople
    // in summaries. The old regex-based extractPeopleFromChunks had too many
    // false positives (capitalized common words). mapChunksToPeople also removed
    // — name-to-chunk matching is now handled by the summary pipeline.
    const personNotes = new Map<string, { name: string; role: string; noteIds: string[] }>();
    for (const s of summaries) {
      for (const p of s.mentionedPeople ?? []) {
        if (!p.name || p.name.length < 2 || p.name.length > 30) continue;
        const canon = canonicalName(p.name);
        const key = canon.toLowerCase();
        let entry = personNotes.get(key);
        if (!entry) { entry = { name: canon, role: p.role, noteIds: [] }; personNotes.set(key, entry); }
        if (!entry.noteIds.includes(s.documentId)) entry.noteIds.push(s.documentId);
        if (p.role && !entry.role) entry.role = p.role;
      }
    }

    const totalSpecs = specs.length + [...personNotes.values()].filter(pn => pn.noteIds.length >= MIN_FACET_NOTES).length;
    const buildId = `${Date.now()}`;
    const facets: AIProfileFacet[] = [];

    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i]!;
      onProgress?.({ done: i + 1, total: totalSpecs });

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

      if (!spec.fixedLabel && (!llmOk || spec.noteIds.length > totalNotes * 0.4)) {
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
        primaryNoteIds: spec.primaryNoteIds ?? spec.noteIds,
        secondaryNoteIds: spec.secondaryNoteIds ?? [],
        noteCount: spec.noteIds.length,
        chunkCount: spec.chunkCount,
        firstAt: firstAt === Infinity ? 0 : firstAt,
        lastAt,
        updatedAt: Date.now(),
        buildId,
        insightDensity: spec.noteIds.length > 0
          ? spec.noteIds.filter(id => { const s = summaryMap.get(id); return s && (s.insights?.length ?? 0) > 0; }).length / spec.noteIds.length
          : 0,
      });
      await new Promise(r => setTimeout(r, LLM_DELAY_MS));
    }

    // Person facets.
    for (const [, pn] of personNotes) {
      if (pn.noteIds.length < MIN_FACET_NOTES) continue;
      onProgress?.({ done: facets.length + 1, total: totalSpecs });

      let firstAt = Infinity;
      let lastAt = 0;
      const texts: string[] = [];
      let personChunkCount = 0;
      for (const id of pn.noteIds) {
        const ts = docMap.get(id)?.lastSessionAt ?? 0;
        if (ts) { firstAt = Math.min(firstAt, ts); lastAt = Math.max(lastAt, ts); }
        for (const e of embeddings) {
          if (e.documentId === id) {
            texts.push(...(e.chunkTexts ?? []));
            personChunkCount += e.vectors?.length ?? 0;
          }
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
        primaryNoteIds: pn.noteIds,
        secondaryNoteIds: [],
        noteCount: pn.noteIds.length,
        chunkCount: personChunkCount,
        isPerson: true,
        firstAt: firstAt === Infinity ? 0 : firstAt,
        lastAt,
        updatedAt: Date.now(),
        buildId,
        insightDensity: pn.noteIds.length > 0
          ? pn.noteIds.filter(id => { const s = summaryMap.get(id); return s && (s.insights?.length ?? 0) > 0; }).length / pn.noteIds.length
          : 0,
      });
      await new Promise(r => setTimeout(r, LLM_DELAY_MS));
    }

    // Versioned build: save new facets BEFORE clearing old ones.
    const newFacets = facets;
    const newIds = new Set(newFacets.map(f => f.id));
    for (const f of newFacets) await db.put('aiProfileFacets', f);
    // Only delete old facets that weren't replaced
    const oldFacets = await db.getAll('aiProfileFacets');
    for (const f of oldFacets) {
      if (!newIds.has(f.id)) await db.delete('aiProfileFacets', f.id);
    }
    return { ok: true, count: newFacets.length };
    });
  },

  async incrementalUpdate(noteId: string): Promise<{ updated: number }> {
    return withFacetLock(async () => {
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
        if (bestSim >= PRIMARY_THRESHOLD) {
          if (!bestFacet.primaryNoteIds) bestFacet.primaryNoteIds = [];
          if (!bestFacet.primaryNoteIds.includes(noteId)) bestFacet.primaryNoteIds.push(noteId);
        } else {
          if (!bestFacet.secondaryNoteIds) bestFacet.secondaryNoteIds = [];
          if (!bestFacet.secondaryNoteIds.includes(noteId)) bestFacet.secondaryNoteIds.push(noteId);
        }
        // H6: proper weighted average using chunkCount instead of fixed 0.9/0.1 blend.
        const n = bestFacet.chunkCount ?? bestFacet.noteCount;
        if (bestFacet.centroid.length > 0 && n > 0) {
          const w = 1 / (n + 1);
          const blended = bestFacet.centroid.map((x, idx) => x * (1 - w) + (ch.vector[idx] ?? 0) * w);
          bestFacet.centroid = normalize(blended);
        } else {
          bestFacet.centroid = ch.vector.slice();
        }
        bestFacet.chunkCount = (bestFacet.chunkCount ?? n) + 1;
        bestFacet.dirty = true;
        dirty.add(bestFacet.id);
      }
    }

    const doc = (await db.getAll('documents')).find(d => d.id === noteId);
    const ts = doc?.lastSessionAt ?? Date.now();

    // L7: Only write dirty facets, not all.
    for (const f of facets) {
      if (dirty.has(f.id)) {
        if (ts < f.firstAt || !f.firstAt) f.firstAt = ts;
        if (ts > f.lastAt) f.lastAt = ts;
        await db.put('aiProfileFacets', f);
      }
    }

    return { updated: dirty.size };
    });
  },

  async resummarizeDirty(onProgress?: (p: FacetBuildProgress) => void): Promise<{ count: number }> {
    return withFacetLock(async () => {
    const db = await getLocalDb();
    const facets = await db.getAll('aiProfileFacets');
    const dirty = facets.filter(f => f.dirty);
    if (dirty.length === 0) return { count: 0 };

    // H3: Load embeddings ONCE, not per-facet.
    const allEmb = await AIEmbeddingService.getAll();
    let done = 0;

    for (const f of dirty) {
      onProgress?.({ done: ++done, total: dirty.length });

      const texts: string[] = [];
      for (const e of allEmb) {
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
      await new Promise(r => setTimeout(r, LLM_DELAY_MS));
    }

    return { count: dirty.length };
    });
  },
};
