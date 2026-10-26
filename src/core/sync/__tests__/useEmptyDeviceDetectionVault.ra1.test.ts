// RA1-5: на новом устройстве проверка «в облаке есть заметки» упиралась в
// запертый сейф и после разблокировки не повторялась — главный оставался пустым
// без вопроса. Теперь разблокировка перезапускает проверку, а отклонённая
// модалка не убирает баннер «в облаке есть N заметок» до первой локальной
// записи. Фальсификация: убрать подписку на VAULT_UNLOCKED_EVENT → красный;
// убрать чтение счётчиков при отклонённой модалке → баннер пропадает.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

let vaultUnlocked = false;
vi.mock('../../crypto/encrypt', () => ({ isVaultUnlocked: () => vaultUnlocked }));
vi.mock('../../crypto/cryptoHelpers', () => ({ getEncryptionEnabled: () => true }));
vi.mock('../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({ user: { uid: 'u_ra15' }, isGuest: false }),
}));

const mockLocal = vi.fn();
const mockCloud = vi.fn();
vi.mock('../../services/LocalStorageService', () => ({
  LocalStorageService: { getDocumentsByOwner: (...a: unknown[]) => mockLocal(...a) },
}));
vi.mock('../../services/DocumentService', () => ({
  DocumentService: { getUserDocuments: (...a: unknown[]) => mockCloud(...a) },
}));

import { useEmptyDeviceDetection, setRestoreDismissed, getRestoreDismissedKey } from '../useEmptyDeviceDetection';
import { VAULT_UNLOCKED_EVENT } from '../../crypto/useEncryptionStore';
import { emitDomainEvent } from '../../events/domainEvents';

function docs(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `doc_${i}` }));
}

describe('RA1-5: повтор проверки облака после разблокировки сейфа', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vaultUnlocked = false;
    localStorage.removeItem(getRestoreDismissedKey('u_ra15'));
    mockLocal.mockResolvedValue([]);
    mockCloud.mockResolvedValue(docs(3));
  });

  it('запертый сейф: вопроса нет; после unlock — вопрос есть', async () => {
    const { result } = renderHook(() => useEmptyDeviceDetection());
    await waitFor(() => expect(result.current.shouldPrompt).toBe(false));

    act(() => { vaultUnlocked = true; });
    act(() => { window.dispatchEvent(new CustomEvent(VAULT_UNLOCKED_EVENT)); });

    await waitFor(() => expect(result.current.shouldPrompt).toBe(true));
    expect(result.current.cloudCount).toBe(3);
    expect(result.current.localCount).toBe(0);
  });

  it('«Не сейчас»: модалки нет, но баннер с облачными заметками остаётся', async () => {
    const { result } = renderHook(() => useEmptyDeviceDetection());
    await waitFor(() => expect(result.current.shouldPrompt).toBe(false));
    act(() => {
      setRestoreDismissed('u_ra15', true);
      vaultUnlocked = true;
      window.dispatchEvent(new CustomEvent(VAULT_UNLOCKED_EVENT));
    });

    await waitFor(() => expect(result.current.cloudCount).toBe(3));
    expect(result.current.shouldPrompt).toBe(false);
    expect(result.current.showCloudBanner).toBe(true);
  });

  it('появилась локальная запись — баннер исчезает', async () => {
    vaultUnlocked = true;
    const { result, unmount } = renderHook(() => useEmptyDeviceDetection());
    await waitFor(() => expect(result.current.cloudCount).toBe(3));
    mockLocal.mockResolvedValue(docs(1));

    act(() => { emitDomainEvent({ type: 'note.saved' }); });
    await waitFor(() => expect(result.current.showCloudBanner).toBe(false));
    unmount();
  });
});
