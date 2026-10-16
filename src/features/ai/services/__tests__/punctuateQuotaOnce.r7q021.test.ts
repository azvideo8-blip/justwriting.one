import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { punctuateDictation } from '../punctuateDictation';
import { AIService } from '../AIService';
import { useAiLimitStore } from '../../store/useAiLimitStore';

vi.mock('../../../../core/auth', () => ({
  getCurrentUser: vi.fn(() => ({ uid: 'u_q21', email: 'nobody-q21@example.invalid' })),
}));
vi.mock('../../../../core/ai/aiConsent', () => ({ getAiConsent: () => true }));
vi.mock('../AIService', () => ({ AIService: { process: vi.fn() } }));

// R7Q-021: `callAi` синхронизирует счётчик по пост-инкрементному заголовку
// `X-AI-Quota-Used`, а пунктуация диктовки списала запрос ЕЩЁ и локально.
// UI показывал на одно списание больше реального и — что хуже — это число
// ложилось в localStorage и переживало перезагрузку: «лимит исчерпан» при
// живом серверном остатке.
const RAW = 'сегодня был долгий день и я записал несколько мыслей';

function resetStore() {
  localStorage.clear();
  useAiLimitStore.setState({ used: 0, remaining: 30, limit: 30, headerSyncAt: 0, reconciled: false, limitUnknown: false });
}

describe('R7Q-021: пунктуация диктовки списывает запрос один раз', () => {
  beforeEach(() => {
    resetStore();
    vi.mocked(AIService.process).mockReset();
  });

  it('если сервер подтвердил счётчик заголовком — локального списания нет', async () => {
    vi.mocked(AIService.process).mockImplementation(async () => {
      useAiLimitStore.getState().syncFromHeaders({ 'x-ai-quota-used': '1', 'x-ai-quota-limit': '30' });
      return { ok: true, text: RAW };
    });

    const res = await punctuateDictation(RAW, {});

    expect(res.punctuated).toBe(true);
    expect(useAiLimitStore.getState().used).toBe(1);
    expect(useAiLimitStore.getState().remaining).toBe(29);
  });

  it('без заголовков (сервер не отдал лимиты) запрос списывается локально', async () => {
    vi.mocked(AIService.process).mockResolvedValue({ ok: true, text: RAW });

    const res = await punctuateDictation(RAW, {});

    expect(res.punctuated).toBe(true);
    expect(useAiLimitStore.getState().used).toBe(1);
  });
});
