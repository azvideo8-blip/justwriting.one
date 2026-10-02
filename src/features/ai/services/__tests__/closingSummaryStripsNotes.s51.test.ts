import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../../../core/storage/localDb';
import { AIDialogueService } from '../AIDialogueService';

// S-51: итоговое резюме при архивации отправляло реплики как есть — вместе с
// телом приложенной заметки и без проверки «скрыта от ИИ».

const chat = vi.fn().mockResolvedValue({ ok: false, error: 'x' });
vi.mock('../AIService', () => ({ AIService: { chat: (...a: unknown[]) => chat(...a), embed: vi.fn(), extractChatMemory: vi.fn() } }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/services/LocalStoreSyncService', () => ({
  LocalStoreSyncService: { scheduleStoreSync: vi.fn(), scheduleStoreDelete: vi.fn() },
}));

beforeEach(async () => {
  chat.mockClear();
  await (await getLocalDb()).clear('aiDialogues');
});

describe('S-51: closing summary goes through the same content filter as the chat history', () => {
  it('attached note bodies (new and legacy shape) are not sent to the model', async () => {
    const d = await AIDialogueService.create({
      title: 'Т', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
      messages: [
        { role: 'user', content: '[#local_1 · 2026-01-01]\n[Прикреплена заметка: "Новая"]\nSECRET_NEW\n\n— — —\nВопрос: разбери' },
        { role: 'assistant', content: 'Разбор один' },
        { role: 'user', content: '[Прикреплена заметка: "Старая"]\n\nSECRET_OLD\n\n— — —\nВопрос: и это' },
        { role: 'assistant', content: 'Разбор два' },
      ],
    });

    await AIDialogueService.generateClosingSummary(d.id);

    expect(chat).toHaveBeenCalledTimes(1);
    const sent = JSON.stringify((chat.mock.calls[0]![0] as { messages: unknown[] }).messages);
    expect(sent).not.toContain('SECRET_NEW');
    expect(sent).not.toContain('SECRET_OLD');
    expect(sent).toContain('разбери');
    expect(sent).toContain('Разбор два');
  });
});
