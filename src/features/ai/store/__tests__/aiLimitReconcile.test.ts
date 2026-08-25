// AUDIT-part3 3: reconciled — семантика «локальный счётчик vs сервер».
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
});

// callAi мокается: сервер — единственный источник reconciled:true.
const callAiMock = vi.fn();
vi.mock('../../../../core/ai/callAi', () => ({
  callAi: (...a: unknown[]) => callAiMock(...a),
}));

import { useAiLimitStore } from '../useAiLimitStore';

describe('quota reconcile (AUDIT-part3 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(store)) delete store[k];
    useAiLimitStore.setState({ used: 0, remaining: 30, limit: 30, isAdmin: false, reconciled: false, loaded: false });
  });

  it('loadLimit marks the local count as NOT reconciled', () => {
    store['ai_daily_usage'] = JSON.stringify({ count: 5, date: new Date().toISOString().slice(0, 10) });
    useAiLimitStore.getState().loadLimit();
    expect(useAiLimitStore.getState().used).toBe(5);
    expect(useAiLimitStore.getState().reconciled).toBe(false);
  });

  it('loadLimitFromServer adopts the server numbers and sets reconciled', async () => {
    callAiMock.mockResolvedValue({ used: 12, limit: 30, date: new Date().toISOString().slice(0, 10) });
    await useAiLimitStore.getState().loadLimitFromServer();
    const s = useAiLimitStore.getState();
    expect(s.used).toBe(12);
    expect(s.remaining).toBe(18);
    expect(s.reconciled).toBe(true);
  });

  it('server count lower than local wins (restore/second-tab drift)', async () => {
    store['ai_daily_usage'] = JSON.stringify({ count: 25, date: new Date().toISOString().slice(0, 10) });
    useAiLimitStore.getState().loadLimit();
    expect(useAiLimitStore.getState().remaining).toBe(5);

    callAiMock.mockResolvedValue({ used: 3, limit: 30, date: new Date().toISOString().slice(0, 10) });
    await useAiLimitStore.getState().loadLimitFromServer();
    const s = useAiLimitStore.getState();
    expect(s.used).toBe(3);
    expect(s.remaining).toBe(27);
    expect(s.reconciled).toBe(true);
  });

  it('on network failure falls back to local and stays unreconciled', async () => {
    store['ai_daily_usage'] = JSON.stringify({ count: 4, date: new Date().toISOString().slice(0, 10) });
    callAiMock.mockRejectedValue(new Error('NETWORK'));
    await useAiLimitStore.getState().loadLimitFromServer();
    const s = useAiLimitStore.getState();
    expect(s.used).toBe(4);
    expect(s.reconciled).toBe(false);
  });

  it('stale server date resets the counter to zero', async () => {
    callAiMock.mockResolvedValue({ used: 29, limit: 30, date: '2026-01-01' });
    await useAiLimitStore.getState().loadLimitFromServer();
    const s = useAiLimitStore.getState();
    expect(s.used).toBe(0);
    expect(s.reconciled).toBe(true);
  });
});

// AUDIT-part3 3 (доводка): серверный лимит нельзя зажимать клиентской
// константой. Именно этот дрейф пункт и чинил: ADMIN_LIMIT = 20 на клиенте
// против AI_ADMIN_DAILY_LIMIT = 60 на сервере. Math.min() возвращал 20 —
// админ видел втрое меньший остаток, чем ему на самом деле разрешено.
// Фальсификация: вернуть Math.min(ADMIN_LIMIT, quota.limit) — тест краснеет.
describe('AUDIT-part3: серверный лимит побеждает клиентскую константу', () => {
  beforeEach(() => {
    callAiMock.mockReset();
    useAiLimitStore.setState({ used: 0, remaining: 20, limit: 20, isAdmin: true, reconciled: false, loaded: false });
  });

  it('админ получает серверные 60, а не клиентские 20', async () => {
    callAiMock.mockResolvedValue({ used: 5, limit: 60, date: new Date().toISOString().slice(0, 10) });

    await useAiLimitStore.getState().loadLimitFromServer();

    const s = useAiLimitStore.getState();
    expect(s.limit).toBe(60);
    expect(s.remaining).toBe(55);
    expect(s.reconciled).toBe(true);
  });

  it('битый ответ не обнуляет лимит, а падает на заглушку', async () => {
    callAiMock.mockResolvedValue({ used: 1, limit: 0, date: new Date().toISOString().slice(0, 10) });

    await useAiLimitStore.getState().loadLimitFromServer();

    expect(useAiLimitStore.getState().limit).toBeGreaterThan(0);
  });
});
