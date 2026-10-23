import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../../../core/storage/localDb';
import { prepareApiMessages } from '../../utils/aiChatTransport';
import { hideExcludedNotes } from '../aiChatContext';
import { AIDialogueService } from '../AIDialogueService';
import { hiddenNoteIdsFromDocs } from '../../utils/hiddenNoteIds';

// Н-1 (дейлик 2026-10-23): заметку скрыли от ИИ — тело и ответы о ней в модель
// не шли, а название уходило маркером `[Прикреплена заметка: "…"]`: в истории,
// в блоке текущего хода и в итоговой сводке. Названия выдуманные.

const chat = vi.fn().mockResolvedValue({ ok: false, error: 'x' });
vi.mock('../AIService', () => ({ AIService: { chat: (...a: unknown[]) => chat(...a), embed: vi.fn(), extractChatMemory: vi.fn() } }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/services/LocalStoreSyncService', () => ({
  LocalStoreSyncService: { scheduleStoreSync: vi.fn(), scheduleStoreDelete: vi.fn() },
}));

const HIDDEN = 'local_n1_hidden';
const OPEN = 'local_n1_open';
const PASTED = 'pasted-1760000000000';
const TITLE = 'НАЗВАНИЕ_СКРЫТОЙ_N1';
const turn = (id: string, title: string, body: string) => `[#${id} · 2026-10-18]\n[Прикреплена заметка: "${title}"]\n${body}`;
const user = (content: string) => ({ role: 'user' as const, content, type: 'chat' as const });
const answer = (content: string) => ({ role: 'assistant' as const, content, type: 'chat' as const });
const hidden = { hiddenCitationIds: hiddenNoteIdsFromDocs([{ id: OPEN }]) };

describe('Н-1: название скрытой заметки не уходит в модель', () => {
  beforeEach(async () => {
    chat.mockClear();
    await (await getLocalDb()).clear('aiDialogues');
  });

  it('история: маркер прошлого хода без названия, видимая заметка того же хода — с названием', () => {
    const two = `${turn(OPEN, 'Открытая', 'ТЕЛО_О')}\n\n---\n\n${turn(HIDDEN, TITLE, 'ТЕЛО_С')}\n\n— — —\nВопрос: что скажешь?`;
    // Позже приложена другая заметка — ход с двумя заметками становится прошлым (DG-1).
    const out = prepareApiMessages([user(two), answer('ответ'), user(turn('local_n1_new', 'Новая', 'ТЕЛО_Н'))], hidden);
    expect(out[0]!.content).not.toContain(TITLE);
    expect(out[0]!.content).toContain('"Открытая"');
    // DG-1: видимая заметка прошлого хода по-прежнему с датой и пометкой.
    expect(out[0]!.content).toContain('· 2026-10-18 · текста этой заметки в этом ходе нет');
    expect(out[0]!.content).toContain('что скажешь?');
  });

  it('текущий ход: маркер скрытой заметки без названия; вставленный текст — с названием', () => {
    const out = prepareApiMessages([user(`${turn(HIDDEN, TITLE, 'ТЕЛО')}\n\n— — —\nВопрос: разбери`)], hidden);
    expect(out[0]!.content).not.toContain(TITLE);
    const pasted = prepareApiMessages([user(turn(PASTED, 'Вставленный', 'ТЕКСТ'))], hidden);
    expect(pasted[0]!.content).toContain('"Вставленный"');
  });

  it('блок заметки в контексте хода: у скрытой нет ни тела, ни названия', async () => {
    const db = { get: async (_s: string, id: string) => (id === HIDDEN ? { id, excludedFromAI: true } : { id }) } as unknown as Parameters<typeof hideExcludedNotes>[1];
    const out = await hideExcludedNotes(`${turn(OPEN, 'Открытая', 'ТЕЛО_О')}\n\n---\n\n${turn(HIDDEN, TITLE, 'ТЕЛО_С')}`, db);
    expect(out).not.toContain(TITLE);
    expect(out).not.toContain('ТЕЛО_С');
    expect(out).toContain('ТЕЛО_О');
    expect(out).toContain(`[#${HIDDEN} · 2026-10-18]`);
  });

  it('итоговая сводка диалога не несёт название скрытой заметки', async () => {
    const d = await AIDialogueService.create({
      title: 'Т', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
      messages: [
        user(`${turn(HIDDEN, TITLE, 'ТЕЛО')}\n\n— — —\nВопрос: разбери`), answer('Разбор один'),
        user('ещё'), answer('Разбор два'),
      ],
    });
    await AIDialogueService.generateClosingSummary(d.id);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(chat.mock.calls[0]![0])).not.toContain(TITLE);
  });
});
