// MC-5 §4: действия под ответом на телефоне — ряд иконок 44 px + «⋯», а не пять
// текстовых ссылок по 10 px. Десктопный ряд не изменён.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AssistantTurn } from '../AIChatPresentational';

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru' }),
}));

const ANSWER = 'Текст ответа.';
const PERSONA = 'Группа консультантов';

const handlers = {
  onCopy: vi.fn(),
  onCreateNote: vi.fn(),
  onFeedback: vi.fn(),
  onRegenerate: vi.fn(),
  onDelete: vi.fn(),
};

function renderTurn(isMobile: boolean) {
  return render(
    <AssistantTurn name={PERSONA} color="#A583E8" mono="Гп" isMobile={isMobile} {...handlers}>
      <p>{ANSWER}</p>
    </AssistantTurn>,
  );
}

describe('MC-5: ряд действий под ответом', () => {
  beforeEach(() => { cleanup(); vi.clearAllMocks(); });

  it('на телефоне — четыре цели по 44 px, текстовых ссылок нет', () => {
    const { container } = renderTurn(true);
    const buttons = screen.getAllByRole('button');
    expect(buttons.map(b => b.getAttribute('aria-label')).sort())
      .toEqual(['ai_action_copy', 'ai_action_create_note', 'ai_action_more', 'ai_action_thumbs_up']);
    for (const b of buttons) {
      expect(b.className, `${b.getAttribute('aria-label')} не 44 px`).toContain('h-11');
    }
    expect(container.textContent).not.toContain('ai_action_regenerate');
    expect(container.textContent).not.toContain('ai_action_delete');
  });

  it('«⋯» несёт «иначе», «Не то» и удаление', () => {
    renderTurn(true);
    fireEvent.click(screen.getByRole('button', { name: 'ai_action_more' }));
    const sheet = screen.getByRole('dialog');
    expect(sheet.textContent).toContain('ai_action_regenerate');
    expect(sheet.textContent).toContain('ai_action_thumbs_down');
    expect(sheet.textContent).toContain('ai_action_delete');
    fireEvent.click(screen.getByRole('button', { name: /ai_action_regenerate/ }));
    expect(handlers.onRegenerate).toHaveBeenCalledTimes(1);
  });

  it('на десктопе ряд остался текстовым', () => {
    renderTurn(false);
    expect(screen.getByRole('button', { name: /ai_action_copy/ }).textContent).toContain('ai_action_copy');
    expect(screen.queryByRole('button', { name: 'ai_action_more' })).toBeNull();
    expect(screen.getByRole('button', { name: /ai_action_delete/ })).toBeInTheDocument();
  });
});
