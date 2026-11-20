// PIN-1 (дейлик 20.11): управление диалогами — отказ базы при переименовании/архивации называется ошибкой,
// список перечитывается (строка осталась на месте — так и показываем), чтение списка при сбое — ошибка, не «пусто».
// Мутации: убрать onFailure: loadDialogues (кейс 1: список не перечитан); подменить runMutation на голый вызов
// без тоста (кейс 1: тоста нет); поймать сбой чтения как «пусто» (кейс 2).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ list: vi.fn(), updateTitle: vi.fn(), archive: vi.fn(), showToast: vi.fn() }));
vi.mock('../../services/AIDialogueService', () => ({
  AIDialogueService: {
    list: (...a: unknown[]) => h.list(...a),
    updateTitle: (...a: unknown[]) => h.updateTitle(...a),
    archive: (...a: unknown[]) => h.archive(...a),
  },
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: h.showToast }) }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { useDialogueManager } from '../useDialogueManager';

const dlg = (id: string) => ({ id, title: `t${id}`, personaId: 'editor', createdAt: 1, updatedAt: 1, messages: [] });

describe('PIN-1: useDialogueManager', () => {
  beforeEach(() => { vi.clearAllMocks(); h.list.mockResolvedValue([dlg('a')]); });

  it('1. переименование отказало — error-тост и список перечитан', async () => {
    h.updateTitle.mockRejectedValue(new Error('MARKER_PIN1_IDB'));
    const { result } = renderHook(() => useDialogueManager({ confirmDialog: vi.fn(async () => true) }));
    await act(async () => { await result.current.loadDialogues(); });
    h.list.mockClear();
    await act(async () => { await result.current.handleRenameDialogue('a', 'новое имя'); });
    expect(h.showToast).toHaveBeenCalledWith(expect.any(String), 'error');
    expect(h.list).toHaveBeenCalled();
  });

  it('2. сбой чтения списка — состояние ошибки, не «пусто»', async () => {
    h.list.mockRejectedValue(new Error('MARKER_PIN1_READ'));
    const { result } = renderHook(() => useDialogueManager({ confirmDialog: vi.fn(async () => true) }));
    await act(async () => { await result.current.loadDialogues(); });
    await waitFor(() => expect(result.current.dialogueList.status).toBe('error'));
  });

  it('КОНТРОЛЬ: чтение удалось — data со списком', async () => {
    const { result } = renderHook(() => useDialogueManager({ confirmDialog: vi.fn(async () => true) }));
    await act(async () => { await result.current.loadDialogues(); });
    await waitFor(() => expect(result.current.dialogueList.status).toBe('data'));
  });
});
