import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// R7Q-013 и R7Q-015: в Safari с «блокировать все файлы cookie» (и в Chrome в
// инкогнито с отключённым хранилищем) ЛЮБОЕ обращение к localStorage бросает
// SecurityError. Оба места раньше считали, что хранилище есть всегда:
//  - savePrivacyConsent — бросок после записи в базу превращал принятое согласие
//    в ошибку на весь мастер приглашения;
//  - useSyncConsentCheck — необработанный reject async-функции, после которого
//    showConsent так и не становился true: вопрос про облачную синхронизацию на
//    новом устройстве не задавался никогда.

const auth = vi.hoisted(() => ({
  value: {
    user: { uid: 'u-ls', email: 'someone@example.com' } as { uid: string; email: string } | null,
    isAuthenticated: true,
    isGuest: false,
    authState: 'authenticated',
  },
}));
vi.mock('../../../auth/hooks/useAuthStatus', () => ({
  useAuthStatus: () => auth.value,
}));

const updateProfile = vi.hoisted(() => vi.fn(async (..._a: unknown[]): Promise<void> => undefined));
vi.mock('../../../../core/data', () => ({
  DataProvider: { updateProfile: (...a: unknown[]) => updateProfile(...a) },
}));

import { useSyncConsentCheck } from '../useSyncConsentCheck';
import { savePrivacyConsent } from '../../../auth/components/PrivacyConsentBody';

/** Как выглядит сломанное хранилище: любое обращение бросает. */
function breakLocalStorage(): void {
  const boom = () => { throw new DOMException('SecurityError', 'SecurityError'); };
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: { getItem: boom, setItem: boom, removeItem: boom, clear: boom, key: boom, length: 0 },
  });
}

describe('R7Q-013: согласие принято, даже если кэш не записался', () => {
  beforeEach(() => {
    updateProfile.mockClear();
    vi.stubGlobal('localStorage', {
      getItem: () => null, setItem: () => undefined, removeItem: () => undefined,
      clear: () => undefined, key: () => null, length: 0,
    } as unknown as Storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('setItem бросает — savePrivacyConsent не бросает, профиль записан', async () => {
    breakLocalStorage();
    await expect(savePrivacyConsent('u-ls', true)).resolves.toBeUndefined();
    expect(updateProfile).toHaveBeenCalledTimes(1);
    const patch = updateProfile.mock.calls[0]![1] as Record<string, unknown> | undefined;
    expect(patch?.privacyVersion, 'согласие в базе — это истина, кэш лишь ускорение').toBeDefined();
    expect(patch?.aiConsentVersion, 'согласие на спецкатегории тоже в базе').toBeDefined();
  });

  it('рабочее хранилище по-прежнему получает отметку кэша', async () => {
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', {
      getItem: () => null, setItem, removeItem: () => undefined,
      clear: () => undefined, key: () => null, length: 0,
    } as unknown as Storage);
    await savePrivacyConsent('u-ls', true);
    expect(setItem).toHaveBeenCalledWith('privacy_accepted_u-ls', expect.any(String));
  });
});

describe('R7Q-015: сломанное хранилище не отменяет вопрос про облако', () => {
  beforeEach(() => {
    auth.value = {
      user: { uid: 'u-ls', email: 'someone@example.com' },
      isAuthenticated: true,
      isGuest: false,
      authState: 'authenticated',
    };
  });

  it('getItem бросает — окно всё равно показывается', async () => {
    breakLocalStorage();
    const { result, unmount } = renderHook(() => useSyncConsentCheck());
    await waitFor(() => expect(result.current.showConsent).toBe(true));
    unmount();
  });

  it('перенос legacy-ключей: чтение есть, запись бросает — окно показывается', async () => {
    // Ветрка LS-2 (перенос не-аккаунтных ключей) пишет и удаляет. Если хотя бы
    // одна из этих операций бросит, а async-функция не будет закрыта, у
    // прогона останется необработанный reject, и setShowConsent до него не дойдёт.
    const boom = () => { throw new DOMException('SecurityError', 'SecurityError'); };
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (k === 'auto_sync_enabled' ? 'true' : k === 'auto_sync_asked' ? 'true' : null),
      setItem: boom,
      removeItem: boom,
      clear: () => undefined,
      key: () => null,
      length: 0,
    } as unknown as Storage);
    const { result, unmount } = renderHook(() => useSyncConsentCheck());
    await waitFor(() => expect(result.current.showConsent).toBe(true));
    unmount();
  });

  it('хранилище живо и ключей нет — окно показывается (прежнее поведение целое)', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as unknown as Storage);
    const { result, unmount } = renderHook(() => useSyncConsentCheck());
    await waitFor(() => expect(result.current.showConsent).toBe(true));
    unmount();
  });

  it('ответ уже дан — окна нет', async () => {
    const store = new Map<string, string>([['auto_sync_asked_u-ls', 'true']]);
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as unknown as Storage);
    const { result, unmount } = renderHook(() => useSyncConsentCheck());
    await new Promise(res => setTimeout(res, 10));
    expect(result.current.showConsent).toBe(false);
    unmount();
  });
});
