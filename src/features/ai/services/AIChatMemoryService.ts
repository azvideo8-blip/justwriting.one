import { getLocalDb, type AIChatMemory, randomUUID } from '../../../core/storage/localDb';
import { AIService } from './AIService';
import { cosineSimilarity } from '../utils/vectorSearch';
import { reportError } from '../../../shared/errors/reportError';

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
      // Backend caps the array at 50 messages — send only the most recent chat
      // turns (a long dialogue would otherwise 400). Recent context is enough.
      const recent = messages.filter(m => m.type !== 'system').slice(-40);
      const result = await AIService.extractChatMemory({ messages: recent as { role: string; content: string }[] });
      if (!result.ok || result.memories.length === 0) return;

      const db = await getLocalDb();
      const now = Date.now();

      const existing = await db.getAll('aiChatMemory');

      for (const mem of result.memories) {
        // CHATFIX-3 fix: embed each memory separately. A single combined
        // embedding made all items share one vector, breaking per-memory
        // retrieval and dedup. Extraction is throttled to every 3rd turn, so
        // these few small embeds are cheap (and limit-exempt).
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
      reportError(e, { action: 'ai_chat_memory_extract' });
    }
  },

  // Store an explicit memory unit (e.g. from a 👍/👎 on an answer). Embedded so it
  // surfaces in future turns via getRelevant — feeds the preference layer directly.
  async addManual(kind: MemoryKind, text: string, sourceDialogueId?: string): Promise<void> {
    if (!text.trim()) return;
    try {
      const db = await getLocalDb();
      const now = Date.now();
      const embResult = await AIService.embed({ content: text });
      const vector = embResult.ok && embResult.vectors[0] ? embResult.vectors[0] : undefined;
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

  async deleteAll(): Promise<void> {
    const db = await getLocalDb();
    await db.clear('aiChatMemory');
  },
};
