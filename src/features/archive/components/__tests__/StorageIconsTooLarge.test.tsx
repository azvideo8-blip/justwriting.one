import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StorageIcons } from '../StorageIcons';
import { StorageService } from '../../../../core/services/StorageService';
import { SyncService } from '../../../../core/services/SyncService';

vi.mock('../../../../core/services/StorageService', () => ({
  StorageService: {
    addLocalCopy: vi.fn(),
    addCloudCopy: vi.fn(),
    removeLocalCopy: vi.fn(),
    removeCloudCopy: vi.fn(),
    deleteDocument: vi.fn(),
    trashDocument: vi.fn(),
  },
}));

vi.mock('../../../../core/services/SyncService', () => ({
  SyncService: {
    syncDocument: vi.fn(),
  },
}));

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

vi.mock('../../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({
    profile: null,
    user: { uid: 'user_123' },
  }),
}));

describe('F-2: StorageIcons for notes too large for cloud sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('labels cloud icon as storage_too_large_cloud when isTooLargeForSync is true', () => {
    render(
      <StorageIcons
        doc={{
          localId: 'doc_1',
          hasLocal: true,
          hasCloud: false,
          isTooLargeForSync: true,
        }}
        userId="user_123"
        onStorageChange={vi.fn()}
      />
    );

    const button = screen.getByRole('button', { name: 'storage_too_large_cloud' });
    expect(button).toBeInTheDocument();
  });

  it('shows warning toast and does not call addCloudCopy when clicked', () => {
    render(
      <StorageIcons
        doc={{
          localId: 'doc_1',
          hasLocal: true,
          hasCloud: false,
          isTooLargeForSync: true,
        }}
        userId="user_123"
        onStorageChange={vi.fn()}
      />
    );

    const button = screen.getByRole('button', { name: 'storage_too_large_cloud' });
    fireEvent.click(button);

    expect(mockShowToast).toHaveBeenCalledWith('storage_too_large_cloud', 'warning');
    expect(StorageService.addCloudCopy).not.toHaveBeenCalled();
    expect(SyncService.syncDocument).not.toHaveBeenCalled();
  });
});
