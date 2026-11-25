import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { STORAGE_KEYS } from '../../shared/constants/storageKeys';

const pullNotes = vi.fn(async () => ({ downloaded: 1, reconciled: 0, skipped: 0, corrupted: 0, failed: 0, documentsRev: 1, versionsRev: 1 }));
const syncPending = vi.fn(async () => undefined);
const reviveLockedTasks = vi.fn(async () => 0);

vi.mock('../../core/services/SyncService', () => ({
  SyncService: { pullNotes, syncPending, reviveLockedTasks },
}));

let mockOnline = false;
vi.mock('../../shared/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockOnline,
}));

vi.mock('../../features/auth/hooks/useAuthStatus', () => ({
  useAuthStatus: () => ({ user: { uid: 'u_sync_test' } }),
}));

const { SyncManager } = await import('../AppProviders');
const { VAULT_UNLOCKED_EVENT } = await import('../../core/crypto/useEncryptionStore');

describe('SyncManager triggers pullNotes (S1-7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED('u_sync_test'), 'true');
    mockOnline = false;
  });

  it('triggers pullNotes on mount when user is authenticated and autoSync is enabled', async () => {
    render(<SyncManager />);
    // N-2: движок синка приходит динамическим импортом — ждём вызова, а не кадра.
    await vi.waitFor(() => expect(pullNotes).toHaveBeenCalledWith('u_sync_test'));
  });

  it('triggers pullNotes on online recovery', async () => {
    mockOnline = false;
    const { rerender } = render(<SyncManager />);
    // N-2: смонтированный проход уже ждёт динамический импорт движка; даём ему
    // дойти, иначе он разрешится внутри следующего замера и собьёт порядок.
    await new Promise(r => setTimeout(r, 50));
    vi.clearAllMocks();

    mockOnline = true;
    rerender(<SyncManager />);

    // N-2: оба вызова теперь идут из одного `.then` после динамического импорта
    // движка, поэтому ждём их вместе — порядок внутри прохода не проверяется.
    // D-22: автоматический проход не форсирует отправку — при выключенной
    // синхронизации в облако не уходит ничего; решает сам syncPending.
    await vi.waitFor(() => {
      expect(syncPending).toHaveBeenCalledWith('u_sync_test');
      expect(pullNotes).toHaveBeenCalledWith('u_sync_test');
    });
  });

  it('triggers pullNotes on vault unlocked event', async () => {
    render(<SyncManager />);
    vi.clearAllMocks();

    window.dispatchEvent(new CustomEvent(VAULT_UNLOCKED_EVENT));
    await new Promise((r) => setTimeout(r, 0));

    expect(pullNotes).toHaveBeenCalledWith('u_sync_test');
  });

  // Дейлик 25.11: настройка старого вида (без uid) читается тем же чтением, что у
  // отправки. Мутация: localStorage напрямую по ключу аккаунта — забора нет, красный.
  it('настройка старого вида: забор на входе есть', async () => {
    localStorage.clear();
    localStorage.setItem(STORAGE_KEYS.LEGACY_AUTO_SYNC_ENABLED, 'true');
    render(<SyncManager />);
    await vi.waitFor(() => expect(pullNotes).toHaveBeenCalledWith('u_sync_test'));
  });
});
