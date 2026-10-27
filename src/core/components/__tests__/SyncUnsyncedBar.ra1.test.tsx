// RA1-4: «Не синхронизировано: N · Повторить» рядом с редактором. Один
// компонент на главный (десктоп/телефон) и рейку.
// BR-2: повтор — обычная очередь без force: полоса показывается только когда
// синхронизация включена, и человек, выбравший «только на устройстве», не
// должен получать выгрузку в облако по кнопке с невинной подписью.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SyncUnsyncedBar } from '../SyncUnsyncedBar';

const mockSyncStatus = vi.fn();
vi.mock('../../sync/useSyncStatus', () => ({
  useSyncStatus: (uid: string | null) => mockSyncStatus(uid),
}));

const mockSyncPending = vi.fn();
vi.mock('../../services/SyncService', () => ({
  SyncService: { syncPending: (...a: unknown[]) => mockSyncPending(...a) },
}));

vi.mock('../../../shared/i18n', () => ({
  useLanguage: () => ({
    t: (k: string, p?: Record<string, string | number>) => (p?.count !== undefined ? `${k}:${p.count}` : k),
    tp: (k: string) => k,
    language: 'ru',
  }),
}));

function status(overrides: Record<string, unknown> = {}) {
  return {
    status: 'unsynced',
    unsyncedCount: 2,
    pendingCount: 0,
    autoSyncEnabled: true,
    loaded: true,
    ...overrides,
  };
}

describe('RA1-4: строка «Не синхронизировано» с повтором', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSyncStatus.mockReturnValue(status());
    mockSyncPending.mockResolvedValue({ drained: 2, failed: 0 });
  });

  it('unsynced > 0: строка видна, счётчик и «Повторить»', () => {
    render(<SyncUnsyncedBar userId="u1" />);
    expect(screen.getByTestId('sync-unsynced-bar')).toBeInTheDocument();
    expect(screen.getByText('sync_unsynced_compact:2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'sync_retry' })).toBeInTheDocument();
  });

  it('синхронизировано — строки нет', () => {
    mockSyncStatus.mockReturnValue(status({ status: 'synced', unsyncedCount: 0 }));
    render(<SyncUnsyncedBar userId="u1" />);
    expect(screen.queryByTestId('sync-unsynced-bar')).toBeNull();
  });

  it('гостю строки нет', () => {
    render(<SyncUnsyncedBar userId={null} />);
    expect(screen.queryByTestId('sync-unsynced-bar')).toBeNull();
  });

  // BR-2 (приватность): «только на устройстве» — человек не выбрал облако.
  it('синхронизация выключена — строки нет, хотя в очереди N', () => {
    mockSyncStatus.mockReturnValue(status({ status: 'sync_off', autoSyncEnabled: false }));
    render(<SyncUnsyncedBar userId="u1" />);
    expect(screen.queryByTestId('sync-unsynced-bar')).toBeNull();
  });

  it('синхронизация выключена — «Повторить» нечего звать', async () => {
    mockSyncStatus.mockReturnValue(status({ status: 'sync_off', autoSyncEnabled: false }));
    render(<SyncUnsyncedBar userId="u1" />);
    expect(screen.queryByRole('button', { name: 'sync_retry' })).toBeNull();
    expect(mockSyncPending).not.toHaveBeenCalled();
  });

  it('«Повторить» зовёт syncPending без force', async () => {
    render(<SyncUnsyncedBar userId="u1" />);
    fireEvent.click(screen.getByRole('button', { name: 'sync_retry' }));
    await waitFor(() => {
      expect(mockSyncPending).toHaveBeenCalledWith('u1');
    });
  });

  it('ошибка повтора — честный текст, не «готово»', async () => {
    mockSyncPending.mockRejectedValueOnce(new Error('offline'));
    render(<SyncUnsyncedBar userId="u1" />);
    fireEvent.click(screen.getByRole('button', { name: 'sync_retry' }));
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('sync_retry_failed');
    });
  });

  it('проход с ошибками тоже не выдаётся за «готово»', async () => {
    mockSyncPending.mockResolvedValueOnce({ drained: 0, failed: 2 });
    render(<SyncUnsyncedBar userId="u1" />);
    fireEvent.click(screen.getByRole('button', { name: 'sync_retry' }));
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('sync_retry_failed');
    });
  });

  // Дейлик 27.10 Н-2: сейф заперт — движок ничего не отправил (failed: 0,
  // skippedReason: 'vault_locked'), а строка обещала повтор и не менялась.
  // Мутация: убрать ветку по skippedReason → два красных.
  it('сейф заперт — после «Повторить» строка называет причину', async () => {
    mockSyncPending.mockResolvedValue({ drained: 0, failed: 0, skippedReason: 'vault_locked' });
    render(<SyncUnsyncedBar userId="u1" />);
    fireEvent.click(screen.getByRole('button', { name: 'sync_retry' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('vault_locked_banner_compact'));
  });

  it('нет сети по ответу движка — «приостановлена (нет сети)», хотя статус ещё не офлайн', async () => {
    mockSyncPending.mockResolvedValue({ drained: 0, failed: 0, skippedReason: 'offline' });
    render(<SyncUnsyncedBar userId="u1" />);
    fireEvent.click(screen.getByRole('button', { name: 'sync_retry' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('sync_paused_no_network'));
  });
});

