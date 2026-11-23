// DI-8: удаление диалога называет, сколько выводов уйдёт вместе с ним.
// Настоящий useDialogueManager; подменены края: список/удаление диалогов,
// чтение выводов (включая сбой), тосты, reportError. Мутация: считать все
// выводы, а не этого диалога — красный (в фикстуре есть вывод чужого диалога).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';

const h = vi.hoisted(() => ({ list: vi.fn(), del: vi.fn(), showToast: vi.fn(), report: vi.fn() }));
vi.mock('../../services/AIDialogueService', () => ({
  AIDialogueService: {
    list: (...a: unknown[]) => h.list(...a),
    delete: (...a: unknown[]) => h.del(...a),
  },
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: h.showToast }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: h.report }));

import { useDialogueManager } from '../useDialogueManager';
import { AIChatMemoryService } from '../../services/AIChatMemoryService';
import { LanguageProvider } from '../../../../shared/i18n';

const dlg = (id: string) => ({ id, title: `t${id}`, personaId: 'coach', createdAt: 1, updatedAt: 1, messages: [] });
const concl = (id: string, dialogueId: string) => ({
  id, kind: 'conclusion', text: `synthetic ${id}`, context: 'ctx',
  sourceDialogueId: dialogueId, sourceMessageId: 'm1', sourceDocumentIds: [],
  confirmedAt: 1, confirmedBy: 'reply', createdAt: 1, updatedAt: 1,
});
const OLD_TEXT = 'Действие необратимо.';
const COUNT_TEXT = 'Вместе с разговором удалятся сохранённые из него выводы: 2';

function wrapper({ children }: { children: ReactNode }) {
  return <LanguageProvider>{children}</LanguageProvider>;
}

describe('DI-8: удаление диалога называет выводы', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    h.list.mockResolvedValue([dlg('a')]);
    h.del.mockResolvedValue(undefined);
    localStorage.setItem('language', 'ru');
  });

  it('два вывода этого диалога → в подтверждении число 2; чужой вывод не считается', async () => {
    vi.spyOn(AIChatMemoryService, 'getConclusions').mockResolvedValue([
      concl('c1', 'a'), concl('c2', 'a'), concl('c3', 'other'),
    ] as never);
    const confirm = vi.fn(async () => true);
    const { result } = renderHook(() => useDialogueManager({ confirmDialog: confirm }), { wrapper });
    await act(async () => { await result.current.handleDelete('a'); });
    expect(confirm).toHaveBeenCalledWith({ title: 'Удалить диалог?', message: COUNT_TEXT });
    expect(h.del).toHaveBeenCalledWith('a');
    // Мутация: считать все выводы — красный (стало бы 3).
  });

  it('без выводов → прежний текст', async () => {
    vi.spyOn(AIChatMemoryService, 'getConclusions').mockResolvedValue([] as never);
    const confirm = vi.fn(async () => true);
    const { result } = renderHook(() => useDialogueManager({ confirmDialog: confirm }), { wrapper });
    await act(async () => { await result.current.handleDelete('a'); });
    expect(confirm).toHaveBeenCalledWith({ title: 'Удалить диалог?', message: OLD_TEXT });
  });

  it('сбой подсчёта → обычный текст, сбой в журнале, удаление не блокируется', async () => {
    vi.spyOn(AIChatMemoryService, 'getConclusions').mockRejectedValue(new Error('MARKER_DI8_COUNT'));
    const confirm = vi.fn(async () => true);
    const { result } = renderHook(() => useDialogueManager({ confirmDialog: confirm }), { wrapper });
    await act(async () => { await result.current.handleDelete('a'); });
    expect(confirm).toHaveBeenCalledWith({ title: 'Удалить диалог?', message: OLD_TEXT });
    expect(h.report).toHaveBeenCalled();
    expect(h.del).toHaveBeenCalledWith('a');
  });
});