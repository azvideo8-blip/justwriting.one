import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChatContext } from '../aiChatContext';
import { AIProfileService } from '../AIProfileService';
import { getLocalDb } from '../../../../core/storage/localDb';
import { useAiLimitStore } from '../../store/useAiLimitStore';

// Ревью 0.11.24 (NB-12): getPortrait больше не глушит отказ чтения — экрану портрета
// нужен error. Ход чата из-за этого не падает: идёт без портрета. Чтение портрета —
// настоящее (getPortrait), отказ — у IndexedDB на сторе aiPortrait.
// Мутация: убрать обработчик отказа у getPortrait в buildContext — buildContext
// отклоняется, красный.

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

describe('NB-12: отказ чтения портрета не роняет ход чата', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAiLimitStore.setState({ remaining: 10, limit: 10, used: 0, resetsAt: new Date(Date.now() + 100_000), loaded: true, isAdmin: false });
  });

  it('IndexedDB отказал на портрете — buildContext собирается без портрета', async () => {
    const db = await getLocalDb();
    const orig = db.get.bind(db);
    vi.spyOn(db, 'get').mockImplementation((async (store: string, id: string) => {
      if (store === 'aiPortrait') throw new Error('IDB portrait read refused');
      return orig(store as never, id as never);
    }) as never);
    await expect(AIProfileService.getPortrait()).rejects.toThrow('IDB portrait read refused');

    const { result } = renderHook(() => useAIChatContext('coach'));
    const ctx = await result.current.buildContext({
      text: 'Как прошёл день?', attached: null, mood: undefined, messageHistory: [], isFirstTurn: true,
    });
    expect(ctx).toBeDefined();
  });
});
