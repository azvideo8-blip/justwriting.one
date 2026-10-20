import { getLocalDb } from '../../../core/storage/localDb';
import type { AIProfileFacet } from '../../../core/storage/localDb';
import { AIProfileFacetBuilder, type FacetBuildProgress, type FacetBuildResult } from './AIProfileFacetBuilder';
import { AIProfileFacetSummarizer } from './AIProfileFacetSummarizer';
import { isExcludedFromAI } from '../utils/isExcludedFromAI';

import type { CallAiOptions } from '../../../core/ai/callAi';
import { writeFacetStore } from '../../../core/services/facetLock';

export const AIProfileFacetService = {
  async getAll(): Promise<AIProfileFacet[]> {
    const db = await getLocalDb();
    const [all, docs] = await Promise.all([
      db.getAll('aiProfileFacets'),
      db.getAll('documents'),
    ]);
    // AP-3: интерфейс не показывает грань, пока в ней есть скрытая, корзинная
    // или уже удалённая заметка: её summary может дословно пересказывать
    // скрытое, а пересборка — только по действию человека.
    // Список читают и пути к ИИ (AIFacetJudgeService, черновик поста), поэтому
    // строго: грань видна, только если КАЖДАЯ её заметка нашлась на устройстве
    // видимой — по локальному номеру, uuid или облачному (проверка коммита
    // 8b1994ee: «номера нет — показываем» пропускал скрытое в промпт). Грани,
    // собранные на другом устройстве (его локальные номера), здесь не видны —
    // как и до AP-3.
    const byId = new Map<string, (typeof docs)[number]>();
    for (const d of docs) {
      byId.set(d.id, d);
      if (d.uuid) byId.set(d.uuid, d);
      if (d.linkedCloudId) byId.set(d.linkedCloudId, d);
    }
    const visible = all.filter(f => f.noteIds.every(id => {
      const doc = byId.get(id);
      return !!doc && !isExcludedFromAI(doc);
    }));
    visible.sort((a, b) => b.noteCount - a.noteCount);
    return visible;
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
