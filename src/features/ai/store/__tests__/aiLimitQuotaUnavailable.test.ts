// SA-2, store: «unavailable» — это не «ничего не изменилось».
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
});

const callAiMock = vi.fn();
vi.mock('../../../../core/ai/callAi', () => ({
  callAi: (...a: unknown[]) => callAiMock(...a),
  onAiQuotaHeaders: vi.fn(() => vi.fn()),
}));

import { useAiLimitStore } from '../useAiLimitStore';
import { setDailyLimitExhausted } from '../../hooks/useDailyLimit';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';

const today = () => new Date().toISOString().slice(0, 10);

const confirmed = {
  'x-ai-quota-used': '3',
  'x-ai-quota-limit': '30',
  'x-ai-reasoning-used': '1',
  'x-ai-reasoning-limit': '5',
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(store)) delete store[k];
  useAiLimitStore.setState({
    used: 0, remaining: 30, limit: 30, reasoningUsed: 0, reasoningRemaining: 5, reasoningLimit: 5,
    isAdmin: false, reconciled: false, loaded: false, limitUnknown: false,
  });
});

describe('SA-2: limitUnknown', () => {
  it('подтверждённое число снимает отметку недоступности', () => {
    useAiLimitStore.getState().syncFromHeaders(confirmed);
    const s = useAiLimitStore.getState();
    expect(s.used).toBe(3);
    expect(s.reconciled).toBe(true);
    expect(s.limitUnknown).toBe(false);
  });

  it('unavailable: число остаётся прежним, но перестаёт быть подтверждённым', () => {
    useAiLimitStore.getState().syncFromHeaders(confirmed);
    useAiLimitStore.getState().syncFromHeaders({ 'x-ai-quota-status': 'unavailable' });

    const s = useAiLimitStore.getState();
    expect(s.used).toBe(3);          // прошлое число не перетирается нулём
    expect(s.limitUnknown).toBe(true);
    expect(s.reconciled).toBe(false);
  });

  it('unavailable не переписывает локальный счётчик', () => {
    useAiLimitStore.getState().syncFromHeaders(confirmed);
    const written = store[STORAGE_KEYS.AI_LIMIT(undefined)];
    expect(JSON.parse(written!).count).toBe(3);

    useAiLimitStore.getState().syncFromHeaders({ 'x-ai-quota-status': 'unavailable' });
    expect(store[STORAGE_KEYS.AI_LIMIT(undefined)]).toBe(written);
  });

  it('отсутствие любых заголовков — не то же самое, что unavailable', async () => {
    // Офлайн-PWA: сети нет — число локальное, но «сервер сказал, что не знает»
    // тут не было, и паниковать ранчику не о чем.
    useAiLimitStore.getState().syncFromHeaders({});
    expect(useAiLimitStore.getState().limitUnknown).toBe(false);

    callAiMock.mockRejectedValue(new Error('NETWORK'));
    await useAiLimitStore.getState().loadLimitFromServer();
    expect(useAiLimitStore.getState().limitUnknown).toBe(false);
    expect(useAiLimitStore.getState().reconciled).toBe(false);
  });

  it('ответ /api/getAiQuota возвращает доверие к числу', async () => {
    useAiLimitStore.getState().syncFromHeaders(confirmed);
    useAiLimitStore.getState().syncFromHeaders({ 'x-ai-quota-status': 'unavailable' });
    expect(useAiLimitStore.getState().limitUnknown).toBe(true);

    callAiMock.mockResolvedValue({ used: 7, limit: 30, reasoningUsed: 0, reasoningLimit: 5, date: today() });
    await useAiLimitStore.getState().loadLimitFromServer();

    const s = useAiLimitStore.getState();
    expect(s.limitUnknown).toBe(false);
    expect(s.reconciled).toBe(true);
    expect(s.used).toBe(7);
  });

  it('429 — это сервер подтвердил исчерпание: отметка недоступности снимается', () => {
    useAiLimitStore.getState().syncFromHeaders(confirmed);
    useAiLimitStore.getState().syncFromHeaders({ 'x-ai-quota-status': 'unavailable' });

    setDailyLimitExhausted(false);
    const s = useAiLimitStore.getState();
    expect(s.limitUnknown).toBe(false);
    expect(s.remaining).toBe(0);
  });
});
