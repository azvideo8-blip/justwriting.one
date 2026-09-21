import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StorageIcons } from '../StorageIcons';
import { StorageService } from '../../../../core/services/StorageService';
import { getSessionKey } from '../../../../core/crypto/encrypt';

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

vi.mock('../../../../app/UnlockPrompt', () => ({
  UnlockPrompt: ({ onUnlocked }: { onUnlocked: () => void }) => (
    <div data-testid="mock-unlock-prompt">
      <button onClick={onUnlocked}>Unlock</button>
    </div>
  ),
}));

describe('SYNC-D3: StorageIcons download to local', () => {
  const userId = 'user_123';
  const mockOnStorageChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockProfile.encryptionMeta = null;
    mockProfile.encryptionSalt = null;
    mockProfile.encryptedDataKey = null;
    vi.mocked(getSessionKey).mockReturnValue(null);
  });

  it('renders download tooltip on hard drive icon for cloud-only note', () => {
    render(
      <StorageIcons
        doc={{
          cloudId: 'cloud_note_1',
          hasLocal: false,
          hasCloud: true,
        }}
        userId={userId}
        onStorageChange={mockOnStorageChange}
      />
    );

    const localBtn = screen.getByRole('button', { name: 'storage_download_to_local' });
    expect(localBtn).toBeInTheDocument();
  });

  it('clicking download button opens confirmation modal and confirms download', async () => {
    vi.mocked(StorageService.addLocalCopy).mockResolvedValueOnce('local_new_1');

    render(
      <StorageIcons
        doc={{
          cloudId: 'cloud_note_1',
          hasLocal: false,
          hasCloud: true,
        }}
        userId={userId}
        onStorageChange={mockOnStorageChange}
      />
    );

    const localBtn = screen.getByRole('button', { name: 'storage_download_to_local' });
    fireEvent.click(localBtn);

    // Modal should be open
    expect(screen.getByText('storage_confirm_download_local')).toBeInTheDocument();
    expect(screen.getByText('storage_confirm_download_local_hint')).toBeInTheDocument();

    // Confirm button
    const confirmBtn = screen.getByRole('button', { name: 'storage_download_confirm' });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(StorageService.addLocalCopy).toHaveBeenCalledWith(userId, 'cloud_note_1');
      expect(mockShowToast).toHaveBeenCalledWith('storage_downloaded_local', 'success');
      expect(mockOnStorageChange).toHaveBeenCalledTimes(2);
      expect(mockOnStorageChange).toHaveBeenCalledWith();
    });
  });

  it('shows unlock prompt when vault is locked instead of opening confirmation directly', async () => {
    mockProfile.encryptionMeta = { salt: 'abc' };
    vi.mocked(getSessionKey).mockReturnValue(null); // vault locked

    render(
      <StorageIcons
        doc={{
          cloudId: 'cloud_note_locked',
          hasLocal: false,
          hasCloud: true,
        }}
        userId={userId}
        onStorageChange={mockOnStorageChange}
      />
    );

    const localBtn = screen.getByRole('button', { name: 'storage_download_to_local' });
    fireEvent.click(localBtn);

    expect(screen.getByTestId('mock-unlock-prompt')).toBeInTheDocument();
    expect(screen.queryByText('storage_confirm_download_local')).not.toBeInTheDocument();
  });

  describe('ERR-8: upload feedback differentiation', () => {
    it('shows neutral info toast when note is LOCAL_ONLY', async () => {
      vi.mocked(getSessionKey).mockReturnValue({} as any);
      vi.mocked(StorageService.addCloudCopy).mockResolvedValueOnce('LOCAL_ONLY');

      render(
        <StorageIcons
          doc={{
            localId: 'local_priv_1',
            hasLocal: true,
            hasCloud: false,
          }}
          userId={userId}
          onStorageChange={mockOnStorageChange}
        />
      );

      const cloudBtn = screen.getByRole('button', { name: 'storage_upload_to_cloud' });
      fireEvent.click(cloudBtn);

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith('storage_local_only_notice', 'info');
      });
    });

    it('shows neutral info toast when cloud copy was TOMBSTONE', async () => {
      vi.mocked(getSessionKey).mockReturnValue({} as any);
      vi.mocked(StorageService.addCloudCopy).mockResolvedValueOnce('TOMBSTONE');

      render(
        <StorageIcons
          doc={{
            localId: 'local_tombstone_1',
            hasLocal: true,
            hasCloud: false,
          }}
          userId={userId}
          onStorageChange={mockOnStorageChange}
        />
      );

      const cloudBtn = screen.getByRole('button', { name: 'storage_upload_to_cloud' });
      fireEvent.click(cloudBtn);

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith('storage_tombstone_notice', 'info');
      });
    });

    it('shows activity log error toast when upload throws real error', async () => {
      vi.mocked(getSessionKey).mockReturnValue({} as any);
      vi.mocked(StorageService.addCloudCopy).mockRejectedValueOnce(new Error('PG unique constraint'));

      render(
        <StorageIcons
          doc={{
            localId: 'local_err_1',
            hasLocal: true,
            hasCloud: false,
          }}
          userId={userId}
          onStorageChange={mockOnStorageChange}
        />
      );

      const cloudBtn = screen.getByRole('button', { name: 'storage_upload_to_cloud' });
      fireEvent.click(cloudBtn);

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith('storage_sync_error_activity_log', 'error');
      });
    });
  });
});
