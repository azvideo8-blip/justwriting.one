import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AIPanelContent } from '../AIPanel';
import { AIService } from '../../services/AIService';
import { useAiLimitStore } from '../../store/useAiLimitStore';

// D-8: на исчерпанном ДНЕВНОМ лимите панель писала «Слишком много запросов.
// Подожди минуту.» — совет, который ничего не даёт: ждать минуту бессмысленно.
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, language: 'ru' }),
}));
vi.mock('../../../../shared/ai/aiErrorUtils', () => ({
  aiErrorToText: (k: string) => k,
}));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => null }));
vi.mock('../../services/AIService', () => ({
  AIService: { process: vi.fn() },
}));

describe('AIPanel daily limit message (D-8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAiLimitStore.setState({ remaining: 0 });
  });

  it('says the daily limit is reached, not "wait a minute"', () => {
    render(<AIPanelContent content="текст заметки для разбора" />);
    fireEvent.click(screen.getByText('ai_action_summarize'));

    expect(screen.getByText('ai_error_daily_limit')).toBeInTheDocument();
    expect(screen.queryByText('ai_error_rate_limit')).not.toBeInTheDocument();
    expect(AIService.process).not.toHaveBeenCalled();
  });

  it('still runs the action while requests remain', async () => {
    useAiLimitStore.setState({ remaining: 3 });
    vi.mocked(AIService.process).mockResolvedValue({ ok: true, text: 'разбор' });

    render(<AIPanelContent content="текст заметки для разбора" />);
    fireEvent.click(screen.getByText('ai_action_summarize'));

    expect(await screen.findByText('разбор')).toBeInTheDocument();
    expect(AIService.process).toHaveBeenCalled();
  });
});
