// Решение владельца 2026-10-20 (AP-2, вариант «в»): старая память без источника
// видна в окне памяти с пометкой, ИИ её не получает, «вернуть в контекст» ставит
// отметку просмотра. Мутация: не показывать кнопку для старой памяти — красный.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const svc = vi.hoisted(() => ({
  memories: [] as Array<Record<string, unknown>>,
  markReviewed: vi.fn(async () => undefined),
}));
vi.mock('../../services/AIChatMemoryService', async () => {
  const actual = await vi.importActual<typeof import('../../services/AIChatMemoryService')>('../../services/AIChatMemoryService');
  return {
    ...actual,
    AIChatMemoryService: {
      getAll: async () => svc.memories,
      markReviewed: svc.markReviewed,
      delete: vi.fn(async () => undefined),
      deleteAll: vi.fn(async () => undefined),
    },
  };
});
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k, language: 'ru' }) }));
vi.mock('../../../../shared/components/ConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm: vi.fn(async () => true) }) }));

import { MemoryManagerModal } from '../MemoryManagerModal';

describe('окно памяти: старая память без источника', () => {
  beforeEach(() => {
    svc.markReviewed.mockClear();
    svc.memories = [
      { id: 'legacy', kind: 'fact', text: 'старая', sourceDialogueId: 'd1', createdAt: 2, updatedAt: 2 },
      { id: 'known', kind: 'fact', text: 'новая', sourceDialogueId: 'd2', createdAt: 1, updatedAt: 1, sourceDocumentIds: [] },
    ];
  });

  it('пометка и подсказка только у старой; «вернуть в контекст» ставит отметку', async () => {
    render(<MemoryManagerModal onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('старая')).toBeInTheDocument());
    expect(screen.getByTestId('memory-unreviewed-hint')).toBeInTheDocument();
    expect(screen.getAllByTestId('memory-unknown-source')).toHaveLength(1);
    const back = screen.getAllByRole('button', { name: 'ai_memory_return' });
    expect(back).toHaveLength(1);
    fireEvent.click(back[0]!);
    expect(svc.markReviewed).toHaveBeenCalledWith('legacy');
    await waitFor(() => expect(screen.queryByTestId('memory-unknown-source')).toBeNull());
  });
});
