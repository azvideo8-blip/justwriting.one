import { getLocalDb } from '../../../core/storage/localDb';
import { AIEmbeddingService } from './AIEmbeddingService';
import { AIService } from './AIService';
import { writeFacetStore } from '../../../core/services/facetLock';
import type { FacetBuildProgress } from './AIProfileFacetBuilder';
import { AIBackgroundBudget } from './AIBackgroundBudget';
import { LocalStoreSyncService } from '../../../core/services/LocalStoreSyncService';
import { loadVisibleNoteKeys } from '../utils/retrieval/docSnapshot';
import { reportError } from '../../../shared/errors/reportError';


import type { CallAiOptions } from '../../../core/ai/callAi';

const MAX_EXCERPTS = 14;
const EXCERPT_CHARS = 2_000;
const LLM_DELAY_MS = 200;

export const AIProfileFacetSummarizer = {
  async resummarizeDirty(onProgress?: (p: FacetBuildProgress) => void, opts?: CallAiOptions): Promise<{ count: number; failed: number }> {
    return writeFacetStore(async (facetStore) => {
      const db = await getLocalDb();
      const facets = await db.getAll('aiProfileFacets');
      const dirty = facets.filter(f => f.dirty);
      if (dirty.length === 0) return { count: 0, failed: 0 };

      let visibleKeys = await loadVisibleNoteKeys();
      let allEmb = (await AIEmbeddingService.getAll()).filter(e => visibleKeys.has(e.documentId));
      let done = 0;
      let summarizedCount = 0;
      let failedCount = 0;

      for (const f of dirty) {
        if (!AIBackgroundBudget.canSpend(1)) break;
        // Приёмка 0.10.6: видимость — заново перед каждой гранью: заметку могли
        // скрыть посреди прохода. Сбой чтения — проход останавливается.
        try {
          visibleKeys = await loadVisibleNoteKeys();
        } catch (e) {
          reportError(e, { action: 'facet_summarize_visibility_recheck' });
          break;
        }
        allEmb = allEmb.filter(e => visibleKeys.has(e.documentId));
        // Счёт вне `?.`: без подписчика аргументы не вычисляются и ++done не шёл.
        done++;
        onProgress?.({ done, total: dirty.length });

        const texts: string[] = [];
        for (const e of allEmb) {
          if (!f.noteIds.includes(e.documentId)) continue;
          for (const t of e.chunkTexts ?? []) {
            if (t.trim()) texts.push(t);
          }
        }

        const excerpts = texts.slice(0, MAX_EXCERPTS).map(t => ({ title: '(фрагмент)', excerpt: t.slice(0, EXCERPT_CHARS) }));
        // Keep `dirty` set when an actual summarization attempt failed, so the stale
        // summary is retried later. Clearing it unconditionally stranded the facet
        // with a summary that no longer reflects its notes.
        let resummarized = excerpts.length === 0;
        if (excerpts.length > 0) {
          const focus = f.noteIds.every(id => visibleKeys.has(id)) ? f.label : undefined;
          let res = await AIService.summarizeFacet({ notes: excerpts, focus }, ...(opts ? [opts] : []));
          if (!res.ok || (!res.label && !res.summary)) {
            await new Promise(r => setTimeout(r, 300));
            res = await AIService.summarizeFacet({ notes: excerpts, focus }, ...(opts ? [opts] : []));
          }
          if (res.ok && res.summary) {
            f.summary = res.summary;
            if (res.label && !f.label.startsWith('Отношения')) f.label = res.label;
            AIBackgroundBudget.spend(1);
            summarizedCount++;
            resummarized = true;
          }
        }

        if (!resummarized) failedCount++;
        f.dirty = !resummarized;
        f.updatedAt = Date.now();
        await facetStore.put(f);
        LocalStoreSyncService.scheduleStoreSync('aiProfileFacets', f.id);
        await new Promise(r => setTimeout(r, LLM_DELAY_MS));
      }

      // failed — грани, которые остались несвежими: отказ поставщика или проход
      // встал (бюджет, сбой чтения видимости). «Профиль обновлён» по ним — неправда.
      return { count: summarizedCount, failed: failedCount + (dirty.length - done) };
    });
  },

  async summarizePending(onProgress?: (p: FacetBuildProgress) => void, opts?: CallAiOptions): Promise<{ done: number; failed: number }> {
    return writeFacetStore(async (facetStore) => {
      const db = await getLocalDb();
      const facets = await db.getAll('aiProfileFacets');
      const pending = facets.filter(f => f.pendingSummary === true);
      if (pending.length === 0) return { done: 0, failed: 0 };

      let visibleKeys = await loadVisibleNoteKeys();
      let allEmb = (await AIEmbeddingService.getAll()).filter(e => visibleKeys.has(e.documentId));
      let done = 0;
      let summarizedCount = 0;
      let failedCount = 0;

      for (const f of pending) {
        if (!AIBackgroundBudget.canSpend(1)) break;
        // Приёмка 0.10.6: видимость — заново перед каждой гранью: заметку могли
        // скрыть посреди прохода. Сбой чтения — проход останавливается.
        try {
          visibleKeys = await loadVisibleNoteKeys();
        } catch (e) {
          reportError(e, { action: 'facet_summarize_visibility_recheck' });
          break;
        }
        allEmb = allEmb.filter(e => visibleKeys.has(e.documentId));
        // Счёт вне `?.`: без подписчика аргументы не вычисляются и ++done не шёл.
        done++;
        onProgress?.({ done, total: pending.length });

        let excerpts: { title: string; excerpt: string }[] = [];
        const sourcesVisible = f.noteIds.length > 0 && f.noteIds.every(id => visibleKeys.has(id));
        if (sourcesVisible && f._excerptSeed && f._excerptSeed.length > 0) {
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
          const focus = sourcesVisible && f.fixedLabel ? f.label : undefined;
          let res = await AIService.summarizeFacet({ notes: excerpts, focus }, ...(opts ? [opts] : []));
          if (!res.ok || (!res.label && !res.summary)) {
            await new Promise(r => setTimeout(r, 300));
            res = await AIService.summarizeFacet({ notes: excerpts, focus }, ...(opts ? [opts] : []));
          }
          if (res.ok && res.summary) {
            f.summary = res.summary;
            if (!f.fixedLabel && res.label) f.label = res.label;
            summarized = true;
            AIBackgroundBudget.spend(1);
            summarizedCount++;
          }
        }

        if (summarized) {
          f.pendingSummary = false;
        } else if (excerpts.length > 0) {
          // Отказ поставщика. Грань без выдержек — не отказ: суммировать нечего.
          failedCount++;
        }
        delete f._excerptSeed;
        f.updatedAt = Date.now();
        await facetStore.put(f);
        LocalStoreSyncService.scheduleStoreSync('aiProfileFacets', f.id);
        await new Promise(r => setTimeout(r, LLM_DELAY_MS));
      }

      return { done: summarizedCount, failed: failedCount + (pending.length - done) };
    });
  },
};
