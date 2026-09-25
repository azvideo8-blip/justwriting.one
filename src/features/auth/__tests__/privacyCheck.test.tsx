import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { usePrivacyCheck } from '../components/usePrivacyCheck';
import { PRIVACY_VERSION } from '../../../core/constants/privacyVersion';

// Mock the data facade, not a provider. The hook reads
// DataProvider.getProfile(); mocking the old firestoreClient left the real
// provider in place, so the read never resolved to anything and this file's
// other two cases passed by asserting on absence.
const mockGetProfile = vi.fn();
vi.mock('../../../core/data', () => ({
  DataProvider: {
    getProfile: (...args: unknown[]) => mockGetProfile(...args),
    updateProfile: vi.fn(),
  },
}));

let authStatus: { user: { uid: string } | null; authState: string } = { user: null, authState: 'loading' };
vi.mock('../../../app/useAuthStatus', () => ({
  useAuthStatus: () => authStatus,
}));

// Firebase restores the session asynchronously, so auth.currentUser is almost
// always null at mount. Reading it once returned on the first line and never ran
// again — nobody was ever asked for consent.
describe('usePrivacyCheck waits for the restored session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    authStatus = { user: null, authState: 'loading' };
    mockGetProfile.mockResolvedValue(null);
  });

  it('asks a user who only appears after mount', async () => {
    const { result, rerender } = renderHook(() => usePrivacyCheck());
    expect(result.current.showPrivacy).toBe(false);

    authStatus = { user: { uid: 'u1' }, authState: 'authenticated' };
    rerender();

    await waitFor(() => expect(result.current.showPrivacy).toBe(true));
  });

  it('does not ask again when consent for the current version is cached locally', async () => {
    localStorage.setItem('privacy_accepted_u1', String(PRIVACY_VERSION));
    authStatus = { user: { uid: 'u1' }, authState: 'authenticated' };

    const { result } = renderHook(() => usePrivacyCheck());

    await waitFor(() => expect(mockGetProfile).not.toHaveBeenCalled());
    expect(result.current.showPrivacy).toBe(false);
  });

  // Согласие, данное на прежний текст, нового не покрывает: формулировки
  // изменились содержательно (в версии 2 сказано, что запрос к модели может уйти
  // за границу), и человек должен увидеть это, а не унаследовать старое «да».
  it('asks again when the accepted consent is older than the current text', async () => {
    localStorage.setItem('privacy_accepted_u1', '1');
    mockGetProfile.mockResolvedValueOnce({ privacyAcceptedAt: new Date(), privacyVersion: 1 });
    authStatus = { user: { uid: 'u1' }, authState: 'authenticated' };

    const { result } = renderHook(() => usePrivacyCheck());

    await waitFor(() => expect(result.current.showPrivacy).toBe(true));
  });

  it('does not ask when the profile already carries the current version', async () => {
    mockGetProfile.mockResolvedValueOnce({ privacyAcceptedAt: new Date(), privacyVersion: PRIVACY_VERSION });
    authStatus = { user: { uid: 'u1' }, authState: 'authenticated' };

    const { result } = renderHook(() => usePrivacyCheck());

    await waitFor(() => expect(result.current.showPrivacy).toBe(false));
  });

  it('ignores a late answer about the account that just got switched away', async () => {
    let release: (v: unknown) => void = () => {};
    mockGetProfile.mockReturnValueOnce(new Promise(res => { release = res; }));
    authStatus = { user: { uid: 'u1' }, authState: 'authenticated' };

    const { result, rerender } = renderHook(() => usePrivacyCheck());

    // u1 signs out before the read comes back; the pending answer is about them.
    authStatus = { user: null, authState: 'guest' };
    rerender();

    // Let the late answer land before asserting — waiting for `false` alone
    // would pass simply by checking too early.
    await act(async () => {
      release(null);
      await new Promise(r => setTimeout(r, 0));
    });

    expect(result.current.showPrivacy).toBe(false);
  });

  // Мастер приглашения: ссылка из письма уже дала сессию, но согласие берёт
  // мастер. Решение «показать окно» принималось по ссылке и не пересматривалось
  // после мастера — человек видел политику второй раз подряд.
  it('does not decide while the invite wizard is open, and reads its consent afterwards', async () => {
    authStatus = { user: { uid: 'u1' }, authState: 'authenticated' };
    const { result, rerender } = renderHook(({ suspended }) => usePrivacyCheck(suspended), {
      initialProps: { suspended: true },
    });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.showPrivacy).toBe(false);

    localStorage.setItem('privacy_accepted_u1', String(PRIVACY_VERSION)); // мастер записал согласие
    rerender({ suspended: false });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.showPrivacy).toBe(false);
  });

  it('still asks after /reset-password when nobody took consent there', async () => {
    authStatus = { user: { uid: 'u1' }, authState: 'authenticated' };
    const { result, rerender } = renderHook(({ suspended }) => usePrivacyCheck(suspended), {
      initialProps: { suspended: true },
    });
    await act(async () => { await Promise.resolve(); });
    rerender({ suspended: false });
    await waitFor(() => expect(result.current.showPrivacy).toBe(true));
  });
});
