// 20.11: обозреватель очереди при сбое чтения писал «очередь пуста». Теперь —
// ошибка с «Повторить». Мутация: в catch ставить 'done' — красный.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru' }) }));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../../../shared/components/ConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm: async () => true }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
const getAll = vi.hoisted(() => vi.fn());
vi.mock('../../../../core/storage/localDb', async (orig) => ({ ...(await orig<object>()), getLocalDb: async () => ({ getAll }) }));

import { QueueExplorer } from '../QueueExplorer';

describe('QueueExplorer: не прочиталось ≠ пусто', () => {
  it('сбой чтения — ошибка с «Повторить», не «очередь пуста»; повтор перечитывает', async () => {
    getAll.mockRejectedValueOnce(new Error('idb down')).mockResolvedValue([]);
    render(<QueueExplorer userId="u_q" />);
    await screen.findByRole('alert');
    expect(screen.queryByText('admin_queue_empty')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    await waitFor(() => expect(screen.getByText('admin_queue_empty')).toBeTruthy());
  });
});
