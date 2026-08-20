import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  encryptLabel,
  encryptLabels,
  decryptLabel,
  decryptLabels,
  migrateUnencryptedLabels,
} from '../labelEncryption';
import { setEncryptionEnabled, setProfileLoaded } from '../cryptoHelpers';
import { useEncryptionStore } from '../useEncryptionStore';
import { DataProvider } from '../../data';
import { generateDataKey } from '../encrypt';

vi.mock('../../data', () => ({
  DataProvider: {
    updateProfile: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('SEC-7: Label names end-to-end encryption', () => {
  let sessionKey: CryptoKey;

  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    setProfileLoaded('user_1', true);
    setEncryptionEnabled('user_1', true);

    // Generate real AES-GCM session key for encryption tests
    sessionKey = await generateDataKey();
    useEncryptionStore.getState().setKey(sessionKey);
  });

  it('encrypts label name while preserving id and color in plaintext', async () => {
    const label = { id: 'l1', name: 'Практика6', color: '#D04545' };
    const encrypted = await encryptLabel(label, 'user_1');

    expect(encrypted.id).toBe('l1');
    expect(encrypted.color).toBe('#D04545');
    expect(encrypted._encrypted).toBe(true);
    // Name must be ciphertext — cannot contain plaintext Cyrillic
    expect(encrypted.name).not.toBe('Практика6');
    expect(/[А-Яа-яЁё]/.test(encrypted.name)).toBe(false);
  });

  it('decrypts encrypted label when vault is unlocked', async () => {
    const original = { id: 'l1', name: 'Терапия', color: '#00ff00' };
    const encrypted = await encryptLabel(original, 'user_1');

    const decrypted = await decryptLabel(encrypted as unknown as Record<string, unknown>);
    expect(decrypted.id).toBe('l1');
    expect(decrypted.name).toBe('Терапия');
    expect(decrypted.color).toBe('#00ff00');
  });

  it('decrypts an array of encrypted labels with decryptLabels', async () => {
    const list = [
      { id: 'l1', name: 'Метка 1', color: '#111111' },
      { id: 'l2', name: 'Метка 2', color: '#222222' },
    ];
    const encryptedList = await encryptLabels(list, 'user_1');
    const decryptedList = await decryptLabels(encryptedList as unknown as Array<Record<string, unknown>>);
    expect(decryptedList).toEqual(list);
  });

  it('returns placeholder "…" when vault is locked and does not crash', async () => {
    const original = { id: 'l1', name: 'Секретная метка', color: '#123456' };
    const encrypted = await encryptLabel(original, 'user_1');

    // Lock vault
    useEncryptionStore.getState().setKey(null);

    const decrypted = await decryptLabel(encrypted as unknown as Record<string, unknown>);
    expect(decrypted.id).toBe('l1');
    expect(decrypted.color).toBe('#123456');
    expect(decrypted.name).toBe('…');
  });

  it('refuses to encrypt labels when vault is locked and encryption enabled', async () => {
    useEncryptionStore.getState().setKey(null); // Lock vault
    const label = { id: 'l1', name: 'Метка', color: '#123456' };

    await expect(encryptLabels([label], 'user_1')).rejects.toThrow('ENCRYPT_REQUIRED');
  });

  it('migrateUnencryptedLabels encrypts unencrypted cloud labels and is idempotent', async () => {
    const rawLegacyLabels = [
      { id: 'l1', name: 'Практика6', color: '#D04545' }, // unencrypted
    ];

    const migrated = await migrateUnencryptedLabels('user_1', rawLegacyLabels);
    expect(migrated).toBe(true);
    expect(DataProvider.updateProfile).toHaveBeenCalledWith('user_1', {
      labels: [
        expect.objectContaining({
          id: 'l1',
          color: '#D04545',
          _encrypted: true,
          name: expect.not.stringContaining('Практика6'),
        }),
      ],
    });

    // Second run with already encrypted labels: no-op
    const encryptedLabels = await encryptLabels([{ id: 'l1', name: 'Практика6', color: '#D04545' }], 'user_1');
    const migratedSecond = await migrateUnencryptedLabels('user_1', encryptedLabels as unknown as Record<string, unknown>[]);
    expect(migratedSecond).toBe(false);
  });

  // Круг «прочитать — показать — сохранить» здесь замыкается на одном списке:
  // метки пишутся целиком при любой правке. Значит нерасшифрованное имя,
  // показанное заглушкой, нельзя зашифровать обратно — это стёрло бы настоящее
  // имя навсегда, потому что поверх шифротекста лёг бы шифротекст «…».
  describe('нерасшифрованное имя не затирается заглушкой', () => {
    it('сохраняет исходный шифротекст, когда сейф заперт', async () => {
      const original = await encryptLabel({ id: 'l1', name: 'Развод', color: '#111' }, 'user_1');

      useEncryptionStore.getState().lockVault();
      const shown = await decryptLabel(original as unknown as Record<string, unknown>);
      expect(shown.name).toBe('…');

      useEncryptionStore.getState().setKey(sessionKey);
      const written = await encryptLabel(shown, 'user_1');
      expect(written.name).toBe(original.name);

      const back = await decryptLabel(written as unknown as Record<string, unknown>);
      expect(back.name).toBe('Развод');
    });

    it('не пишет служебные поля заглушки в облако', async () => {
      const original = await encryptLabel({ id: 'l1', name: 'Долги', color: '#222' }, 'user_1');
      useEncryptionStore.getState().lockVault();
      const shown = await decryptLabel(original as unknown as Record<string, unknown>);
      useEncryptionStore.getState().setKey(sessionKey);

      const written = await encryptLabel(shown, 'user_1') as unknown as Record<string, unknown>;
      expect(written._undecrypted).toBeUndefined();
      expect(written._cipherName).toBeUndefined();
    });

    it('добавление метки при запертом сейфе не уносит имена соседних', async () => {
      const existing = await encryptLabels(
        [{ id: 'l1', name: 'Терапия', color: '#111' }, { id: 'l2', name: 'Практика6', color: '#222' }],
        'user_1',
      );

      useEncryptionStore.getState().lockVault();
      const shown = await decryptLabels(existing as unknown as Record<string, unknown>[]);
      useEncryptionStore.getState().setKey(sessionKey);

      const saved = await encryptLabels([...shown, { id: 'l3', name: 'Новая', color: '#333' }], 'user_1');
      const restored = await decryptLabels(saved as unknown as Record<string, unknown>[]);
      expect(restored.map(l => l.name)).toEqual(['Терапия', 'Практика6', 'Новая']);
    });
  });
});
