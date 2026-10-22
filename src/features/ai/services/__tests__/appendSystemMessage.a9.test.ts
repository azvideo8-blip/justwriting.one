// A9 (FN-2б): служебная строка в диалоге — об обрезке строгого хода. Одной
// транзакцией, type: 'system' (в API не уходит), надгробие не трогается.
// Мутация: писать и в надгробие → (b) красный.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'u_a9' }), getCurrentUserId: () => 'u_a9' }));
vi.mock('../../../../core/services/LocalStoreSyncService', () => ({ LocalStoreSyncService: { scheduleStoreSync: vi.fn() } }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { getLocalDb, type AIDialogue } from '../../../../core/storage/localDb';
import { AIDialogueService } from '../AIDialogueService';
import { LocalStoreSyncService } from '../../../../core/services/LocalStoreSyncService';

const dialogue = (id: string, extra: Partial<AIDialogue> = {}): AIDialogue => ({
  id, personaId: 'coach', personaName: 'Коуч', personaEmoji: '🙂', title: '',
  messages: [{ role: 'user', content: 'вопрос', type: 'chat' }], createdAt: 1, updatedAt: 1, ...extra,
}) as AIDialogue;

beforeEach(async () => {
  const db = await getLocalDb();
  await db.clear('aiDialogues');
  vi.mocked(LocalStoreSyncService.scheduleStoreSync).mockClear();
});

describe('A9: appendSystemMessage', () => {
  it('(a) дописывает системную строку и ставит диалог в выгрузку', async () => {
    const db = await getLocalDb();
    await db.put('aiDialogues', dialogue('d1'));
    await AIDialogueService.appendSystemMessage('d1', 'Модели ушло около 49000 из 60000 знаков — начало обрезано');
    const d = (await db.get('aiDialogues', 'd1'))!;
    expect(d.messages).toHaveLength(2);
    expect(d.messages[1]).toMatchObject({ role: 'assistant', type: 'system', content: expect.stringContaining('49000') });
    expect(LocalStoreSyncService.scheduleStoreSync).toHaveBeenCalledWith('aiDialogues', 'd1');
  });

  it('(b) надгробие и отсутствующий диалог не трогаются', async () => {
    const db = await getLocalDb();
    await db.put('aiDialogues', dialogue('gone', { deletedAt: 5 } as Partial<AIDialogue>));
    await AIDialogueService.appendSystemMessage('gone', 'x');
    await AIDialogueService.appendSystemMessage('nope', 'x');
    expect((await db.get('aiDialogues', 'gone'))!.messages).toHaveLength(1);
    expect(await db.get('aiDialogues', 'nope')).toBeUndefined();
    expect(LocalStoreSyncService.scheduleStoreSync).not.toHaveBeenCalled();
  });
});
