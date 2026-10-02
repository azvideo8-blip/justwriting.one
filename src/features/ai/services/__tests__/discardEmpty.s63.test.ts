import { describe, it, expect, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { AIDialogueService } from '../AIDialogueService';
import { getLocalDb } from '../../../../core/storage/localDb';

// S-56 survivor (S-63): discardEmpty удаляет только действительно пустой диалог.
vi.mock('../../../../core/services/LocalStoreSyncService', () => ({
  LocalStoreSyncService: { scheduleStoreDelete: vi.fn(), scheduleStoreSync: vi.fn() },
}));

const dlg = (id: string, messages: { role: 'user' | 'assistant'; content: string; type?: 'chat' | 'system' }[]) =>
  ({ id, title: 't', personaId: 'editor', personaName: 'Р', personaEmoji: '✍️', createdAt: 1, updatedAt: 1, messages }) as never;

describe('S-56: AIDialogueService.discardEmpty', () => {
  it('keeps a dialogue with a real message, deletes one with only system/blank messages', async () => {
    const db = await getLocalDb();
    await db.put('aiDialogues', dlg('d-full', [{ role: 'user', content: 'привет', type: 'chat' }]));
    await db.put('aiDialogues', dlg('d-blank', [{ role: 'user', content: '   ', type: 'chat' }, { role: 'assistant', content: 'служебное', type: 'system' }]));

    await AIDialogueService.discardEmpty('d-full');
    await AIDialogueService.discardEmpty('d-blank');
    await AIDialogueService.discardEmpty('d-missing');

    expect(await db.get('aiDialogues', 'd-full'), 'диалог с репликой стёрт').toBeDefined();
    expect(await db.get('aiDialogues', 'd-blank')).toBeUndefined();
  });
});
