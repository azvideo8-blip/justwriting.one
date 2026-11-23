import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useNoteStorageActions, StorageDoc } from '../useNoteStorageActions';
import { StorageService } from '../../../../core/services/StorageService';

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

vi.mock('../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: {
    unlinkFromCloud: vi.fn(),
    clearLocalOnlyForUpload: vi.fn(),
  },
}));

vi.mock('../../../../core/services/SyncService', () => ({
  SyncService: { syncDocument: vi.fn() },
}));

vi.mock('../../../../core/crypto/encrypt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../core/crypto/encrypt')>();
  return { ...actual, getSessionKey: vi.fn() };
});

const mockShowToast = vi.fn();
vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({
    t: (k: string, p?: Record<string, string | number>) =>
      p?.count !== undefined ? `${k}:${p.count}` : k,
    language: 'ru',
  }),
}));

const mockProfile = {
  encryptionMeta: null as unknown,
  encryptionSalt: null as unknown,
  encryptedDataKey: null as unknown,
};

vi.mock('../../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({ profile: mockProfile, user: { uid: 'user_123' } }),
}));

vi.mock('../../../../app/UnlockPrompt', () => ({
  UnlockPrompt: ({ onUnlocked }: { onUnlocked: () => void }) => (
    <div data-testid="mock-unlock-prompt">
      <button onClick={onUnlocked}>Unlock</button>
    </div>
  ),
}));

function Harness({ doc, userId, onStorageChange }: { doc: StorageDoc; userId: string; onStorageChange: () => void }) {
  const api = useNoteStorageActions({ doc, userId, onStorageChange });
  return (
    <>
      <button onClick={api.requestLocal}>request-local</button>
      {api.dialogs}
    </>
  );
}

// NB-9 (sus14): скачивание с пропущенными битыми версиями — не «успех»:
// вызывающий обязан назвать неполную историю warning-тостом с числом версий.
describe('sus14: скачивание называет пропущенные версии', () => {
  const userId = 'user_123';
  const onChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockProfile.encryptionMeta = null;
    mockProfile.encryptionSalt = null;
    mockProfile.encryptedDataKey = null;
  });

  const download = async () => {
    render(<Harness doc={{ cloudId: 'cloud_note_1', hasLocal: false, hasCloud: true }} userId={userId} onStorageChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'request-local' }));
    fireEvent.click(screen.getByRole('button', { name: 'storage_download_confirm' }));
    await waitFor(() => expect(StorageService.addLocalCopy).toHaveBeenCalledWith(userId, 'cloud_note_1'));
  };

  it('skippedVersions: 2 → warning с числом, успешного тоста нет', async () => {
    vi.mocked(StorageService.addLocalCopy).mockResolvedValueOnce({ localId: 'local_new_1', skippedVersions: 2 } as never);

    await download();

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith('storage_download_versions_skipped:2', 'warning');
    });
    expect(mockShowToast).not.toHaveBeenCalledWith('storage_downloaded_local', 'success');
    expect(onChange).toHaveBeenCalled();
  });

  it('контроль: skippedVersions: 0 → обычный успешный тост', async () => {
    vi.mocked(StorageService.addLocalCopy).mockResolvedValueOnce({ localId: 'local_new_1', skippedVersions: 0 } as never);

    await download();

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith('storage_downloaded_local', 'success');
    });
    expect(mockShowToast).not.toHaveBeenCalledWith('storage_download_versions_skipped:0', 'warning');
  });
});