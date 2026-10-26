// DY3-3 (а): сверка курсора извлечения памяти с сохранённым диалогом идёт через
// toApiContent с ТЕМИ ЖЕ parseOpts, что окно извлечения. Без опций ход со
// скрытой заметкой не совпадает по тексту, и курсор падает на позиционный
// (класс S-29: после слияния переизвлечёт или пропустит).
// Фальсификация: убрать parseOpts из сверки → красный.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb, type AIDialogue, type DialogueMessage } from '../../../../core/storage/localDb';
import { AIChatMemoryService } from '../AIChatMemoryService';

const extractChatMemory = vi.fn().mockResolvedValue({ ok: true, memories: [] });
vi.mock('../AIService', () => ({
  AIService: { extractChatMemory: (...a: unknown[]) => extractChatMemory(...a) },
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../utils/aiDegradationReporter', () => ({ reportAIDegradation: vi.fn() }));
vi.mock('../../../../core/services/LocalStoreSyncService', () => ({
  LocalStoreSyncService: { scheduleStoreSync: vi.fn(), scheduleStoreDelete: vi.fn() },
}));

const DID = 'd_dy33';
const HIDDEN = 'local_hidden_note';

function m(role: 'user' | 'assistant', id: string, content: string, createdAt: number): DialogueMessage {
  return { role, id, content, createdAt };
}

const attachedRaw = [
  `[#${HIDDEN} · 2026-01-01]`,
  '[Прикреплена заметка: "Секретное название"]',
  'Вопрос: как это пережить',
].join('\n');

describe('DY3-3(а): курсор памяти находит ход со скрытой заметкой', () => {
  beforeEach(async () => {
    extractChatMemory.mockClear();
    const db = await getLocalDb();
    for (const rec of await db.getAll('aiDialogues')) await db.delete('aiDialogues', rec.id);
  });

  it('совпадение по тексту — с теми же parseOpts, что окно извлечения', async () => {
    const db = await getLocalDb();
    const stored: AIDialogue = {
      id: DID, title: 'Т', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
      createdAt: 1000, updatedAt: 2000,
      lastExtractedMessageId: 'u_prev',
      messages: [
        m('user', 'u_prev', 'Прошлый вопрос достаточной длины', 10),
        m('assistant', 'a_prev', 'Прошлый ответ достаточной длины', 11),
        m('user', 'u_hidden', attachedRaw, 12),
      ],
    };
    await db.put('aiDialogues', stored);

    // Окно, как его отдаёт useAIChat: текст уже прогнан через toApiContent с
    // parseOpts, id реплик в окне нет (свежий ход).
    const { toApiContent } = await import('../../utils/aiChatTransport');
    const parseOpts = { hiddenCitationIds: new Set([HIDDEN, `uuid_${HIDDEN}`]) };
    const window = stored.messages.map(x => ({
      role: x.role,
      content: toApiContent(x.content, undefined, parseOpts),
    }));
    await AIChatMemoryService.extractFromDialogue(DID, window, parseOpts);

    const updated = await db.get('aiDialogues', DID);
    expect(updated?.lastExtractedMessageId, 'курсор — по id скрытого хода').toBe('u_hidden');
    expect(updated?.lastExtractedIdx).toBeUndefined();
  });
});
