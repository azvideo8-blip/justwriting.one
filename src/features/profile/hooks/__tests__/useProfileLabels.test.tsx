import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useProfileLabels } from '../useProfileLabels';
import { generateDataKey } from '../../../../core/crypto/encrypt';
import { encryptLabels, decryptLabels } from '../../../../core/crypto/labelEncryption';
import { useEncryptionStore } from '../../../../core/crypto/useEncryptionStore';
import { setProfileLoaded, setEncryptionEnabled } from '../../../../core/crypto/cryptoHelpers';

let mockCurrentUser: { uid: string } | null = { uid: 'user_test' };
vi.mock('../../../../core/auth', () => ({
  getCurrentUser: () => mockCurrentUser,
}));

let mockProfileStore: Record<string, unknown> = {};
let mockVersion = 1;

vi.mock('../../../../core/data', () => ({
  DataProvider: {
    getProfile: vi.fn(async () => {
      return mockProfileStore;
    }),
    // LB-1: метки читаются с версией строки и пишутся только под ней.
    getProfileLabels: vi.fn(async () => ({ labels: mockProfileStore.labels, version: String(mockVersion) })),
    replaceProfileLabels: vi.fn(async (_uid: string, version: string, next: unknown[]) => {
      if (version !== String(mockVersion)) return false;
      mockVersion++;
      mockProfileStore = { ...mockProfileStore, labels: next };
      return true;
    }),
  },
}));

vi.mock('../../../../core/services/DocumentService', () => ({
  DocumentService: {
    clearLabelFromAllDocs: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: {
    clearLabelFromAllDocs: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('SEC-7b: useProfileLabels end-to-end decryption and edit cycle', () => {
  const userId = 'user_test';
  let sessionKey: CryptoKey;

  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    mockCurrentUser = { uid: userId };

    sessionKey = await generateDataKey();
    useEncryptionStore.getState().setKey(sessionKey);
    setProfileLoaded(userId, true);
    setEncryptionEnabled(userId, true);

    const initialPlainLabels = [
      { id: 'l1', name: 'Практика6', color: '#D04545' },
      { id: 'l2', name: 'Терапия', color: '#45D045' },
    ];

    const encryptedLabels = await encryptLabels(initialPlainLabels, userId);
    mockProfileStore = {
      uid: userId,
      labels: encryptedLabels,
    };
  });

  it('renders decrypted label names (not ciphertext) when reading profile', async () => {
    const { result } = renderHook(() => useProfileLabels(userId));

    await waitFor(() => {
      expect(result.current.labels.length).toBe(2);
    });

    // Label names must be decrypted plaintext, not ciphertext
    expect(result.current.labels[0]!.name).toBe('Практика6');
    expect(result.current.labels[1]!.name).toBe('Терапия');
    expect(result.current.labels[0]!.id).toBe('l1');
    expect(result.current.labels[1]!.id).toBe('l2');
  });

  it('adding a label preserves existing names without double-encrypting them', async () => {
    const { result } = renderHook(() => useProfileLabels(userId));

    await waitFor(() => {
      expect(result.current.labels.length).toBe(2);
    });

    await act(async () => {
      void result.current.addLabel({ name: 'Книга', color: '#0088FF' });
    });

    await waitFor(() => {
      expect(result.current.labels.length).toBe(3);
    });

    // Check what was saved into the database (mockProfileStore)
    const savedInDb = mockProfileStore.labels as Array<Record<string, unknown>>;
    expect(savedInDb).toBeDefined();
    expect(savedInDb.length).toBe(3);

    // Each saved label in DB must be encrypted once
    for (const savedLabel of savedInDb) {
      expect(savedLabel._encrypted).toBe(true);
      expect(typeof savedLabel.name).toBe('string');
    }

    // Decrypt all labels directly from the DB payload with decryptLabels
    const decryptedFromDb = await decryptLabels(savedInDb);
    expect(decryptedFromDb.map(l => l.name)).toEqual(['Практика6', 'Терапия', 'Книга']);
  });

  // Признак `_encrypted` живёт только на сырой записи. Разовые проходы —
  // миграция незашифрованных меток и починка двойного шифрования — обязаны
  // получать её до расшифровки. Накормленные расшифрованным списком, они видят
  // отсутствие признака и решают, что метки не зашифрованы: профиль
  // переписывается при каждом чтении, а «миграция один раз» перестаёт быть
  // правдой.
  it('чтение здорового профиля не переписывает метки', async () => {
    const { DataProvider } = await import('../../../../core/data');
    const { ProfileService } = await import('../../../../core/services/ProfileService');

    const encrypted = await encryptLabels(
      [{ id: 'l1', name: 'Терапия', color: '#111' }],
      'user_test',
    );
    mockProfileStore = { uid: 'user_test', labels: encrypted };
    vi.mocked(DataProvider.replaceProfileLabels).mockClear();

    const res = await ProfileService.getProfile('user_test');
    expect(res.data?.labels?.[0]?.name).toBe('Терапия');

    // Проходы запускаются без ожидания, поэтому даём микрозадачам отработать.
    await new Promise(r => setTimeout(r, 0));
    expect(DataProvider.replaceProfileLabels).not.toHaveBeenCalled();
  });

  // Обратная сторона той же правки: проходы должны быть живы. Если их вызвать
  // неоткуда — а сырые метки видит только точка входа, — старые незашифрованные
  // метки останутся такими навсегда, молча.
  it('чтение профиля со старыми незашифрованными метками их шифрует', async () => {
    const { DataProvider } = await import('../../../../core/data');
    const { ProfileService } = await import('../../../../core/services/ProfileService');

    mockProfileStore = { uid: 'user_test', labels: [{ id: 'l1', name: 'Практика6', color: '#222' }] };
    vi.mocked(DataProvider.replaceProfileLabels).mockClear();

    await ProfileService.getProfile('user_test');
    // Ждём условие, а не фиксированный тик: шифрование метки — цепочка
    // WebCrypto, и под нагрузкой она в один setTimeout(0) не укладывается.
    await vi.waitFor(() => expect(DataProvider.replaceProfileLabels).toHaveBeenCalledTimes(1));
    const written = vi.mocked(DataProvider.replaceProfileLabels).mock.calls[0]![2] as Array<Record<string, unknown>>;
    expect(written[0]!._encrypted).toBe(true);
    expect(written[0]!.name).not.toBe('Практика6');
    expect((await decryptLabels(written))[0]!.name).toBe('Практика6');
  });

  it('BUG-1: re-fetches and decrypts labels when vault is unlocked after mount', async () => {
    const { ProfileService } = await import('../../../../core/services/ProfileService');
    const getProfileSpy = vi.spyOn(ProfileService, 'getProfile');

    // Start with locked vault
    useEncryptionStore.getState().lockVault();

    const { result } = renderHook(() => useProfileLabels(userId, [{ id: 'l1', name: '…', color: '#D04545' }]));

    // Wait for the initial mount fetch to complete while the vault is locked
    await waitFor(() => {
      expect(getProfileSpy).toHaveBeenCalledTimes(1);
    });
    // Labels must still be placeholders because vault was locked during first fetch
    expect(result.current.labels[0]!.name).toBe('…');

    // Now unlock the vault
    await act(async () => {
      useEncryptionStore.getState().setKey(sessionKey);
    });

    // Verify that unlock triggered a SECOND fetch (the unlock effect) and decrypted the label
    await waitFor(() => {
      expect(getProfileSpy).toHaveBeenCalledTimes(2);
      expect(result.current.labels[0]!.name).toBe('Практика6');
    });
  });
});

// DA-10 (владелец 27.11): метка, созданная на другом устройстве, на открытой вкладке
// не появлялась до перезагрузки. Мутация: снять подписку на sync-queue-changed — красный.
describe('DA-10: список меток догоняет другое устройство', () => {
  const userId = 'user_test';
  beforeEach(async () => {
    vi.clearAllMocks();
    mockCurrentUser = { uid: userId };
    setEncryptionEnabled(userId, false);
    mockProfileStore = { uid: userId, labels: [{ id: 'l1', name: 'Старая', color: '#111111' }] };
  });

  it('забор принёс изменения — список перечитан, новая метка видна', async () => {
    const { result } = renderHook(() => useProfileLabels(userId));
    await waitFor(() => expect(result.current.labels.map(l => l.id)).toEqual(['l1']));
    // На телефоне создали метку; забор на этой вкладке принёс изменения.
    mockProfileStore = { uid: userId, labels: [{ id: 'l1', name: 'Старая', color: '#111111' }, { id: 'l2', name: 'Новая', color: '#222222' }] };
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 60_000);
    act(() => { window.dispatchEvent(new CustomEvent('sync-queue-changed')); });
    await waitFor(() => expect(result.current.labels.map(l => l.id)).toEqual(['l1', 'l2']));
    vi.restoreAllMocks();
  });
});
