import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb, type AIDialogue, type DialogueMessage } from '../../../../core/storage/localDb';
import { AIChatMemoryService } from '../AIChatMemoryService';

// S-29: курсор извлечения памяти — id реплики, а не позиция. Позиционный
// курсор после слияния (в хвост встал чужой ход) либо переизвлекал то, что уже
// извлечено, либо пропускал новые реплики.

const extractChatMemory = vi.fn().mockResolvedValue({ ok: true, memories: [] });

vi.mock('../AIService', () => ({
  AIService: { extractChatMemory: (...a: unknown[]) => extractChatMemory(...a) },
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../utils/aiDegradationReporter', () => ({ reportAIDegradation: vi.fn() }));
vi.mock('../../../../core/services/LocalStoreSyncService', () => ({
  LocalStoreSyncService: { scheduleStoreSync: vi.fn(), scheduleStoreDelete: vi.fn() },
}));

const DID = 'd_cursor';

function m(role: 'user' | 'assistant', id: string, content: string, createdAt: number): DialogueMessage {
  return { role, id, content, createdAt };
}

beforeEach(async () => {
  extractChatMemory.mockClear();
  const db = await getLocalDb();
  for (const rec of await db.getAll('aiDialogues')) await db.delete('aiDialogues', rec.id);
});

describe('S-29: memory cursor survives a merge', () => {
  it('does not re-extract the old prefix and does not skip the merged-in turn', async () => {
    const db = await getLocalDb();
    // Слияние вставило чужой ход (xb, ab) раньше уже извлечённого u2.
    const stored: AIDialogue = {
      id: DID, title: 'Т', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
      createdAt: 1000, updatedAt: 2000,
      lastExtractedMessageId: 'u2',
      messages: [
        m('user', 'u1', 'Вопрос один достаточной длины', 10),
        m('assistant', 'a1', 'Ответ один достаточной длины', 11),
        m('user', 'xb', 'Чужой вопрос из другой реплики', 12),
        m('assistant', 'ab', 'Чужой ответ из другой реплики', 13),
        m('user', 'u2', 'Вопрос два достаточной длины', 20),
        m('assistant', 'a2', 'Ответ два достаточной длины', 21),
      ],
    };
    await db.put('aiDialogues', stored);

    // Окно, как его передаёт useAIChat: без последнего ответа.
    const window = stored.messages.slice(0, 5).map(x => ({ role: x.role, content: x.content }));
    await AIChatMemoryService.extractFromDialogue(DID, window);

    const sent = extractChatMemory.mock.calls[0]![0] as { messages: { content: string }[] };
    const texts = sent.messages.map(x => x.content);
    expect(texts, `переизвлёк старый хвост: ${JSON.stringify(texts)}`).not.toContain('Вопрос один достаточной длины');
    expect(texts).toContain('Чужой вопрос из другой реплики');
    expect(texts).toContain('Вопрос два достаточной длины');

    const updated = await db.get('aiDialogues', DID);
    expect(updated?.lastExtractedMessageId).toBe('u2');
    expect(updated?.lastExtractedIdx).toBeUndefined();
  });
});
