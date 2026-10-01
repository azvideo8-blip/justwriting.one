import { getLocalDb, type AIChatMemory, type AIDialogue, randomUUID } from '../../../core/storage/localDb';
import { MEMORY_EXTRACT_MAX_MESSAGES, MEMORY_EXTRACT_MAX_MESSAGE_CHARS, INTERNAL_CALL_MAX_INPUT_CHARS } from '../../../shared/ai/aiPolicy';
import { AIService } from './AIService';
import { cosineSimilarity } from '../utils/vectorSearch';
import { reportError } from '../../../shared/errors/reportError';
import { reportAIDegradation } from '../utils/aiDegradationReporter';
import { LocalStoreSyncService } from '../../../core/services/LocalStoreSyncService';
import { getCurrentUser } from '../../../core/auth';
import { hasIndexingConsent } from '../../../core/ai/indexingConsent';
import { withMessageIds } from '../utils/dialogueMerge';


type MemoryKind = 'fact' | 'insight' | 'commitment' | 'preference';

const VALID_KINDS: MemoryKind[] = ['fact', 'insight', 'commitment', 'preference'];

function coerceKind(kind: string): MemoryKind {
  return VALID_KINDS.includes(kind as MemoryKind) ? (kind as MemoryKind) : 'fact';
}

export const AIChatMemoryService = {
  async extractFromDialogue(dialogueId: string, messages: { role: string; content: string; type?: string | undefined }[]): Promise<void> {
    const userMessages = messages.filter(m => m.role === 'user' && m.content.trim().length > 10);
    if (userMessages.length < 2) return;

    try {
      const db = await getLocalDb();
      let dialogue: AIDialogue | undefined;
      try {
        const stored = await db.get('aiDialogues', dialogueId);
        dialogue = stored ? withMessageIds(stored) : undefined;
      } catch {
        // non-fatal if dialogue lookup fails in test or detached mode
      }

      // S-29: курсор — id последней извлечённой реплики, а не позиция. Позиция
      // ломалась, стоило слиянию вставить ход в середину: память либо молчала,
      // либо переизвлекала то, что уже извлечено. Старый индекс переживается в id
      // на месте, дальше курсор живёт только по id.
      const OVERLAP = 2;
      const legacyIdx = dialogue?.lastExtractedIdx ?? 0;
      const cursorId = dialogue?.lastExtractedMessageId
        ?? dialogue?.messages[legacyIdx]?.id
        ?? undefined;
      const storedAt = cursorId && dialogue ? dialogue.messages.findIndex(m => m.id === cursorId) : -1;
      // Хвост окна и хвост сохранённого диалога совпадают (последняя реплика
      // параметра — та же, что в базе), поэтому сдвиг считаем по длине.
      const shift = dialogue ? Math.max(0, dialogue.messages.length - messages.length) : 0;
      const startIdx = storedAt >= 0
        ? Math.max(0, storedAt - OVERLAP - shift)
        : Math.max(0, legacyIdx - OVERLAP);

      const candidateMessages = messages.slice(startIdx);
      const bounded = candidateMessages.length > MEMORY_EXTRACT_MAX_MESSAGES
        ? candidateMessages.slice(-MEMORY_EXTRACT_MAX_MESSAGES)
        : candidateMessages;

      // Пределы берутся из общей константы, а не переписываются здесь руками:
      // раньше схема на сервере разрешала 30, срез брал 40, а комментарий
      // обещал 50 — разговор длиннее тридцати реплик отлетал с «Invalid
      // payload», и память переставала извлекаться у тех, кто говорит много.
      //
      // Отбор по role, а не по type: схема проверяет именно role, и сообщение
      // с role:'system' проходило фильтр по type и валило запрос целиком.
      const recent = bounded
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({
          role: m.role,
          // Ответы ассистента обрезаются до 600 символов, пользовательские до MEMORY_EXTRACT_MAX_MESSAGE_CHARS
          content: m.role === 'assistant'
            ? m.content.slice(0, 600)
            : m.content.slice(0, MEMORY_EXTRACT_MAX_MESSAGE_CHARS),
        }));
      if (recent.length === 0) return;

      // DA-2: ограничить суммарный вход памяти до INTERNAL_CALL_MAX_INPUT_CHARS (4000)
      let totalChars = 0;
      const cappedRecent: typeof recent = [];
      for (let i = recent.length - 1; i >= 0; i--) {
        const msg = recent[i]!;
        if (totalChars + msg.content.length <= INTERNAL_CALL_MAX_INPUT_CHARS) {
          cappedRecent.unshift(msg);
          totalChars += msg.content.length;
        } else {
          const remaining = INTERNAL_CALL_MAX_INPUT_CHARS - totalChars;
          if (remaining > 50) {
            cappedRecent.unshift({ ...msg, content: msg.content.slice(0, remaining) });
          }
          break;
        }
      }
      if (cappedRecent.length === 0) return;

      const result = await AIService.extractChatMemory({ messages: cappedRecent });
      if (!result.ok) {
        reportAIDegradation({
          feature: 'chat_memory_extract',
          cause: result.error,
          action: 'Извлечение долговременных воспоминаний из диалога',
          impact: 'Новые воспоминания не извлечены',
        });
        return;
      }

      if (dialogue) {
        const lastSeen = dialogue.messages[Math.min(dialogue.messages.length - 1, messages.length - 1)];
        // Курсор по id, пока его удалось разглядеть; пока сохранённый диалог
        // короче переданного (detached-режим, тесты), остаётся позиционный.
        if (lastSeen?.id) {
          dialogue.lastExtractedMessageId = lastSeen.id;
          delete dialogue.lastExtractedIdx;
        } else {
          dialogue.lastExtractedIdx = messages.length;
        }
        await db.put('aiDialogues', dialogue);
        LocalStoreSyncService.scheduleStoreSync('aiDialogues', dialogue.id);
      }

      if (result.memories.length === 0) return;
      const now = Date.now();

      const existing = await db.getAll('aiChatMemory');
      const uid = getCurrentUser()?.uid;
      const canEmbed = uid ? hasIndexingConsent(uid) : false;

      for (const mem of result.memories) {
        // CHATFIX-3 fix: embed each memory separately. A single combined
        // embedding made all items share one vector, breaking per-memory
        // retrieval and dedup. Extraction is throttled to every 3rd turn, so
        // these few small embeds are cheap (and limit-exempt).
        let vector: number[] | undefined;
        if (canEmbed) {
          const embResult = await AIService.embed({ content: mem.text });
          if (!embResult.ok) {
            reportAIDegradation({
              feature: 'chat_memory_embed',
              cause: embResult.error,
              action: 'Построение вектора для воспоминания',
              impact: 'Воспоминание сохранено без вектора',
            });
          }
          vector = embResult.ok && embResult.vectors[0] ? embResult.vectors[0] : undefined;
        }

        let isDuplicate = false;
        if (vector) {
          for (const existingMem of existing) {
            if (existingMem.vector && cosineSimilarity(vector, existingMem.vector) > 0.92) {
              isDuplicate = true;
              if (mem.text.length > existingMem.text.length) {
                existingMem.text = mem.text;
                existingMem.updatedAt = now;
                existingMem.vector = vector;
                await db.put('aiChatMemory', existingMem);
                LocalStoreSyncService.scheduleStoreSync('aiChatMemory', existingMem.id);
              }
              break;
            }
          }
        }

        if (!isDuplicate) {
          const entry: AIChatMemory = {
            id: randomUUID(),
            kind: coerceKind(mem.kind),
            text: mem.text,
            sourceDialogueId: dialogueId,
            createdAt: now,
            updatedAt: now,
          };
          if (vector) entry.vector = vector;
          await db.put('aiChatMemory', entry);
          LocalStoreSyncService.scheduleStoreSync('aiChatMemory', entry.id);
          existing.push(entry);
        }
      }
    } catch (e) {
      reportError(e, { action: 'ai_chat_memory_extract' });
    }
  },

  // Store an explicit memory unit (e.g. from a 👍/👎 on an answer). Embedded so it
  // surfaces in future turns via getRelevant — feeds the preference layer directly.
  // Dedups: same kind + (identical trimmed text OR cosine>0.92) bumps updatedAt
  // instead of stacking a duplicate row.
  async addManual(kind: MemoryKind, text: string, sourceDialogueId?: string): Promise<void> {
    if (!text.trim()) return;
    try {
      const db = await getLocalDb();
      const now = Date.now();
      const trimmed = text.trim();
      const uid = getCurrentUser()?.uid;
      const canEmbed = uid ? hasIndexingConsent(uid) : false;
      const embResult = canEmbed ? await AIService.embed({ content: text }) : null;
      const vector = embResult?.ok && embResult.vectors[0] ? embResult.vectors[0] : undefined;

      const existing = await db.getAll('aiChatMemory');

      for (const existingMem of existing) {
        if (existingMem.kind !== kind) continue;
        const isTextDup = existingMem.text.trim() === trimmed;
        const isVectorDup = !!(vector && existingMem.vector && cosineSimilarity(vector, existingMem.vector) > 0.92);
        if (isTextDup || isVectorDup) {
          if (text.length > existingMem.text.length) {
            existingMem.text = text;
            if (vector) existingMem.vector = vector;
          }
          existingMem.updatedAt = now;
          await db.put('aiChatMemory', existingMem);
          LocalStoreSyncService.scheduleStoreSync('aiChatMemory', existingMem.id);
          return;
        }
      }

      const entry: AIChatMemory = {
        id: randomUUID(),
        kind,
        text,
        sourceDialogueId: sourceDialogueId ?? 'manual',
        createdAt: now,
        updatedAt: now,
      };
      if (vector) entry.vector = vector;
      await db.put('aiChatMemory', entry);
      LocalStoreSyncService.scheduleStoreSync('aiChatMemory', entry.id);
    } catch (e) {
      reportError(e, { action: 'ai_chat_memory_add_manual' });
    }
  },

  async getRelevant(queryVector: number[], k = 5): Promise<AIChatMemory[]> {
    const db = await getLocalDb();
    const all = await db.getAll('aiChatMemory');
    if (all.length === 0) return [];

    return all
      .filter(m => m.vector)
      .map(m => ({ m, sim: cosineSimilarity(queryVector, m.vector!) }))
      .sort((a, b) => b.sim - a.sim)
      .slice(0, k)
      .map(({ m }) => m);
  },

  async getAll(): Promise<AIChatMemory[]> {
    const db = await getLocalDb();
    return db.getAll('aiChatMemory');
  },

  // AX-8: Always retrieve preference-type memories (not by similarity) so 👍/👎
  // feedback reliably reaches the model's system prompt every turn.
  async getPreferences(): Promise<AIChatMemory[]> {
    const db = await getLocalDb();
    const all = await db.getAll('aiChatMemory');
    return all
      .filter(m => m.kind === 'preference')
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 5);
  },

  async delete(id: string): Promise<void> {
    const db = await getLocalDb();
    await db.delete('aiChatMemory', id);
    LocalStoreSyncService.scheduleStoreDelete('aiChatMemory', id);
  },

  async deleteAll(): Promise<void> {
    const db = await getLocalDb();
    const all = await db.getAll('aiChatMemory');
    await db.clear('aiChatMemory');
    for (const m of all) {
      LocalStoreSyncService.scheduleStoreDelete('aiChatMemory', m.id);
    }
  },

  async deleteByDialogue(dialogueId: string): Promise<void> {
    if (dialogueId === 'manual') return;
    const db = await getLocalDb();
    const tx = db.transaction('aiChatMemory', 'readwrite');
    const index = tx.store.index('by-dialogue');
    const keys = await index.getAllKeys(IDBKeyRange.only(dialogueId));
    for (const key of keys) {
      await tx.store.delete(key);
      LocalStoreSyncService.scheduleStoreDelete('aiChatMemory', String(key));
    }
    await tx.done;
  },

  // One-time cleanup: remove exact-duplicate entries (same kind + identical
  // trimmed text), keeping the newest. Returns how many were removed.
  async cleanupDuplicates(): Promise<number> {
    try {
      const db = await getLocalDb();
      const all = await db.getAll('aiChatMemory');

      const groups = new Map<string, AIChatMemory[]>();
      for (const mem of all) {
        const key = `${mem.kind}|${mem.text.trim()}`;
        const group = groups.get(key);
        if (group) group.push(mem);
        else groups.set(key, [mem]);
      }

      let removed = 0;
      for (const group of groups.values()) {
        if (group.length <= 1) continue;
        group.sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
        for (let i = 1; i < group.length; i++) {
          await db.delete('aiChatMemory', group[i]!.id);
          removed++;
        }
      }
      return removed;
    } catch (e) {
      reportError(e, { action: 'ai_chat_memory_cleanup_duplicates' });
      return 0;
    }
  },
};
