import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../../../core/storage/localDb';
import type { AIDialogue } from '../../../../core/storage/localDb';
import { mergeDialogues } from '../../../../core/storage/dialogueMerge';
import { AIDialogueService } from '../AIDialogueService';

// S-45 (S-29): deleteMessage пишет отметку об удалении — без неё реплика,
// которую второе устройство ещё держит, возвращается при слиянии.

vi.mock('../AIService', () => ({ AIService: { chat: vi.fn(), embed: vi.fn(), extractChatMemory: vi.fn() } }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/services/LocalStoreSyncService', () => ({
  LocalStoreSyncService: { scheduleStoreSync: vi.fn(), scheduleStoreDelete: vi.fn() },
}));

beforeEach(async () => {
  await (await getLocalDb()).clear('aiDialogues');
});

describe('S-45: deleteMessage leaves a tombstone', () => {
  it('a message deleted on A while B still holds it and appends does not come back', async () => {
    const d = await AIDialogueService.create({
      title: 'Т', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
      messages: [{ role: 'user', content: 'Вопрос' }, { role: 'assistant', content: 'Ответ' }],
    });
    const onB = JSON.parse(JSON.stringify(d)) as AIDialogue;
    const db = await getLocalDb();

    await AIDialogueService.deleteMessage(d.id, d.messages[1]!.id!);
    const onA = (await db.get('aiDialogues', d.id))!;
    await db.put('aiDialogues', onB);
    await AIDialogueService.appendMessage(d.id, 'Вопрос с B', 'Ответ с B');
    const onBAfter = (await db.get('aiDialogues', d.id))!;

    const texts = mergeDialogues(onA, onBAfter).messages.map(x => x.content);
    expect(texts, `удалённая реплика вернулась: ${JSON.stringify(texts)}`).toEqual(['Вопрос', 'Вопрос с B', 'Ответ с B']);
  });
});
