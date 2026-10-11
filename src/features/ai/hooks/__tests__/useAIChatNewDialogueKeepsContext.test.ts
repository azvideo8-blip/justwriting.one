import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChat } from '../useAIChat';
import { AIDialogueService } from '../../services/AIDialogueService';
import type { AIDialogue } from '../../../../core/storage/localDb';

// Аудит диалогов, раунд 2: у нового диалога id появляется после первого ответа,
// и смена null → id сбрасывала контекст разговора — второй ход терял найденные
// на первом заметки.

const resetSession = vi.fn();
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ language: 'ru', t: (k: string) => k }) }));
vi.mock('../../services/aiChatContext', () => ({
  useAIChatContext: () => ({
    buildContext: vi.fn(),
    getAttachedNote: vi.fn().mockReturnValue(null),
    setAttachedNote: vi.fn(),
    getMessageCount: vi.fn().mockReturnValue(0),
    incrementMessageCount: vi.fn(),
    resetSession,
  }),
}));

describe('новый диалог, получивший id, — тот же разговор', () => {
  beforeEach(() => resetSession.mockClear());

  it('null → id только что созданного диалога контекст не сбрасывает', () => {
    const { rerender } = renderHook(({ id }) => useAIChat(id, 'coach'), { initialProps: { id: null as string | null } });
    resetSession.mockClear(); // сброс при монтировании — не предмет теста
    rerender({ id: 'dlg-new' });
    expect(resetSession).not.toHaveBeenCalled();
  });

  it('переход на другой диалог и «Новый диалог» сбрасывают', () => {
    const { rerender } = renderHook(({ id }) => useAIChat(id, 'coach'), { initialProps: { id: 'dlg-a' as string | null } });
    resetSession.mockClear();
    rerender({ id: 'dlg-b' });
    expect(resetSession).toHaveBeenCalledTimes(1);
    rerender({ id: null });
    expect(resetSession).toHaveBeenCalledTimes(2);
  });
});

// Полный прогон под нагрузкой (2026-10-11): чтение диалога завершалось после
// размонтирования, setDialogue уходил в снесённое окружение — «window is not
// defined» и rc=1. В приложении то же опоздание при смене диалога клало под
// новый id диалог, с которого ушли.
describe('опоздавшее чтение диалога', () => {
  it('ответ по прошлому диалогу не перезаписывает текущий', async () => {
    const pending = new Map<string, (d: AIDialogue) => void>();
    const get = vi.spyOn(AIDialogueService, 'get').mockImplementation(id =>
      new Promise(resolve => pending.set(id, resolve as (d: AIDialogue) => void)));
    const dlg = (id: string) => ({ id, messages: [] }) as unknown as AIDialogue;
    const { result, rerender, unmount } = renderHook(({ id }) => useAIChat(id, 'coach'), { initialProps: { id: 'dlg-a' as string | null } });
    rerender({ id: 'dlg-b' });
    await act(async () => { pending.get('dlg-b')!(dlg('dlg-b')); });
    await act(async () => { pending.get('dlg-a')!(dlg('dlg-a')); });
    expect(result.current.dialogue?.id).toBe('dlg-b');
    unmount();
    get.mockRestore();
  });
});
