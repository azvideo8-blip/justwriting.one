import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../../../core/storage/localDb';
import type { AIDialogue, DialogueMessage } from '../../../../core/storage/localDb';
import { mergeDialogues } from '../../../../core/storage/dialogueMerge';
import { AIDialogueService } from '../AIDialogueService';
import { AIChatMemoryService } from '../AIChatMemoryService';
import { LocalStoreSyncService } from '../../../../core/services/LocalStoreSyncService';

// S-57 (S-35/S-36 leftovers): писатели диалога, которые ещё обходили правила
// слияния, и правила, у которых не было теста, краснеющего при откате.

const extractChatMemory = vi.fn().mockResolvedValue({ ok: true, memories: [] });
vi.mock('../AIService', () => ({ AIService: { chat: vi.fn(), embed: vi.fn(), extractChatMemory: (...a: unknown[]) => extractChatMemory(...a) } }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../utils/aiDegradationReporter', () => ({ reportAIDegradation: vi.fn() }));
vi.mock('../../../../core/services/LocalStoreSyncService', () => ({
  LocalStoreSyncService: { scheduleStoreSync: vi.fn(), scheduleStoreDelete: vi.fn() },
}));

const NOW = 1_700_000_000_000;
const BASE = (): Omit<AIDialogue, 'id' | 'createdAt' | 'updatedAt'> => ({
  title: 'Т', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
  messages: [{ role: 'user', content: 'Вопрос один' }, { role: 'assistant', content: 'Ответ один' }],
});
const texts = (d: AIDialogue | undefined) => (d?.messages ?? []).map(x => x.content);
async function stored(id: string): Promise<AIDialogue> {
  return (await (await getLocalDb()).get('aiDialogues', id))!;
}
const clone = (d: AIDialogue) => JSON.parse(JSON.stringify(d)) as AIDialogue;

beforeEach(async () => {
  vi.clearAllMocks();
  await (await getLocalDb()).clear('aiDialogues');
});

describe('S-57: switchVariant targets the message by id', () => {
  it('switches the named message, not the last assistant message appended by another device', async () => {
    const d = await AIDialogueService.create(BASE());
    await AIDialogueService.replaceLastTurn(d.id, d.messages[0]!.id!, 'Вопрос один', 'Ответ один новый');
    await AIDialogueService.appendMessage(d.id, 'Вопрос с B', 'Ответ с B');
    const before = await stored(d.id);
    const regenerated = before.messages[1]!;
    expect(regenerated.variants).toEqual(['Ответ один', 'Ответ один новый']);

    await AIDialogueService.switchVariant(d.id, regenerated.id!, 0);

    const after = await stored(d.id);
    expect(after.messages[1]!.content).toBe('Ответ один');
    expect(after.messages[3]!.content, 'сменился чужой последний ответ').toBe('Ответ с B');
  });

  it('survivor: the switched message carries updatedAt, so the switch wins the merge against a stale copy', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(NOW);
      const db = await getLocalDb();
      const d: AIDialogue = {
        id: 'd_sw', title: 'Т', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯', createdAt: 1000, updatedAt: 2000,
        messages: [
          { id: 'u1', role: 'user', content: 'Вопрос', createdAt: 10 },
          // Тексты подобраны так, чтобы при равных updatedAt ничья по тексту выбрала СТАРУЮ копию.
          { id: 'a1', role: 'assistant', content: 'б', variants: ['б', 'а'], variantIndex: 0, createdAt: 11, turnId: 'u1' },
        ],
      };
      await db.put('aiDialogues', d);
      const stale = clone(d);

      vi.setSystemTime(NOW + 1000);
      await AIDialogueService.switchVariant('d_sw', 'a1', 1);
      const switched = await stored('d_sw');
      expect(switched.messages[1]!.content).toBe('а');

      expect(mergeDialogues(stale, switched, NOW + 2000).messages[1]!.content, 'смена варианта проиграла устаревшей копии').toBe('а');
      expect(mergeDialogues(switched, stale, NOW + 2000).messages[1]!.content).toBe('а');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('S-57: setPersona', () => {
  it('writes the persona and the system message in one transaction and schedules the upload', async () => {
    const d = await AIDialogueService.create(BASE());
    vi.mocked(LocalStoreSyncService.scheduleStoreSync).mockClear();

    const fresh = await AIDialogueService.setPersona(d.id, { personaId: 'friend', personaName: 'Друг', personaEmoji: '🙂' });

    const after = await stored(d.id);
    expect(after.personaId).toBe('friend');
    expect(after.messages.at(-1)).toMatchObject({ type: 'system', role: 'assistant' });
    expect(after.messages.at(-1)!.id, 'служебная реплика без id раздвоится при слиянии').toBeTruthy();
    expect(fresh?.messages.length).toBe(3);
    expect(LocalStoreSyncService.scheduleStoreSync).toHaveBeenCalledWith('aiDialogues', d.id);
  });
});

describe('S-57: regenerate survivors', () => {
  it('the regenerated answer carries updatedAt, so it wins the merge against a device still holding the old answer', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(NOW);
      const d = await AIDialogueService.create(BASE());
      const stale = clone(await stored(d.id));
      vi.setSystemTime(NOW + 1000);
      // Новый текст лексикографически меньше старого: ничья по тексту выбрала бы старый.
      await AIDialogueService.replaceLastTurn(d.id, d.messages[0]!.id!, 'Вопрос один', 'Ааа, новый ответ');
      const regenerated = await stored(d.id);

      expect(mergeDialogues(stale, regenerated, NOW + 2000).messages[1]!.content).toBe('Ааа, новый ответ');
      expect(mergeDialogues(regenerated, stale, NOW + 2000).messages[1]!.content).toBe('Ааа, новый ответ');
    } finally {
      vi.useRealTimers();
    }
  });

  it('earlier variants survive a second regeneration', async () => {
    const d = await AIDialogueService.create(BASE());
    await AIDialogueService.replaceLastTurn(d.id, d.messages[0]!.id!, 'Вопрос один', 'Ответ два');
    await AIDialogueService.replaceLastTurn(d.id, d.messages[0]!.id!, 'Вопрос один', 'Ответ три');
    expect((await stored(d.id)).messages[1]!.variants).toEqual(['Ответ один', 'Ответ два', 'Ответ три']);
  });

  it('create and appendMessage link the answer to its question through turnId', async () => {
    const d = await AIDialogueService.create(BASE());
    expect(d.messages[1]!.turnId).toBe(d.messages[0]!.id);
    await AIDialogueService.appendMessage(d.id, 'Вопрос два', 'Ответ два');
    const after = await stored(d.id);
    expect(after.messages[3]!.turnId).toBe(after.messages[2]!.id);
    expect(texts(after)).toEqual(['Вопрос один', 'Ответ один', 'Вопрос два', 'Ответ два']);
  });
});

describe('S-57: memory cursor', () => {
  function m(role: 'user' | 'assistant', id: string, content: string, createdAt: number): DialogueMessage {
    return { role, id, content, createdAt };
  }
  const MSGS = [
    m('user', 'u1', 'Вопрос один достаточной длины', 10), m('assistant', 'a1', 'Ответ один достаточной длины', 11),
    m('user', 'u2', 'Вопрос два достаточной длины', 20), m('assistant', 'a2', 'Ответ два достаточной длины', 21),
    m('user', 'u3', 'Вопрос три достаточной длины', 30), m('assistant', 'a3', 'Ответ три достаточной длины', 31),
  ];
  const dlg = (extra: Partial<AIDialogue>): AIDialogue => ({
    id: 'd_cur', title: 'Т', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯', createdAt: 1000, updatedAt: 2000,
    messages: MSGS.map(x => ({ ...x })), ...extra,
  });

  it('merge takes the cursor furthest along in the merged order, whichever copy is newer; commutative on a tie', () => {
    const behindButNewer = dlg({ lastExtractedMessageId: 'u1', updatedAt: 3000 });
    const ahead = dlg({ lastExtractedMessageId: 'u3', updatedAt: 2000 });
    expect(mergeDialogues(behindButNewer, ahead, NOW).lastExtractedMessageId, 'курсор откатился').toBe('u3');
    expect(mergeDialogues(ahead, behindButNewer, NOW).lastExtractedMessageId).toBe('u3');

    const tieA = dlg({ lastExtractedMessageId: 'u2', updatedAt: 2000 });
    const tieB = dlg({ lastExtractedMessageId: 'a2', updatedAt: 2000 });
    expect(mergeDialogues(tieA, tieB, NOW).lastExtractedMessageId).toBe(mergeDialogues(tieB, tieA, NOW).lastExtractedMessageId);
  });

  it('survivor: a legacy positional cursor is migrated to the id of that message before the window is cut', async () => {
    const db = await getLocalDb();
    await db.put('aiDialogues', dlg({ lastExtractedIdx: 4 }));
    // Окно без первых двух реплик: позиционный курсор 4 указывал бы в окне на другую реплику.
    const window = MSGS.slice(2).map(x => ({ role: x.role, content: x.content, id: x.id }));

    await AIChatMemoryService.extractFromDialogue('d_cur', window);

    const sent = (extractChatMemory.mock.calls[0]![0] as { messages: { content: string }[] }).messages.map(x => x.content);
    expect(sent, `нахлёст от позиционного курсора срезал начало окна: ${JSON.stringify(sent)}`).toContain('Вопрос два достаточной длины');
    const updated = await db.get('aiDialogues', 'd_cur');
    expect(updated?.lastExtractedMessageId).toBe('a3');
    expect(updated?.lastExtractedIdx).toBeUndefined();
  });
});
