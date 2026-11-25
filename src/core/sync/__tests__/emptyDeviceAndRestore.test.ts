import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { renderHook, waitFor } from '@testing-library/react';
import {
  getRestoreDismissedKey,
  isRestoreDismissed,
  setRestoreDismissed,
  useEmptyDeviceDetection,
} from '../useEmptyDeviceDetection';
import { LocalStorageService } from '../../services/LocalStorageService';
import { DocumentService } from '../../services/DocumentService';
import { getLocalDb } from '../../storage/localDb';

vi.mock('../../../features/auth/hooks/useAuthStatus', () => ({
  useAuthStatus: () => ({ user: { uid: 'user_restore_test' }, isGuest: false }),
}));

vi.mock('../../crypto/keyVaultCache', () => ({
  isVaultUnlocked: () => true,
}));

vi.mock('../../crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => false,
}));

describe('useEmptyDeviceDetection helpers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('generates the correct key for user id', () => {
    expect(getRestoreDismissedKey('user_abc')).toBe('jw_restore_prompt_dismissed_user_abc');
  });

  it('correctly reports dismissed state', () => {
    expect(isRestoreDismissed('user_abc')).toBe(false);
    setRestoreDismissed('user_abc', true);
    expect(isRestoreDismissed('user_abc')).toBe(true);
    setRestoreDismissed('user_abc', false);
    expect(isRestoreDismissed('user_abc')).toBe(false);
  });

  it('detects missing cloud notes when localCount < cloudCount', () => {
    const localLen = 1;
    const cloudLen = 3;
    const isMissingCloudNotes = localLen < cloudLen && cloudLen > 0;
    expect(isMissingCloudNotes).toBe(true);
  });
});

describe('useEmptyDeviceDetection hook', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  // R-2: битый ряд не превращает облако в «пусто»: на устройстве меньше, чем
  // прочитано, — подсказка есть. Мутация «не брать e.docs» → красный.
  it('prompts on a partial cloud list when readable cloud notes outnumber local ones', async () => {
    vi.spyOn(LocalStorageService, 'getDocumentsByOwner').mockResolvedValue([{ id: 'local_1' } as never]);
    const e = Object.assign(new Error('UNREADABLE_CLOUD_LIST: 1'), { name: 'UnreadableCloudListError', docs: [{ id: 'c1' }, { id: 'c2' }], ids: ['bad'], uuids: ['bad'] });
    vi.spyOn(DocumentService, 'getUserDocuments').mockRejectedValue(e);

    const { result } = renderHook(() => useEmptyDeviceDetection());
    await waitFor(() => expect(result.current.shouldPrompt).toBe(true));
    expect(result.current.cloudCount).toBe(2);
  });

  it('prompts to restore when local device has fewer notes than cloud (AG-RESTORE-1)', async () => {
    vi.spyOn(LocalStorageService, 'getDocumentsByOwner').mockResolvedValue([
      { id: 'local_1' } as any,
    ]);
    vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([
      { id: 'cloud_1' } as any,
      { id: 'cloud_2' } as any,
      { id: 'cloud_3' } as any,
    ]);

    const { result } = renderHook(() => useEmptyDeviceDetection());

    await waitFor(() => {
      expect(result.current.shouldPrompt).toBe(true);
      expect(result.current.localCount).toBe(1);
      expect(result.current.cloudCount).toBe(3);
    });
  });

  it('does NOT prompt when local device has equal or more notes than cloud', async () => {
    vi.spyOn(LocalStorageService, 'getDocumentsByOwner').mockResolvedValue([
      { id: 'local_1' } as any,
      { id: 'local_2' } as any,
    ]);
    vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([
      { id: 'cloud_1' } as any,
    ]);

    const { result } = renderHook(() => useEmptyDeviceDetection());

    await waitFor(() => {
      expect(result.current.shouldPrompt).toBe(false);
      expect(result.current.localCount).toBe(2);
      expect(result.current.cloudCount).toBe(1);
    });
  });

  // Дейлик 27.10 (подозрение 2): облако не ответило — «нет ответа», а не «в облаке
  // пусто». Перечитки было только две (сейф, сохранение), а на новом пустом
  // устройстве ни того ни другого не будет: баннер «в облаке N заметок» не
  // появлялся до перезагрузки. Мутация: убрать слушателя `online` → красный.
  it('сбой облака на пустом устройстве — вернулась сеть, баннер появляется', async () => {
    vi.spyOn(LocalStorageService, 'getDocumentsByOwner').mockResolvedValue([]);
    const cloud = vi.spyOn(DocumentService, 'getUserDocuments')
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValue([{ id: 'cloud_1' } as any, { id: 'cloud_2' } as any]);

    const { result } = renderHook(() => useEmptyDeviceDetection());
    await waitFor(() => expect(cloud).toHaveBeenCalledTimes(1));
    expect(result.current.showCloudBanner).toBe(false);

    window.dispatchEvent(new Event('online'));
    await waitFor(() => expect(result.current.showCloudBanner).toBe(true));
    expect(result.current.cloudCount).toBe(2);
  });

  // PR-1 (стенд 25.11): человек удалил единственную заметку, облако не ответило — окно
  // звало «в облаке 1, загрузить?». Мутация: не отсеивать ждущих удаления — красный.
  it('заметка, чьё удаление ждёт облака, не предлагается к загрузке', async () => {
    const db = await getLocalDb('user_restore_test');
    await db.put('syncQueue', { id: 'delete_cloud_1', documentId: 'cloud_1', type: 'delete', createdAt: 1, ownerId: 'user_restore_test', revocable: true });
    vi.spyOn(LocalStorageService, 'getDocumentsByOwner').mockResolvedValue([]);
    vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([{ id: 'cloud_1' }, { id: 'cloud_2' }] as never);

    const { result } = renderHook(() => useEmptyDeviceDetection());
    await waitFor(() => expect(result.current).toMatchObject({ cloudCount: 1, showCloudBanner: true }));
    await db.clear('syncQueue');
  });

  // Ревью: дренаж снял строку и задачу, пока список читался. Мутация: не читать очередь до списка — красный.
  it('удаление дошло, пока читался список, — заметка не предлагается', async () => {
    const db = await getLocalDb('user_restore_test');
    await db.put('syncQueue', { id: 'delete_cloud_1', documentId: 'cloud_1', type: 'delete', createdAt: 1, ownerId: 'user_restore_test', revocable: true });
    vi.spyOn(LocalStorageService, 'getDocumentsByOwner').mockResolvedValue([]);
    vi.spyOn(DocumentService, 'getUserDocuments').mockImplementation(async () => {
      await db.clear('syncQueue');
      return [{ id: 'cloud_1' }, { id: 'cloud_2' }] as never;
    });
    const { result } = renderHook(() => useEmptyDeviceDetection());
    await waitFor(() => expect(result.current).toMatchObject({ cloudCount: 1, showCloudBanner: true }));
  });

  // Мутация: не читать очередь после списка — красный.
  it('удаление поставлено, пока читался список, — заметка не предлагается', async () => {
    const db = await getLocalDb('user_restore_test');
    vi.spyOn(LocalStorageService, 'getDocumentsByOwner').mockResolvedValue([]);
    vi.spyOn(DocumentService, 'getUserDocuments').mockImplementation(async () => {
      await db.put('syncQueue', { id: 'delete_cloud_1', documentId: 'cloud_1', type: 'delete', createdAt: 1, ownerId: 'user_restore_test', revocable: true });
      return [{ id: 'cloud_1' }, { id: 'cloud_2' }] as never;
    });
    const { result } = renderHook(() => useEmptyDeviceDetection());
    await waitFor(() => expect(result.current).toMatchObject({ cloudCount: 1, showCloudBanner: true }));
    await db.clear('syncQueue');
  });

  // Мутация: не отсеивать ждущих удаления среди нечитаемых — красный.
  it('нечитаемая заметка, ждущая удаления, тоже не в счёт', async () => {
    const db = await getLocalDb('user_restore_test');
    await db.put('syncQueue', { id: 'delete_bad', documentId: 'bad', type: 'delete', createdAt: 1, ownerId: 'user_restore_test', revocable: true });
    vi.spyOn(LocalStorageService, 'getDocumentsByOwner').mockResolvedValue([]);
    vi.spyOn(DocumentService, 'getUserDocuments').mockRejectedValue(Object.assign(new Error('UNREADABLE_CLOUD_LIST: 2'), { name: 'UnreadableCloudListError', docs: [], ids: ['bad', 'bad2'], uuids: ['bad', 'bad2'] }));
    const { result } = renderHook(() => useEmptyDeviceDetection());
    await waitFor(() => expect(result.current).toMatchObject({ cloudCount: 1, cloudUnreadable: 1 }));
    await db.clear('syncQueue');
  });
});
