import { getLocalDb } from '../../../core/storage/localDb';
import type { AIProfileFacet } from '../../../core/storage/localDb';
import { AIProfileFacetBuilder, type FacetBuildProgress, type FacetBuildResult } from './AIProfileFacetBuilder';
import { AIProfileFacetSummarizer } from './AIProfileFacetSummarizer';
import { isExcludedFromAI, isPastedAttachmentId } from '../utils/isExcludedFromAI';
import { hiddenNoteIdsFromDocs } from '../utils/hiddenNoteIds';
import { dialogueFacetVisible } from '../utils/dialogueFacetVisibility';
import { reportError } from '../../../shared/errors/reportError';

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
    // DY6-2 (дейлик 2026-10-26, Н-2): при ff_dialogues_in_facets в грань кладутся
    // пересказы диалогов (`dialogueIds`), а страж смотрел только на `noteIds` —
    // то есть пересказ разговора о скрытой заметке уходил в контекст каждого хода.
    // То же правило, что chatContext/proactive.ts (`citesHidden`): диалог, чья
    // реплика ссылается на скрытую/удалённую/неразрешимую заметку или у которой
    // скрыта заметка-тема, — не источник видимой грани. Не прочитался список
    // диалогов («нет ответа») — грань с `dialogueIds` не видна; грань без них
    // остаётся на своём месте, страж не прячет всё подряд.
    const hiddenIdsRaw = hiddenNoteIdsFromDocs(docs);
    // S-63: «вставленный текст» живёт под id `pasted-<ts>`, строки в `documents`
    // у него нет и не будет — правило «заметки нет — нельзя» к нему не относится
    // (тот же вырез, что у истории чата `aiChatTransport.ts:278` и у
    // `attachedNoteAppendix`). Без него тема или цитата вставленного текста
    // прятала бы грань навсегда: пересборка — только по действию человека.
    const hiddenIds = {
      has: (id: string) => !isPastedAttachmentId(id) && hiddenIdsRaw.has(id),
      size: hiddenIdsRaw.size,
    };
    // Чтение списка диалогов нужно только если хоть одна грань на них ссылается:
    // при выключенном ff_dialogues_in_facets их не несёт ни одна, а `aiDialogues`
    // — самое большое ИИ-хранилище (замер: 300 диалогов ≈ 2,6 МБ).
    let dialogueVisible: (dialogueId: string) => boolean = () => false;
    if (all.some(f => (f.dialogueIds?.length ?? 0) > 0)) {
      try {
        const dialogues = await db.getAll('aiDialogues');
        const byDialogueId = new Map(dialogues.map(d => [d.id, d]));
        // DY6-3: правило — общая функция с продюсером граней, второй копии нет.
        dialogueVisible = (dialogueId: string): boolean => dialogueFacetVisible(byDialogueId.get(dialogueId), hiddenIds);
      } catch (e) {
        reportError(e, { action: 'facetProfile_dialoguesSnapshot_failed' });
      }
    }
    const visible = all.filter(f => f.noteIds.every(id => {
      const doc = byId.get(id);
      return !!doc && !isExcludedFromAI(doc);
    }) && (f.dialogueIds ?? []).every(dialogueVisible));
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
