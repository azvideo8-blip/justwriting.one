import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StorageIcons } from '../StorageIcons';

vi.mock('../../../../core/services/StorageService', () => ({
  StorageService: {
    addLocalCopy: vi.fn(),
    addCloudCopy: vi.fn(),
    removeLocalCopy: vi.fn(),
    removeCloudCopy: vi.fn(),
    trashDocument: vi.fn(),
  },
}));

vi.mock('../../../../core/services/SyncService', () => ({
  SyncService: { syncDocument: vi.fn() },
}));

vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, language: 'ru' }),
}));

vi.mock('../../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({ profile: null, user: { uid: 'guest_abc' } }),
}));

describe('DC-X2: dead storage icons are not buttons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('guest note: no cloud button, an img with the name exists', () => {
    render(
      <StorageIcons
        doc={{ localId: 'doc_1', hasLocal: true, hasCloud: false }}
        userId="guest_abc"
        onStorageChange={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: 'storage_no_cloud' })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'storage_no_cloud' })).toBeInTheDocument();
  });

  it('note with no copies at all: local icon is inert too', () => {
    render(
      <StorageIcons
        doc={{ hasLocal: false, hasCloud: false }}
        userId="guest_abc"
        onStorageChange={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: 'storage_no_local' })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'storage_no_local' })).toBeInTheDocument();
  });

  it('signed-in note without cloud copy stays a real upload button', () => {
    render(
      <StorageIcons
        doc={{ localId: 'doc_1', hasLocal: true, hasCloud: false }}
        userId="user_123"
        onStorageChange={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'storage_upload_to_cloud' })).toBeInTheDocument();
  });
});
