// MQ-9: лист «Выбери режим» — две группы с подписями («Сессия» / «Как писать»), иконки режимов
// одним приглушённым цветом (статус-цвета читались как предупреждения), текущий режим отмечен.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { MobileSessionSetupSheet } from '../MobileSessionSetupSheet';
import { useTimerStore } from '../../store/useTimerStore';

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru' }),
}));
vi.mock('../../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode: 'mobile', setLayoutMode: vi.fn() }),
}));

function renderSheet() {
  return render(
    <MobileSessionSetupSheet
      setupMode="selection" setSetupMode={vi.fn()} startCountdown={vi.fn()} countdown={null}
      sessionRows={{ status: 'writing', hasText: true, onTogglePause: vi.fn(), onNew: vi.fn(), onOpenAI: vi.fn() }}
    />,
  );
}

describe('MQ-9: лист режима письма', () => {
  beforeEach(() => {
    cleanup();
    useTimerStore.setState({ sessionType: 'free' } as Partial<ReturnType<typeof useTimerStore.getState>>);
  });

  it('две группы с подписями: действия сессии и режимы', () => {
    renderSheet();
    const session = screen.getByRole('group', { name: 'writing_group_session' });
    const how = screen.getByRole('group', { name: 'writing_group_how' });
    expect(within(session).getByText('pause')).toBeInTheDocument();
    expect(within(session).getByText('topbar_new')).toBeInTheDocument();
    expect(within(how).getByText('writing_mode_flow')).toBeInTheDocument();
    expect(within(how).getByText('writing_mode_words')).toBeInTheDocument();
    expect(within(session).queryByText('writing_mode_flow')).toBeNull();
  });

  it('у иконок режимов есть статус-цвет десктопа (решение владельца 2026-10-18, U-19)', () => {
    const { container } = renderSheet();
    const how = screen.getByRole('group', { name: 'writing_group_how' });
    // MQ-9 просил приглушённый цвет; владелец отменил это решение в пакете 0.10.2:
    // десктоп — эталон, там каждый режим окрашен своим акцентом (`WritingSetup.tsx:147-150`).
    expect(how.innerHTML).toMatch(/text-accent-warning/);
    expect(how.innerHTML).toMatch(/text-accent-info/);
    expect(how.innerHTML).toMatch(/text-accent-danger/);
    expect(how.innerHTML).toMatch(/text-accent-success/);
    expect(container.innerHTML).not.toMatch(/writing_mode_words[\s\S]*text-accent-/);
  });

  it.each([
    ['free', 'writing_mode_flow'],
    ['stopwatch', 'writing_mode_flow'],
    ['timer', 'writing_mode_timer'],
    ['words', 'writing_mode_words'],
    ['finish-by', 'writing_mode_deadline'],
  ] as const)('sessionType=%s → текущий режим «%s» отмечен aria-current, остальные нет', (type, label) => {
    useTimerStore.setState({ sessionType: type } as Partial<ReturnType<typeof useTimerStore.getState>>);
    renderSheet();
    const current = Array.from(document.querySelectorAll('[aria-current="true"]'));
    expect(current).toHaveLength(1);
    expect(current[0]!.textContent).toContain(label);
    expect(current[0]!.querySelector('svg.lucide-check')).not.toBeNull();
  });
});
