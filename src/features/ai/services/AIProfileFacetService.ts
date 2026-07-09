import { getLocalDb } from '../../../core/storage/localDb';
import type { AIProfileFacet } from '../../../core/storage/localDb';
import { AIProfileFacetBuilder, type FacetBuildProgress, type FacetBuildResult } from './AIProfileFacetBuilder';
import { AIProfileFacetSummarizer } from './AIProfileFacetSummarizer';

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
    return AIProfileFacetBuilder.build(onProgress);
  },

  async incrementalUpdate(noteId: string): Promise<{ updated: number }> {
    return AIProfileFacetBuilder.incrementalUpdate(noteId);
  },

  async resummarizeDirty(onProgress?: (p: FacetBuildProgress) => void): Promise<{ count: number }> {
    return AIProfileFacetSummarizer.resummarizeDirty(onProgress);
  },

  async summarizePending(onProgress?: (p: FacetBuildProgress) => void): Promise<{ done: number }> {
    return AIProfileFacetSummarizer.summarizePending(onProgress);
  },
};
