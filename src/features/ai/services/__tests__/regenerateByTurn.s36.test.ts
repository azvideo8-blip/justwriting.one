import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../../../core/storage/localDb';
import type { AIDialogue, DialogueMessage } from '../../../../core/storage/localDb';
import { mergeDialogues, withMessageIds } from '../../../../core/storage/dialogueMerge';
import { AIDialogueService } from '../AIDialogueService';

// S-36: перегенерация — правка хода на месте по id его вопроса, а не «вырезать
// последние два и дописать с новыми id». Прежний путь давал второй вопрос после
// служебной реплики и при перегенерации на двух устройствах, отдавал варианты
// чужому ходу и терял id старой реплики при смене варианта.

vi.mock('../AIService', () => ({ AIService: { chat: vi.fn(), embed: vi.fn(), extractChatMemory: vi.fn() } }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/services/LocalStoreSyncService', () => ({
  LocalStoreSyncService: { scheduleStoreSync: vi.fn(), scheduleStoreDelete: vi.fn() },
}));

const DID = 'd_s36';
const BASE = (): Omit<AIDialogue, 'id' | 'createdAt' | 'updatedAt'> => ({
  title: 'Т', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
  messages: [{ role: 'user', content: 'Вопрос один' }, { role: 'assistant', content: 'Ответ один' }],
});

const texts = (d: AIDialogue | undefined) => (d?.messages ?? []).map(x => x.content);
const count = (d: AIDialogue | undefined, text: string) => texts(d).filter(t => t === text).length;

async function stored(id: string): Promise<AIDialogue | undefined> {
  return (await getLocalDb()).get('aiDialogues', id);
}

beforeEach(async () => {
  const db = await getLocalDb();
  await db.clear('aiDialogues');
});

describe('S-36: regenerate keeps the turn in place and under its own ids', () => {
  it('after a response-length change the regenerated question is not duplicated; the system message stays after the turn', async () => {
    const d = await AIDialogueService.create(BASE());
    await AIDialogueService.updateResponseLength(d.id, 'short');
    const [u1, a1] = d.messages;

    await AIDialogueService.replaceLastTurn(d.id, u1!.id!, 'Вопрос один', 'Ответ один новый');

    const after = await stored(d.id);
    expect(count(after, 'Вопрос один'), `вопрос продублирован: ${JSON.stringify(texts(after))}`).toBe(1);
    expect(texts(after).slice(0, 2)).toEqual(['Вопрос один', 'Ответ один новый']);
    expect(after?.messages[2]?.type).toBe('system');
    expect(after?.messages.map(x => x.id).slice(0, 2), 'id хода сменились').toEqual([u1!.id, a1!.id]);
    expect(after?.messages[1]?.variants).toEqual(['Ответ один', 'Ответ один новый']);
    expect(after?.messages[1]?.variantIndex).toBe(1);
    expect(after?.deletedMessages ?? []).toEqual([]);
  });

  it('a turn appended by another tab does not receive the variants; the regenerated answer does, in place', async () => {
    const d = await AIDialogueService.create(BASE());
    await AIDialogueService.appendMessage(d.id, 'Вопрос два', 'Ответ два');

    await AIDialogueService.replaceLastTurn(d.id, d.messages[0]!.id!, 'Вопрос один', 'Ответ один новый');

    const after = await stored(d.id);
    expect(texts(after)).toEqual(['Вопрос один', 'Ответ один новый', 'Вопрос два', 'Ответ два']);
    expect(after?.messages[1]?.variants).toEqual(['Ответ один', 'Ответ один новый']);
    expect(after?.messages[3]?.variants, 'варианты достались чужому ходу').toBeUndefined();
  });

  it('the same turn regenerated on two devices merges into one question with the union of variants', async () => {
    const d = await AIDialogueService.create(BASE());
    const db = await getLocalDb();

    await AIDialogueService.replaceLastTurn(d.id, d.messages[0]!.id!, 'Вопрос один', 'Ответ с A');
    const onA = (await stored(d.id))!;
    await db.put('aiDialogues', d);
    await AIDialogueService.replaceLastTurn(d.id, d.messages[0]!.id!, 'Вопрос один', 'Ответ с B');
    const onB = (await stored(d.id))!;

    const merged = mergeDialogues(onA, onB);
    expect(count(merged, 'Вопрос один'), `вопрос дважды: ${JSON.stringify(texts(merged))}`).toBe(1);
    expect(merged.messages).toHaveLength(2);
    expect([...(merged.messages[1]!.variants ?? [])].sort()).toEqual(['Ответ один', 'Ответ с A', 'Ответ с B']);
    expect(merged.messages[1]!.variants).toContain(merged.messages[1]!.content);
  });

  it('regenerate on A + new turn on B: the regenerated turn stays ahead of B\'s turn', async () => {
    const d = await AIDialogueService.create(BASE());
    const db = await getLocalDb();

    await AIDialogueService.replaceLastTurn(d.id, d.messages[0]!.id!, 'Вопрос один', 'Ответ один новый');
    const onA = (await stored(d.id))!;
    await db.put('aiDialogues', d);
    await AIDialogueService.appendMessage(d.id, 'Вопрос два', 'Ответ два');
    const onB = (await stored(d.id))!;

    const merged = mergeDialogues(onA, onB);
    expect(texts(merged), 'перегенерированный ход уехал за ход B').toEqual(['Вопрос один', 'Ответ один новый', 'Вопрос два', 'Ответ два']);
  });

  it('switchVariant on a legacy message persists its derived id before editing, so the merge sees one message', async () => {
    const db = await getLocalDb();
    const legacy: AIDialogue = {
      id: DID, title: 'Т', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
      createdAt: 1000, updatedAt: 2000,
      messages: [
        { role: 'user', content: 'Вопрос' },
        { role: 'assistant', content: 'v1', variants: ['v1', 'v2'], variantIndex: 0 },
      ] as DialogueMessage[],
    };
    await db.put('aiDialogues', legacy);
    const idsBefore = withMessageIds(legacy).messages.map(x => x.id);
    const otherDevice = JSON.parse(JSON.stringify(legacy)) as AIDialogue;

    await AIDialogueService.switchVariant(DID, idsBefore[1]!, 1);

    const after = (await stored(DID))!;
    expect(after.messages[1]?.content).toBe('v2');
    expect(after.messages.map(x => x.id), 'id не сохранены до правки на месте').toEqual(idsBefore);

    const merged = mergeDialogues(after, otherDevice);
    expect(texts(merged), `реплика раздвоилась: ${JSON.stringify(texts(merged))}`).toEqual(['Вопрос', 'v2']);
  });
});
