import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StorageIcons } from '../StorageIcons';
import { StorageService } from '../../../../core/services/StorageService';
import { LocalDocumentService } from '../../../../core/services/LocalDocumentService';
import { getSessionKey } from '../../../../core/crypto/encrypt';

vi.mock('../../../../core/services/StorageService', () => ({
  StorageService: {
    addCloudCopy: vi.fn(),
  },
}));

vi.mock('../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: {
    clearLocalOnlyForUpload: vi.fn(),
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

describe('FU-1 / D-5: StorageIcons upload localOnly note to cloud', () => {
  const userId = 'user_123';
  const mockOnStorageChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockProfile.encryptionMeta = null;
    mockProfile.encryptionSalt = null;
    mockProfile.encryptedDataKey = null;
    vi.mocked(getSessionKey).mockReturnValue({} as any);
  });

  it('calls clearLocalOnlyForUpload before addCloudCopy when uploading a localOnly note', async () => {
    const callOrder: string[] = [];
    vi.mocked(LocalDocumentService.clearLocalOnlyForUpload).mockImplementation(async () => {
      callOrder.push('clearLocalOnlyForUpload');
      return true;
    });
    vi.mocked(StorageService.addCloudCopy).mockImplementation(async () => {
      callOrder.push('addCloudCopy');
      return 'cloud_123';
    });

    render(
      <StorageIcons
        doc={{
          localId: 'local_d5_note',
          hasLocal: true,
          hasCloud: false,
          localOnly: true,
          hasPendingSync: false,
        }}
        userId={userId}
        onStorageChange={mockOnStorageChange}
      />
    );

    const uploadBtn = screen.getByRole('button', { name: 'storage_upload_to_cloud' });
    fireEvent.click(uploadBtn);

    await waitFor(() => {
      expect(LocalDocumentService.clearLocalOnlyForUpload).toHaveBeenCalledTimes(1);
      expect(LocalDocumentService.clearLocalOnlyForUpload).toHaveBeenCalledWith('local_d5_note');
      expect(StorageService.addCloudCopy).toHaveBeenCalledTimes(1);
      expect(StorageService.addCloudCopy).toHaveBeenCalledWith(userId, 'local_d5_note', true);
      expect(callOrder).toEqual(['clearLocalOnlyForUpload', 'addCloudCopy']);
      expect(mockShowToast).toHaveBeenCalledWith('storage_uploaded_cloud', 'success');
    });
  });

  it('does not call clearLocalOnlyForUpload if note is not localOnly', async () => {
    vi.mocked(StorageService.addCloudCopy).mockResolvedValueOnce('cloud_456');

    render(
      <StorageIcons
        doc={{
          localId: 'local_normal_note',
          hasLocal: true,
          hasCloud: false,
          localOnly: false,
          hasPendingSync: false,
        }}
        userId={userId}
        onStorageChange={mockOnStorageChange}
      />
    );

    const uploadBtn = screen.getByRole('button', { name: 'storage_upload_to_cloud' });
    fireEvent.click(uploadBtn);

    await waitFor(() => {
      expect(LocalDocumentService.clearLocalOnlyForUpload).not.toHaveBeenCalled();
      expect(StorageService.addCloudCopy).toHaveBeenCalledWith(userId, 'local_normal_note', true);
    });
  });
});
