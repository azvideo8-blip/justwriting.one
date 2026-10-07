import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChat } from '../useAIChat';
import { getLocalDb, type AIDialogue } from '../../../../core/storage/localDb';
import { AIDialogueService } from '../../services/AIDialogueService';

// Стенд, сценарий 6: смена персоны с другого устройства тут же перезаписывалась
// персоной, выбранной в открытом чате, — два чата перебивали друг друга вечно.

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ language: 'ru', t: (k: string) => k }) }));
vi.mock('../../services/aiChatContext', () => ({
  useAIChatContext: () => ({
    buildContext: vi.fn(),
    getAttachedNote: vi.fn().mockReturnValue(null),
    setAttachedNote: vi.fn(),
    getMessageCount: vi.fn().mockReturnValue(0),
    incrementMessageCount: vi.fn(),
    resetSession: vi.fn(),
  }),
}));

async function stored(id: string): Promise<AIDialogue> {
  return (await (await getLocalDb()).get('aiDialogues', id)) as AIDialogue;
}

describe('персона диалога: выбор пишется, синхронизация не перебивается', () => {
  let id = '';
  beforeEach(async () => {
    const db = await getLocalDb();
    for (const d of await db.getAll('aiDialogues')) await db.delete('aiDialogues', d.id);
    const d = await AIDialogueService.create({
      title: 'Диалог', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🚀',
      messages: [{ role: 'user', content: 'привет' }, { role: 'assistant', content: 'Привет!' }],
    });
    id = d.id;
  });

  it('персона, пришедшая с другого устройства, не перезаписывается выбором открытого чата', async () => {
    const setPersona = vi.spyOn(AIDialogueService, 'setPersona');
    const { result } = renderHook(() => useAIChat(id, 'coach'));
    await waitFor(() => expect(result.current.dialogue?.personaId).toBe('coach'));

    const db = await getLocalDb();
    await db.put('aiDialogues', { ...(await stored(id)), personaId: 'cbt', personaName: 'КПТ-психолог' });
    await act(async () => { window.dispatchEvent(new Event('dialogue-updated')); });
    await waitFor(() => expect(result.current.dialogue?.personaId).toBe('cbt'));
    await new Promise(r => setTimeout(r, 50));

    expect(setPersona).not.toHaveBeenCalled();
    expect((await stored(id)).personaId).toBe('cbt');
  });

  it('выбор персоны в этом чате записывается в диалог', async () => {
    const { rerender } = renderHook(({ p }) => useAIChat(id, p), { initialProps: { p: 'coach' } });
    await waitFor(async () => expect((await stored(id)).personaId).toBe('coach'));
    rerender({ p: 'cbt' });
    await waitFor(async () => expect((await stored(id)).personaId).toBe('cbt'));
  });
});
