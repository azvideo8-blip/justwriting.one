// PIN-1: «Обновить профиль» — упавший шаг и бросок названы error-тостом,
// а не зелёным «Профиль обновлён». Компонент настоящий; моки только края:
// оркестратор ИИ-вызовов, тост, отчёт об ошибках, контекст лимита.
// Мутации: if (failed.length === 0) → if (true); убрать catch-тост — красные.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { LanguageProvider } from '../../../../shared/i18n';

const { mockRefresh, mockShowToast } = vi.hoisted(() => ({
  mockRefresh: {
    estimate: vi.fn(),
    run: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    getCurrentStep: vi.fn(() => null),
  },
  mockShowToast: vi.fn(),
}));

vi.mock('../../services/AIProfileRefreshService', () => ({ AIProfileRefreshService: mockRefresh }));
vi.mock('../../hooks/useDailyLimit', () => ({
  useDailyLimit: () => ({
    used: 0, limit: 100, remaining: 100,
    reasoningUsed: 0, reasoningLimit: 10, reasoningRemaining: 10,
    resetsAt: new Date(), limitUnknown: false,
  }),
}));
vi.mock('../../store/useAiLimitStore', () => ({
  useAiLimitStore: { getState: () => ({ useRequest: vi.fn(), loadLimitFromServer: vi.fn() }) },
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { ProfileRefreshButton } from '../ProfileRefreshButton';

const ESTIMATE = { steps: [{ key: 'facets', calls: 2 }], totalCalls: 2, limitCalls: 2, seconds: 30 };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('language', 'ru');
  mockRefresh.estimate.mockResolvedValue(ESTIMATE);
  mockRefresh.subscribe.mockImplementation(() => () => {});
  mockRefresh.getCurrentStep.mockReturnValue(null);
});
afterEach(cleanup);

async function openAndStart() {
  render(<ProfileRefreshButton />, { wrapper: LanguageProvider });
  fireEvent.click(screen.getByText('Обновить профиль'));
  fireEvent.click(await screen.findByText('Обновить'));
}

describe('PIN-1: обновление профиля — отказ назван', () => {
  it('PIN-1: шаг упал — error «Обновлено частично», не успех', async () => {
    mockRefresh.run.mockResolvedValue({ failed: ['facets'] });
    await openAndStart();

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('Обновлено частично'), 'error'));
    expect(mockShowToast).not.toHaveBeenCalledWith('Профиль обновлён', 'success');
  });

  it('PIN-1: run бросил — error «Обновление не удалось», не тишина', async () => {
    mockRefresh.run.mockRejectedValue(new Error('SYNTHETIC_AI_DOWN'));
    await openAndStart();

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('Обновление не удалось', 'error'));
    expect(mockShowToast).not.toHaveBeenCalledWith('Профиль обновлён', 'success');
  });

  it('PIN-1 контроль: все шаги прошли — зелёный «Профиль обновлён»', async () => {
    mockRefresh.run.mockResolvedValue({ failed: [] });
    await openAndStart();

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('Профиль обновлён', 'success'));
    expect(mockShowToast.mock.calls.filter(c => c[1] === 'error')).toHaveLength(0);
  });
});