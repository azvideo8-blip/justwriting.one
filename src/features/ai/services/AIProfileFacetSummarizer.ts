import { getLocalDb } from '../../../core/storage/localDb';
import { AIEmbeddingService } from './AIEmbeddingService';
import { AIService } from './AIService';
import { withFacetLock } from './AIProfileFacetService';
import type { FacetBuildProgress } from './AIProfileFacetBuilder';

const MAX_EXCERPTS = 14;
const EXCERPT_CHARS = 2_000;
const LLM_DELAY_MS = 200;

export const AIProfileFacetSummarizer = {
  async resummarizeDirty(onProgress?: (p: FacetBuildProgress) => void): Promise<{ count: number }> {
    return withFacetLock(async () => {
      const db = await getLocalDb();
      const facets = await db.getAll('aiProfileFacets');
      const dirty = facets.filter(f => f.dirty);
      if (dirty.length === 0) return { count: 0 };

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

  async summarizePending(onProgress?: (p: FacetBuildProgress) => void): Promise<{ done: number }> {
    return withFacetLock(async () => {
      const db = await getLocalDb();
      const facets = await db.getAll('aiProfileFacets');
      const pending = facets.filter(f => f.pendingSummary === true);
      if (pending.length === 0) return { done: 0 };

      const allEmb = await AIEmbeddingService.getAll();
      let done = 0;

      for (const f of pending) {
        onProgress?.({ done: ++done, total: pending.length });

        let excerpts: { title: string; excerpt: string }[] = [];
        if (f._excerptSeed && f._excerptSeed.length > 0) {
          excerpts = f._excerptSeed.map(t => ({ title: '(фрагмент)', excerpt: t }));
        } else {
          const texts: string[] = [];
          for (const e of allEmb) {
            if (!f.noteIds.includes(e.documentId)) continue;
            for (const t of e.chunkTexts ?? []) {
              if (t.trim()) texts.push(t);
            }
          }
          excerpts = texts.slice(0, MAX_EXCERPTS).map(t => ({ title: '(фрагмент)', excerpt: t.slice(0, EXCERPT_CHARS) }));
        }

        let summarized = false;
        if (excerpts.length > 0) {
          const focus = f.isPerson ? f.label : (f.fixedLabel ? f.label : undefined);
          let res = await AIService.summarizeFacet({ notes: excerpts, focus });
          if (!res.ok || (!res.label && !res.summary)) {
            await new Promise(r => setTimeout(r, 300));
            res = await AIService.summarizeFacet({ notes: excerpts, focus });
          }
          if (res.ok && res.summary) {
            f.summary = res.summary;
            if (!f.fixedLabel && !f.isPerson && res.label) f.label = res.label;
            summarized = true;
          }
        }

        if (summarized) {
          f.pendingSummary = false;
        }
        delete f._excerptSeed;
        f.updatedAt = Date.now();
        await db.put('aiProfileFacets', f);
        await new Promise(r => setTimeout(r, LLM_DELAY_MS));
      }

      return { done };
    });
  },
};
