// Дейлик 19.11, подозрение 2: переименование/архивация/разархивация/удаление
// диалога при отказе базы молчали — необработанный промис, лист уже закрыт,
// тоста нет. Теперь отказ назван, промис не бросает.
// Мутация, на которой тест краснеет: убрать перехват в действиях менеджера.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const svc = vi.hoisted(() => ({
  list: vi.fn(async () => []),
  updateTitle: vi.fn(),
  archive: vi.fn(),
  unarchive: vi.fn(),
  delete: vi.fn(),
}));
vi.mock('../../services/AIDialogueService', () => ({ AIDialogueService: svc }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));

import { useDialogueManager } from '../useDialogueManager';

describe('действия с диалогом при отказе базы', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  const boom = () => Promise.reject(new Error('IDB down'));

  it.each([
    ['rename', (m: ReturnType<typeof useDialogueManager>) => m.handleRenameDialogue('d1', 'x'), () => svc.updateTitle.mockImplementation(boom)],
    ['archive', (m: ReturnType<typeof useDialogueManager>) => m.handleArchive('d1'), () => svc.archive.mockImplementation(boom)],
    ['unarchive', (m: ReturnType<typeof useDialogueManager>) => m.handleUnarchive('d1'), () => svc.unarchive.mockImplementation(boom)],
    ['delete', (m: ReturnType<typeof useDialogueManager>) => m.handleDelete('d1'), () => svc.delete.mockImplementation(boom)],
  ])('%s: ошибка названа, промис не бросает', async (_n, run, arrange) => {
    arrange();
    const notifyError = vi.fn();
    const { result } = renderHook(() => useDialogueManager({ confirmDialog: async () => true, notifyError }));
    await act(async () => { await expect(run(result.current)).resolves.toBeUndefined(); });
    expect(notifyError).toHaveBeenCalledWith('error_generic_action');
  });
});
