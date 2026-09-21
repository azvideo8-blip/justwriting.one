import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StorageIcons } from '../StorageIcons';
import { StorageService } from '../../../../core/services/StorageService';

vi.mock('../../../../core/services/StorageService', () => ({
  StorageService: {
    addLocalCopy: vi.fn(),
    addCloudCopy: vi.fn(),
    removeLocalCopy: vi.fn(),
    removeCloudCopy: vi.fn(),
    deleteDocument: vi.fn(),
  },
}));

vi.mock('../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: {
    unlinkFromCloud: vi.fn(),
  },
}));

vi.mock('../../../../core/services/SyncService', () => ({
  SyncService: {
    syncDocument: vi.fn(),
  },
}));

vi.mock('../../../../core/crypto/encrypt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../core/crypto/encrypt')>();
  return {
    ...actual,
    getSessionKey: vi.fn(),
  };
});

const mockShowToast = vi.fn();
vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({
    t: (k: string) => k,
    language: 'ru',
  }),
}));

const mockProfile = {
  encryptionMeta: null as any,
  encryptionSalt: null as any,
  encryptedDataKey: null as any,
};

vi.mock('../../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({
    profile: mockProfile,
    user: { uid: 'user_123' },
  }),
}));

describe('POST-2: StorageIcons delete toasts based on cloudSynced', () => {
  const userId = 'user_123';
  const mockOnStorageChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows delete_local_only_queued toast when delete-local-only has cloudSynced = false', async () => {
    vi.mocked(StorageService.deleteDocument).mockResolvedValueOnce({ cloudSynced: false });

    render(
      <StorageIcons
        doc={{
          localId: 'local_1',
          hasLocal: true,
          hasCloud: false,
        }}
        userId={userId}
        onStorageChange={mockOnStorageChange}
      />
    );

    // Hard drive button triggers delete-local-only when local-only
    const localBtn = screen.getByRole('button', { name: 'storage_remove_local' });
    fireEvent.click(localBtn);

    // Modal opens
    expect(screen.getByText('storage_confirm_delete_only')).toBeInTheDocument();

    // Click confirm delete
    const confirmBtn = screen.getByRole('button', { name: 'storage_delete_confirm' });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(StorageService.deleteDocument).toHaveBeenCalledWith(userId, 'local_1', undefined);
      expect(mockShowToast).toHaveBeenCalledWith('delete_local_only_queued');
      expect(mockShowToast).not.toHaveBeenCalledWith('storage_deleted_completely', 'success');
    });
  });

  it('shows storage_deleted_completely toast when delete-local-only has cloudSynced = true', async () => {
    vi.mocked(StorageService.deleteDocument).mockResolvedValueOnce({ cloudSynced: true });

    render(
      <StorageIcons
        doc={{
          localId: 'local_1',
          hasLocal: true,
          hasCloud: false,
        }}
        userId={userId}
        onStorageChange={mockOnStorageChange}
      />
    );

    const localBtn = screen.getByRole('button', { name: 'storage_remove_local' });
    fireEvent.click(localBtn);

    const confirmBtn = screen.getByRole('button', { name: 'storage_delete_confirm' });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(StorageService.deleteDocument).toHaveBeenCalledWith(userId, 'local_1', undefined);
      expect(mockShowToast).toHaveBeenCalledWith('storage_deleted_completely', 'success');
    });
  });

  it('shows delete_local_only_queued toast when delete-cloud-only has cloudSynced = false', async () => {
    vi.mocked(StorageService.deleteDocument).mockResolvedValueOnce({ cloudSynced: false });

    render(
      <StorageIcons
        doc={{
          cloudId: 'cloud_1',
          hasLocal: false,
          hasCloud: true,
        }}
        userId={userId}
        onStorageChange={mockOnStorageChange}
      />
    );

    // Cloud button triggers delete-cloud-only when cloud-only
    const cloudBtn = screen.getByRole('button', { name: 'storage_remove_cloud' });
    fireEvent.click(cloudBtn);

    expect(screen.getByText('storage_confirm_delete_only')).toBeInTheDocument();

    const confirmBtn = screen.getByRole('button', { name: 'storage_delete_confirm' });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(StorageService.deleteDocument).toHaveBeenCalledWith(userId, undefined, 'cloud_1');
      expect(mockShowToast).toHaveBeenCalledWith('delete_local_only_queued');
      expect(mockShowToast).not.toHaveBeenCalledWith('storage_deleted_completely', 'success');
    });
  });
});
