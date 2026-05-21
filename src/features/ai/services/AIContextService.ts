import { getLocalDb } from '../../../shared/lib/localDb';
import type { AIMessage } from './AIService';

export const AIContextService = {
  async get(documentId: string): Promise<AIMessage[]> {
    const db = await getLocalDb();
    const ctx = await db.get('aiContexts', documentId) as { messages: AIMessage[] } | undefined;
    return ctx?.messages ?? [];
  },

  async append(documentId: string, userMsg: string, assistantMsg: string): Promise<void> {
    const db = await getLocalDb();
    const existing = await db.get('aiContexts', documentId) as { messages: AIMessage[] } | undefined;
    const messages: AIMessage[] = [
      ...(existing?.messages ?? []),
      { role: 'user' as const, content: userMsg },
      { role: 'assistant' as const, content: assistantMsg },
    ].slice(-10);
    await db.put('aiContexts', { documentId, messages, updatedAt: Date.now() }, documentId);
  },

  async clear(documentId: string): Promise<void> {
    const db = await getLocalDb();
    await db.delete('aiContexts', documentId);
  },
};
