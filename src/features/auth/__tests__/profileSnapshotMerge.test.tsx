import { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';

/**
 * Профиль в контексте собирается из снапшотов postgres_changes. Логическая
 * репликация не присылает неизменённые TOAST-значения, а fromDb выбрасывает
 * null'ы — поэтому у аккаунта с сейфом encryption_meta может просто
 * отсутствовать в payload очередного снапшота.
 *
 * Раньше снапшот заменял профиль целиком, и после любой чужой записи в строку
 * (например обновления счётчика слов) интерфейс решал, что шифрование не
 * настроено: раздел настроек предлагал завести сейф поверх существующего, а
 * импорт архива блокировался. Проверяем, что второй снапшот не стирает поле.
 */

let capturedOnUpdate: ((data: unknown) => void) | null = null;
vi.mock('../../../core/data', () => ({
  DataProvider: {
    subscribeToProfile: (_uid: string, onUpdate: (data: unknown) => void) => {
      capturedOnUpdate = onUpdate;
      return () => { capturedOnUpdate = null; };
    },
    getProfile: vi.fn().mockResolvedValue(null),
    updateProfile: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../core/crypto/cryptoHelpers', () => ({
  setEncryptionEnabled: vi.fn(),
  setProfileLoaded: vi.fn(),
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'user-1', email: 'a@b.c', displayName: 'A' } }),
}));

const { ProfileProvider, useProfile } = await import('../contexts/ProfileContext');

let seen: { encryptionMeta?: unknown; nickname?: unknown } | null = null;
function Probe() {
  const { profile } = useProfile();
  // Присваивание вынесено в эффект: линтер справедливо запрещает побочные
  // действия во время отрисовки, даже в тесте.
  useEffect(() => { seen = profile as typeof seen; }, [profile]);
  return null;
}

describe('ProfileContext: снапшот без encryption_meta', () => {
  beforeEach(() => { capturedOnUpdate = null; seen = null; });

  it('не стирает сейф, когда очередной снапшот пришёл без этого поля', async () => {
    render(<ProfileProvider><Probe /></ProfileProvider>);
    await waitFor(() => expect(capturedOnUpdate).not.toBeNull());

    await act(async () => { capturedOnUpdate!({ uid: 'user-1', email: 'a@b.c', encryptionMeta: { salt: 's', wrappedDataKey: 'k' } }); });
    await waitFor(() => expect(seen?.encryptionMeta).toBeTruthy());

    // Второй снапшот: строку изменил кто-то другой, TOAST-поле не приехало.
    await act(async () => { capturedOnUpdate!({ uid: 'user-1', email: 'a@b.c', nickname: 'Андрей' }); });
    await waitFor(() => expect(seen?.nickname).toBe('Андрей'));

    expect(seen?.encryptionMeta).toMatchObject({ salt: 's', wrappedDataKey: 'k' });
  });
});
