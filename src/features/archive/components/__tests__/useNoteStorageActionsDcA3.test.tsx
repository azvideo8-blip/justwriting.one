import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useNoteStorageActions, StorageDoc, AIExclusion } from '../useNoteStorageActions';
import { StorageService } from '../../../../core/services/StorageService';
import { LocalDocumentService } from '../../../../core/services/LocalDocumentService';
import { SyncService } from '../../../../core/services/SyncService';
import { getSessionKey } from '../../../../core/crypto/encrypt';

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
  useLanguage: () => ({ t: (k: string) => k, language: 'ru' }),
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

// DC-A3: вся семантика копий переехала из пиктограмм в хук, которым пользуется
// меню «⋯». Тесты проверяют именно её — порядок вызовов и тосты.
function Harness({
  doc,
  userId,
  onStorageChange,
  exclusion,
}: {
  doc: StorageDoc;
  userId: string;
  onStorageChange: () => void;
  exclusion?: AIExclusion | undefined;
}) {
  const api = useNoteStorageActions({ doc, userId, onStorageChange, ...(exclusion ? { exclusion } : {}) });
  return (
    <>
      <button onClick={api.requestLocal}>request-local</button>
      <button onClick={api.requestCloud}>request-cloud</button>
      <button onClick={api.requestExclusion}>request-exclusion</button>
      {api.dialogs}
    </>
  );
}

describe('DC-A3 useNoteStorageActions: скачивание', () => {
  const userId = 'user_123';
  const onChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockProfile.encryptionMeta = null;
    mockProfile.encryptionSalt = null;
    mockProfile.encryptedDataKey = null;
    vi.mocked(getSessionKey).mockReturnValue(null);
  });

  it('облачная заметка: подтверждение, затем addLocalCopy и тост', async () => {
    vi.mocked(StorageService.addLocalCopy).mockResolvedValueOnce('local_new_1');
    render(<Harness doc={{ cloudId: 'cloud_note_1', hasLocal: false, hasCloud: true }} userId={userId} onStorageChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'request-local' }));
    expect(screen.getByText('storage_confirm_download_local')).toBeInTheDocument();
    expect(screen.getByText('storage_confirm_download_local_hint')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'storage_download_confirm' }));
    await waitFor(() => {
      expect(StorageService.addLocalCopy).toHaveBeenCalledWith(userId, 'cloud_note_1');
      expect(mockShowToast).toHaveBeenCalledWith('storage_downloaded_local', 'success');
    });
  });

  it('запертый сейф: сразу модалка разблокировки, без подтверждения', () => {
    mockProfile.encryptionMeta = { salt: 'abc' };
    render(<Harness doc={{ cloudId: 'cloud_locked', hasLocal: false, hasCloud: true }} userId={userId} onStorageChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'request-local' }));
    expect(screen.getByTestId('mock-unlock-prompt')).toBeInTheDocument();
    expect(screen.queryByText('storage_confirm_download_local')).not.toBeInTheDocument();
  });

  it('параллельная загрузка той же заметки: info-тост, не ошибка', async () => {
    vi.mocked(StorageService.addLocalCopy).mockRejectedValueOnce(new Error('LOCK_HELD by other tab'));
    render(<Harness doc={{ cloudId: 'cloud_note_1', hasLocal: false, hasCloud: true }} userId={userId} onStorageChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'request-local' }));
    fireEvent.click(screen.getByRole('button', { name: 'storage_download_confirm' }));
    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith('storage_download_in_progress', 'info');
    });
  });
});

describe('DC-A3 useNoteStorageActions: загрузка в облако', () => {
  const userId = 'user_123';
  const onChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockProfile.encryptionMeta = null;
    vi.mocked(getSessionKey).mockReturnValue({} as never);
  });

  it('D-5: localOnly-заметка — сначала снять пометку, потом грузить', async () => {
    const order: string[] = [];
    vi.mocked(LocalDocumentService.clearLocalOnlyForUpload).mockImplementation(async () => { order.push('clear'); return true; });
    vi.mocked(StorageService.addCloudCopy).mockImplementation(async () => { order.push('upload'); return 'cloud_1'; });

    render(<Harness doc={{ localId: 'local_d5', hasLocal: true, hasCloud: false, localOnly: true }} userId={userId} onStorageChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'request-cloud' }));

    await waitFor(() => {
      expect(order).toEqual(['clear', 'upload']);
      expect(mockShowToast).toHaveBeenCalledWith('storage_uploaded_cloud', 'success');
    });
  });

  it('обычная заметка: пометку не трогает', async () => {
    vi.mocked(StorageService.addCloudCopy).mockResolvedValueOnce('cloud_2');
    render(<Harness doc={{ localId: 'local_plain', hasLocal: true, hasCloud: false }} userId={userId} onStorageChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'request-cloud' }));

    await waitFor(() => expect(StorageService.addCloudCopy).toHaveBeenCalledWith(userId, 'local_plain'));
    expect(LocalDocumentService.clearLocalOnlyForUpload).not.toHaveBeenCalled();
  });

  it('LOCAL_ONLY и TOMBSTONE — нейтральные info-тосты', async () => {
    vi.mocked(StorageService.addCloudCopy).mockResolvedValueOnce('LOCAL_ONLY');
    const view = render(<Harness doc={{ localId: 'local_priv', hasLocal: true, hasCloud: false }} userId={userId} onStorageChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'request-cloud' }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('storage_local_only_notice', 'info'));
    view.unmount();

    vi.mocked(StorageService.addCloudCopy).mockResolvedValueOnce('TOMBSTONE');
    render(<Harness doc={{ localId: 'local_tomb', hasLocal: true, hasCloud: false }} userId={userId} onStorageChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'request-cloud' }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('storage_tombstone_notice', 'info'));
  });

  it('ошибка отправки — тост про журнал активности', async () => {
    vi.mocked(StorageService.addCloudCopy).mockRejectedValueOnce(new Error('PG unique constraint'));
    render(<Harness doc={{ localId: 'local_err', hasLocal: true, hasCloud: false }} userId={userId} onStorageChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'request-cloud' }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('storage_sync_error_activity_log', 'error'));
  });

  it('неотправленные изменения: вызывается syncDocument, не addCloudCopy', async () => {
    vi.mocked(SyncService.syncDocument).mockResolvedValueOnce(true);
    render(<Harness doc={{ localId: 'local_dirty', hasLocal: true, hasCloud: true, hasPendingSync: true }} userId={userId} onStorageChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'request-cloud' }));
    await waitFor(() => {
      expect(SyncService.syncDocument).toHaveBeenCalledWith(userId, 'local_dirty');
      expect(StorageService.addCloudCopy).not.toHaveBeenCalled();
    });
  });

  it('F-2: слишком большая заметка — предупреждение, отправки нет', () => {
    render(<Harness doc={{ localId: 'doc_1', hasLocal: true, hasCloud: false, isTooLargeForSync: true }} userId={userId} onStorageChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'request-cloud' }));
    expect(mockShowToast).toHaveBeenCalledWith('storage_too_large_cloud', 'warning');
    expect(StorageService.addCloudCopy).not.toHaveBeenCalled();
    expect(SyncService.syncDocument).not.toHaveBeenCalled();
  });
});

describe('DC-A3 useNoteStorageActions: удаление копий', () => {
  const userId = 'user_123';
  const onChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSessionKey).mockReturnValue({} as never);
  });

  it('локальная копия без облачной — в корзину', async () => {
    vi.mocked(StorageService.trashDocument).mockResolvedValueOnce({ cloudSynced: true });
    render(<Harness doc={{ localId: 'local_1', hasLocal: true, hasCloud: false }} userId={userId} onStorageChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'request-local' }));
    expect(screen.getByText('storage_confirm_delete_only')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'storage_delete_confirm' }));
    await waitFor(() => {
      expect(StorageService.trashDocument).toHaveBeenCalledWith(userId, 'local_1', undefined);
      expect(mockShowToast).toHaveBeenCalledWith('archive_trash_moved', 'success');
    });
  });

  // Мутация: вернуть безусловный тост archive_trash_moved — красный.
  it('в корзину при отказе облака — «только на этом устройстве», предупреждением, а не зелёный успех', async () => {
    vi.mocked(StorageService.trashDocument).mockResolvedValueOnce({ cloudSynced: false });
    render(<Harness doc={{ localId: 'local_1', hasLocal: true, hasCloud: false }} userId={userId} onStorageChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'request-local' }));
    fireEvent.click(screen.getByRole('button', { name: 'storage_delete_confirm' }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('delete_local_only_queued', 'warning'));
    expect(mockShowToast).not.toHaveBeenCalledWith('archive_trash_moved', 'success');
  });

  it('облачная копия без локальной — в корзину', async () => {
    vi.mocked(StorageService.trashDocument).mockResolvedValueOnce({ cloudSynced: true });
    render(<Harness doc={{ cloudId: 'cloud_1', hasLocal: false, hasCloud: true }} userId={userId} onStorageChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'request-cloud' }));
    fireEvent.click(screen.getByRole('button', { name: 'storage_delete_confirm' }));
    await waitFor(() => {
      expect(StorageService.trashDocument).toHaveBeenCalledWith(userId, undefined, 'cloud_1');
      expect(mockShowToast).toHaveBeenCalledWith('archive_trash_moved', 'success');
    });
  });

  it('_removeLocalCopy true — успех, false — generic error (N-67)', async () => {
    vi.mocked(StorageService.removeLocalCopy).mockResolvedValueOnce(true);
    const view = render(<Harness doc={{ localId: 'local_1', cloudId: 'cloud_1', hasLocal: true, hasCloud: true }} userId={userId} onStorageChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'request-local' }));
    fireEvent.click(screen.getByRole('button', { name: 'storage_delete_confirm' }));
    await waitFor(() => {
      expect(StorageService.removeLocalCopy).toHaveBeenCalledWith('local_1');
      expect(mockShowToast).toHaveBeenCalledWith('storage_deleted_local', 'success');
    });
    view.unmount();

    vi.mocked(StorageService.removeLocalCopy).mockResolvedValueOnce(false);
    render(<Harness doc={{ localId: 'local_2', cloudId: 'cloud_2', hasLocal: true, hasCloud: true }} userId={userId} onStorageChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'request-local' }));
    fireEvent.click(screen.getByRole('button', { name: 'storage_delete_confirm' }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('error_generic_action', 'error'));
  });

  it('удаление облачной копии фиксируется как намерение (unlinkFromCloud)', async () => {
    vi.mocked(StorageService.removeCloudCopy).mockResolvedValueOnce(undefined as never);
    render(<Harness doc={{ localId: 'local_1', cloudId: 'cloud_1', hasLocal: true, hasCloud: true }} userId={userId} onStorageChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'request-cloud' }));
    expect(screen.getByText('storage_confirm_delete_cloud')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'storage_delete_confirm' }));
    await waitFor(() => {
      expect(StorageService.removeCloudCopy).toHaveBeenCalledWith(userId, 'cloud_1');
      expect(LocalDocumentService.unlinkFromCloud).toHaveBeenCalledWith('local_1');
      expect(mockShowToast).toHaveBeenCalledWith('storage_deleted_cloud', 'success');
    });
  });
});

describe('DC-A3 useNoteStorageActions: скрытие от ИИ', () => {
  const userId = 'user_123';
  const onChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('прятать — с подтверждением, показывать — сразу', async () => {
    const onClick = vi.fn();
    const view = render(
      <Harness
        doc={{ localId: 'local_1', hasLocal: true, hasCloud: false }}
        userId={userId}
        onStorageChange={onChange}
        exclusion={{ excluded: false, loading: false, onClick }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'request-exclusion' }));
    expect(onClick).not.toHaveBeenCalled();
    // X-6: кнопка подтверждения переименована, чтобы не совпадать с именем
    // кнопки в строке меню.
    fireEvent.click(screen.getByRole('button', { name: 'ai_note_exclude_confirm_action' }));
    await waitFor(() => expect(onClick).toHaveBeenCalledTimes(1));
    view.unmount();

    render(
      <Harness
        doc={{ localId: 'local_1', hasLocal: true, hasCloud: false }}
        userId={userId}
        onStorageChange={onChange}
        exclusion={{ excluded: true, loading: false, onClick }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'request-exclusion' }));
    expect(onClick).toHaveBeenCalledTimes(2);
  });
});
