import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AIPanelContent } from '../AIPanel';
import { useAiLimitStore } from '../../store/useAiLimitStore';
import { AIService } from '../../services/AIService';

// D-6: кнопки «Расставить знаки» в панели ИИ больше нет — диктовка расставляет
// знаки сама (D-3/D-4), а эта кнопка отправляла на сервер всю заметку. Проверяется
// и отсутствие действия, и что остальные работают как раньше.
//
// Мутация: вернуть пункт 'punctuate' в AI_ACTIONS → первый случай красный.

vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k, language: 'ru' }) }));
vi.mock('../../../../shared/ai/aiErrorUtils', () => ({ aiErrorToText: (k: string) => k }));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => null }));
vi.mock('../../services/AIService', () => ({ AIService: { process: vi.fn() } }));

const NOTE = 'сегодня я долго думала о переезде';

describe('D-6: панель ИИ без «Расставить знаки»', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAiLimitStore.setState({ remaining: 5 });
  });

  it('действия с пунктуацией не рендерится, и рядом не видно прежних подсказок', () => {
    render(<AIPanelContent content={NOTE} onApplyContent={vi.fn()} />);
    expect(screen.queryByText('ai_action_punctuate')).toBeNull();
    expect(screen.queryByText('ai_punctuate_words_changed')).toBeNull();
    expect(screen.queryByText('ai_punctuate_stale')).toBeNull();
  });

  it('прочие действия на месте и работают как раньше: результат показан и применён с подписью', async () => {
    const out = 'Главная мысль: переезд откладывается.';
    vi.mocked(AIService.process).mockResolvedValue({ ok: true, text: out });
    const onApply = vi.fn();
    render(<AIPanelContent content={NOTE} onApplyContent={onApply} />);

    fireEvent.click(screen.getByText('ai_action_accents'));
    expect(await screen.findByText(out)).toBeInTheDocument();
    expect(vi.mocked(AIService.process).mock.calls[0]?.[1]).toBe('accents');

    fireEvent.click(screen.getByText('ai_apply'));
    expect(onApply).toHaveBeenCalledTimes(1);
    const applied = onApply.mock.calls[0]?.[0] as string;
    expect(applied).toContain('ai_action_accents');
    expect(applied.startsWith(NOTE)).toBe(true);
  });
});
