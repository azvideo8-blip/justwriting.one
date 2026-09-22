import { getLocalDb } from '../../../core/storage/localDb';
import type { AIProfileFacet } from '../../../core/storage/localDb';
import { AIProfileFacetBuilder, type FacetBuildProgress, type FacetBuildResult } from './AIProfileFacetBuilder';
import { AIProfileFacetSummarizer } from './AIProfileFacetSummarizer';

import type { CallAiOptions } from '../../../core/ai/callAi';
import { withFacetLock, writeFacetStore } from '../../../core/services/facetLock';

// Ре-экспорт: часть кода импортирует лок отсюда исторически.
export { withFacetLock, writeFacetStore };


export const AIProfileFacetService = {
  async getAll(): Promise<AIProfileFacet[]> {
    const db = await getLocalDb();
    const all = await db.getAll('aiProfileFacets');
    all.sort((a, b) => b.noteCount - a.noteCount);
    return all;
  },

  async clear(): Promise<void> {
    await writeFacetStore(async (store) => {
      await store.clear();
    });
  },

  async build(onProgress?: (p: FacetBuildProgress) => void): Promise<FacetBuildResult> {
    return AIProfileFacetBuilder.build(onProgress);
  },

  async incrementalUpdate(noteId: string): Promise<{ updated: number }> {
    return AIProfileFacetBuilder.incrementalUpdate(noteId);
  },

  async resummarizeDirty(onProgress?: (p: FacetBuildProgress) => void, opts?: CallAiOptions): Promise<{ count: number }> {
    return AIProfileFacetSummarizer.resummarizeDirty(onProgress, opts);
  },

  async summarizePending(onProgress?: (p: FacetBuildProgress) => void, opts?: CallAiOptions): Promise<{ done: number }> {
    return AIProfileFacetSummarizer.summarizePending(onProgress, opts);
  },
};
