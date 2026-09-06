import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

/**
 * Стык между сейфом и очередью.
 *
 * Стор объявляет открытие сейфа событием, а не вызовом синхронизации: прямой
 * импорт замыкает модули в цикл. Из-за этого цепочка «сейф открылся →
 * карантинные задачи ожили» живёт в двух файлах, и её середина — та самая
 * подписка — ничем не проверялась бы. Молча оторванный слушатель выглядит
 * ровно как работающая программа: сейф открыт, задачи лежат мёртвыми, никто
 * не жалуется.
 */

const reviveLockedTasks = vi.fn(async () => 0);

vi.mock('../../core/services/SyncService', () => ({
  SyncService: { reviveLockedTasks, syncPending: vi.fn(async () => undefined) },
}));
vi.mock('../../features/auth/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'u1' } }),
}));
vi.mock('../../core/sync/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
vi.mock('../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const { SyncManager } = await import('../AppProviders');
const { VAULT_UNLOCKED_EVENT } = await import('../../core/crypto/useEncryptionStore');

describe('открытие сейфа оживляет карантинные задачи', () => {
  beforeEach(() => vi.clearAllMocks());

  it('подписка на событие стоит и срабатывает', async () => {
    render(<SyncManager />);

    window.dispatchEvent(new CustomEvent(VAULT_UNLOCKED_EVENT));

    expect(reviveLockedTasks, 'слушатель обязан позвать оживление').toHaveBeenCalled();
  });

  it('после размонтирования слушатель снят', async () => {
    const { unmount } = render(<SyncManager />);
    unmount();
    vi.clearAllMocks();

    window.dispatchEvent(new CustomEvent(VAULT_UNLOCKED_EVENT));

    expect(reviveLockedTasks, 'снятый слушатель не должен работать').not.toHaveBeenCalled();
  });
});
