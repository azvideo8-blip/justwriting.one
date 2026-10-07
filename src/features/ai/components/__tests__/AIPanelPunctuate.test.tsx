import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AIPanelContent } from '../AIPanel';
import { AIService } from '../../services/AIService';
import { useAiLimitStore } from '../../store/useAiLimitStore';

// «Расставить знаки» для диктовки: применяется, только если ИИ не тронул слова,
// и заменяет текст, а не дописывает к нему.

vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k, language: 'ru' }) }));
vi.mock('../../../../shared/ai/aiErrorUtils', () => ({ aiErrorToText: (k: string) => k }));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => null }));
vi.mock('../../services/AIService', () => ({ AIService: { process: vi.fn() } }));

const DICTATED = 'сегодня я долго думала о переезде мама опять звонила';

describe('«Расставить знаки»', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAiLimitStore.setState({ remaining: 5 });
  });

  it('знаки расставлены, слова те же — «Применить» заменяет текст целиком', async () => {
    const fixed = 'Сегодня я долго думала о переезде. Мама опять звонила.';
    vi.mocked(AIService.process).mockResolvedValue({ ok: true, text: fixed });
    const onApply = vi.fn();
    render(<AIPanelContent content={DICTATED} onApplyContent={onApply} />);
    fireEvent.click(screen.getByText('ai_action_punctuate'));
    expect(await screen.findByText(fixed)).toBeInTheDocument();
    fireEvent.click(screen.getByText('ai_apply'));
    expect(onApply).toHaveBeenCalledWith(fixed);
    expect(vi.mocked(AIService.process).mock.calls[0]?.[1]).toBe('punctuate');
  });

  it('ИИ изменил слово — результат отброшен, применить нечего', async () => {
    vi.mocked(AIService.process).mockResolvedValue({ ok: true, text: 'Сегодня я долго размышляла о переезде. Мама опять звонила.' });
    const onApply = vi.fn();
    render(<AIPanelContent content={DICTATED} onApplyContent={onApply} />);
    fireEvent.click(screen.getByText('ai_action_punctuate'));
    expect(await screen.findByText('ai_punctuate_words_changed')).toBeInTheDocument();
    expect(screen.queryByText('ai_apply')).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('текст изменился после запроса — замена не применяется', async () => {
    const fixed = 'Сегодня я долго думала о переезде. Мама опять звонила.';
    vi.mocked(AIService.process).mockResolvedValue({ ok: true, text: fixed });
    const onApply = vi.fn();
    const { rerender } = render(<AIPanelContent content={DICTATED} onApplyContent={onApply} />);
    fireEvent.click(screen.getByText('ai_action_punctuate'));
    await screen.findByText(fixed);
    rerender(<AIPanelContent content={`${DICTATED} и ещё дописала`} onApplyContent={onApply} />);
    fireEvent.click(screen.getByText('ai_apply'));
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByText('ai_punctuate_stale')).toBeInTheDocument();
  });
});
