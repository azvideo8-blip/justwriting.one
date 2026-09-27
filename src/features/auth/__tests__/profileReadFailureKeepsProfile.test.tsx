import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';

/**
 * SB-5 (`sync-failure-modes/01`): отказ чтения профиля приходит в контекст тем же
 * `onUpdate(null)`, что и отсутствие строки (providers/profiles.ts:40). Контекст на
 * null идёт создавать профиль — и единственная преграда между «Postgres моргнул» и
 * «ник человека перезаписан значением из auth-профиля» — повторное чтение. Оно тоже
 * падает во время отказа, но раньше его отказ считался тем же «профиля нет».
 */

let capturedOnUpdate: ((data: unknown, unavailable?: boolean) => void) | null = null;

const mocks = vi.hoisted(() => {
  const chain: Record<string, unknown> = {};
  const maybeSingle = vi.fn(() => Promise.resolve({ data: null as unknown, error: { message: 'connection refused' } as unknown }));
  chain.maybeSingle = maybeSingle;
  chain.eq = () => chain;
  chain.select = () => chain;
  return {
    updateProfile: vi.fn(),
    providerGetProfile: vi.fn(),
    serviceGetProfile: vi.fn(),
    setProfileLoaded: vi.fn(),
    setEncryptionEnabled: vi.fn(),
    reportError: vi.fn(),
    maybeSingle,
    dbClient: { from: () => chain },
  };
});

vi.mock('../../../core/supabase/client', () => ({ getSupabase: () => mocks.dbClient }));

vi.mock('../../../core/data', () => ({
  DataProvider: {
    subscribeToProfile: (_uid: string, onUpdate: (data: unknown, unavailable?: boolean) => void) => {
      capturedOnUpdate = onUpdate;
      return () => { capturedOnUpdate = null; };
    },
    getProfile: mocks.providerGetProfile,
    updateProfile: mocks.updateProfile,
  },
}));

vi.mock('../../../core/crypto/cryptoHelpers', () => ({
  setEncryptionEnabled: mocks.setEncryptionEnabled,
  setProfileLoaded: mocks.setProfileLoaded,
}));

vi.mock('../../../shared/errors/reportError', () => ({ reportError: mocks.reportError }));

vi.mock('../../../core/services/ProfileService', () => ({
  ProfileService: { getProfile: mocks.serviceGetProfile },
}));

vi.mock('../../auth/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'user-sb5', email: 'a@b.c', displayName: 'Анфиса' } }),
}));

const { ProfileProvider } = await import('../../auth/contexts/ProfileContext');

describe('SB-5: «не прочитали» — не то же самое, что «профиля нет»', () => {
  beforeEach(() => {
    capturedOnUpdate = null;
    vi.clearAllMocks();
    mocks.updateProfile.mockResolvedValue(undefined);
    mocks.providerGetProfile.mockResolvedValue(null);
  });

  function renderProvider() {
    render(<ProfileProvider><div /></ProfileProvider>);
  }

  it('первичное чтение упало — до повторного не доходим и строку не создаём', async () => {
    // Повторное чтение здесь ответило бы «строки нет» — отказ чтения не даёт
    // повода ему верить, поэтому путь создания вообще не должен начаться.
    mocks.serviceGetProfile.mockResolvedValue({ data: null, error: false });
    renderProvider();
    await waitFor(() => expect(capturedOnUpdate).not.toBeNull());

    await act(async () => { capturedOnUpdate!(null, true); });

    expect(mocks.serviceGetProfile).not.toHaveBeenCalled();
    expect(mocks.updateProfile).not.toHaveBeenCalled();
    expect(mocks.setProfileLoaded).not.toHaveBeenCalled();
  });

  it('строки точно нет — профиль создаётся, как и раньше', async () => {
    mocks.serviceGetProfile.mockResolvedValue({ data: null, error: false });
    renderProvider();
    await waitFor(() => expect(capturedOnUpdate).not.toBeNull());

    await act(async () => { capturedOnUpdate!(null); });

    await waitFor(() => expect(mocks.updateProfile).toHaveBeenCalledTimes(1));
    expect(mocks.setProfileLoaded).toHaveBeenCalledWith('user-sb5', true);
  });

  it('строки точно нет, но повторное чтение упало — тоже не создаём', async () => {
    mocks.serviceGetProfile.mockResolvedValue({ data: null, error: true });
    renderProvider();
    await waitFor(() => expect(capturedOnUpdate).not.toBeNull());

    await act(async () => { capturedOnUpdate!(null); });

    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });

  it('отказ первичного чтения не остаётся без единого упоминания', async () => {
    const { subscribeToProfile } = await import('../../../core/data/providers/profiles');

    const onUpdate = vi.fn();
    subscribeToProfile('user-sb5', onUpdate);
    await waitFor(() => expect(onUpdate).toHaveBeenCalled());

    expect(mocks.reportError).toHaveBeenCalled();
    expect(onUpdate.mock.calls[0]?.[0]).toBeNull();
    expect(onUpdate.mock.calls[0]?.[1]).toBe(true);
  });

  it('отказ чтения повторяется сам: приложение, открытое офлайн, получает профиль, когда база ответила', async () => {
    // Без повтора профиль оставался незагруженным до перезагрузки страницы, и
    // облачные записи падали с ENCRYPT_REQUIRED: profile not loaded.
    vi.useFakeTimers();
    try {
      const { subscribeToProfile } = await import('../../../core/data/providers/profiles');
      mocks.maybeSingle
        .mockResolvedValueOnce({ data: null, error: { message: 'offline' } })
        .mockResolvedValueOnce({ data: { uid: 'user-sb5', nickname: 'Анфиса' }, error: null });

      const onUpdate = vi.fn();
      const stop = subscribeToProfile('user-sb5', onUpdate);
      await vi.advanceTimersByTimeAsync(0);
      expect(onUpdate).toHaveBeenLastCalledWith(null, true);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(onUpdate.mock.calls.at(-1)?.[0]).toMatchObject({ uid: 'user-sb5', nickname: 'Анфиса' });
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
