import { getLocalDb, type AIChatMemory, randomUUID } from '../../../core/storage/localDb';
import { AIService } from './AIService';
import { cosineSimilarity } from '../utils/vectorSearch';

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
      const result = await AIService.extractChatMemory({ messages: messages.filter(m => m.type !== 'system') as { role: string; content: string }[] });
      if (!result.ok || result.memories.length === 0) return;

      const db = await getLocalDb();
      const now = Date.now();

      const existing = await db.getAll('aiChatMemory');

      for (const mem of result.memories) {
        const embResult = await AIService.embed({ content: mem.text });
        const vector = embResult.ok && embResult.vectors[0] ? embResult.vectors[0] : undefined;

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
          existing.push(entry);
        }
      }
    } catch (e) {
      console.warn('[AIChatMemoryService] extractFromDialogue failed:', e);
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

  async deleteAll(): Promise<void> {
    const db = await getLocalDb();
    await db.clear('aiChatMemory');
  },
};
