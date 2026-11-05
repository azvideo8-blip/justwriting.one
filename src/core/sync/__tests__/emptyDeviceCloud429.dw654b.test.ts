// DW6-5.4 (находка ревью 0.11.6): проверка «на этом устройстве пусто, а в облаке
// есть» читала облако БЕЗ общего тормоза 429, а любой её сбой записывал
// `{ prompt: false }` — то есть «предложения нет». Это класс «нет ответа ≠ нет»:
// отбитый 429 убирал вопрос о восстановлении до следующего перезапуска, а
// прочитанные раньше числа стирались из решения.
//
// Мутации: снять `withRateLimitRetry` — краснеет кейс 1; вернуть `write(uid,
// { prompt: false })` в `catch` — краснеет кейс 2.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({ user: { uid: 'u_dw654b' }, isGuest: false }),
}));
vi.mock('../../crypto/encrypt', () => ({ isVaultUnlocked: () => true }));
vi.mock('../../crypto/cryptoHelpers', () => ({ getEncryptionEnabled: () => false }));

const mockLocal = vi.fn();
const mockCloud = vi.fn();
vi.mock('../../services/LocalStorageService', () => ({
  LocalStorageService: { getDocumentsByOwner: (...a: unknown[]) => mockLocal(...a) },
}));
vi.mock('../../services/DocumentService', () => ({
  DocumentService: { getUserDocuments: (...a: unknown[]) => mockCloud(...a) },
}));

import { useEmptyDeviceDetection } from '../useEmptyDeviceDetection';
import { rateLimitTuning } from '../../services/rateGate';

const RATE_LIMITED = () => new Error('<html><body>Too Many Requests</body></html>');
const realTuning = { ...rateLimitTuning };

function docs(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `doc_${i}` }));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  rateLimitTuning.baseMs = 1;
  rateLimitTuning.maxMs = 1;
  mockLocal.mockResolvedValue([]);
  mockCloud.mockResolvedValue(docs(3));
});

afterEach(() => {
  Object.assign(rateLimitTuning, realTuning);
});

describe('DW6-5.4: облако в проверке пустого прибора читается под тормозом и без решений по сбоям', () => {
  it('429 на чтении облака повторяется, а не превращается в «предложения нет»', async () => {
    mockCloud
      .mockRejectedValueOnce(RATE_LIMITED())
      .mockResolvedValue(docs(3));

    const { result } = renderHook(() => useEmptyDeviceDetection());

    await waitFor(() => expect(result.current.shouldPrompt).toBe(true), { timeout: 5_000 });
    expect(result.current.cloudCount).toBe(3);
    expect(mockCloud.mock.calls.length, '429 не повторён — чтение облака без тормоза').toBeGreaterThanOrEqual(2);
  });

  it('нет ответа: прочитанное предложение остаётся, числа не стираются', async () => {
    const { result } = renderHook(() => useEmptyDeviceDetection());
    await waitFor(() => expect(result.current.shouldPrompt).toBe(true));

    mockCloud.mockRejectedValue(new Error('NETWORK: облако не ответило'));
    await act(async () => { await result.current.recheck(); });

    expect(result.current.shouldPrompt, 'сбой чтения облака решил за человека: «предложения нет»').toBe(true);
    expect(result.current.cloudCount, 'сбой чтения обнулил прочитанное число облака').toBe(3);
  });

  it('отклонённое человеком предложение сбой чтения не возвращает', async () => {
    const { result } = renderHook(() => useEmptyDeviceDetection());
    await waitFor(() => expect(result.current.shouldPrompt).toBe(true));
    act(() => { result.current.dismiss(); });
    expect(result.current.shouldPrompt).toBe(false);

    mockCloud.mockRejectedValue(new Error('NETWORK: облако не ответило'));
    await act(async () => { await result.current.recheck(); });

    expect(result.current.shouldPrompt).toBe(false);
  });
});
