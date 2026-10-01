import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const { showToast, syncPending } = vi.hoisted(() => ({ showToast: vi.fn(), syncPending: vi.fn() }));

vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));
vi.mock('../../../../shared/components/ConfirmDialog', () => ({ useConfirmDialog: () => vi.fn() }));
vi.mock('../../../../app/useAuthStatus', () => ({ useAuthStatus: () => ({ user: null }) }));
vi.mock('../../../../core/services/SyncService', () => ({ SyncService: { syncPending } }));
// Монтирование хука ходит в облако, которого здесь нет; ошибки уходили в
// console.error уже после конца теста, и vitest на CI засчитывал прогон
// красным («Closing rpc while onUserConsoleLog was pending»).
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { useSyncDiagnostics } from '../useSyncDiagnostics';

// Сейф заперт: заметки ждут ключа. «Очередь пуста» зелёным было бы ложью —
// дренаж вернул 0 выгружено и 0 сбоев именно потому, что ничего не пробовал.
describe('ручная синхронизация очереди при запертом сейфе', () => {
  it('говорит «сейф заперт», а не «очередь пуста»', async () => {
    syncPending.mockResolvedValue({ drained: 0, failed: 0, skippedReason: 'vault_locked' });
    const { result, unmount } = renderHook(() => useSyncDiagnostics({ userId: 'u_diag' }));
    showToast.mockClear();
    // Не ждём обновления списка после тоста: оно ходит в облако, которого здесь нет.
    act(() => { void result.current.handleSyncAllQueue(); });
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('settings_sync_vault_locked', 'error'));
    expect(showToast).not.toHaveBeenCalledWith('sync_queue_empty', 'success');
    unmount();
  });
});
