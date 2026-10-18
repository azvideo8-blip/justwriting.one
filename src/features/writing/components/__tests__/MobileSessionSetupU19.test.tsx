// U-19 (решение владельца 2026-10-18, пакет 0.10.2): лист настройки сессии на телефоне
// приводится к десктопному `WritingSetup` — цветные значки режимов, «Начать» общим
// `Button primary lg`, пресеты цели не меньше 44 px.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MobileSessionSetupSheet } from '../MobileSessionSetupSheet';
import { useTimerStore } from '../../store/useTimerStore';

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru' }),
}));
vi.mock('../../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode: 'mobile', setLayoutMode: vi.fn() }),
}));

function renderSelection() {
  return render(
    <MobileSessionSetupSheet
      setupMode="selection"
      setSetupMode={vi.fn()}
      startCountdown={vi.fn()}
      countdown={null}
    />,
  );
}

function renderConfig(mode: 'timer-config' | 'words-config') {
  return render(
    <MobileSessionSetupSheet
      setupMode={mode}
      setSetupMode={vi.fn()}
      startCountdown={vi.fn()}
      countdown={null}
    />,
  );
}

describe('U-19: лист режима письма как на десктопе', () => {
  beforeEach(() => {
    cleanup();
    useTimerStore.setState({ sessionType: 'free' } as Partial<ReturnType<typeof useTimerStore.getState>>);
  });

  it('каждый режим окрашен тем же статус-цветом, что на десктопе, значок без серой плитки', () => {
    renderSelection();
    // ModalShell рендерится в портал, поэтому смотрим на весь документ.
    const html = document.body.innerHTML;
    for (const color of ['text-accent-warning', 'text-accent-info', 'text-accent-danger', 'text-accent-success']) {
      expect(html).toContain(color);
    }
    // Плитка вокруг значка снята — на десктопе значок лежит прямо в строке.
    expect(html).not.toContain('bg-text-main/[0.06]');
  });

  it('«Начать» — общий Button primary lg, а не ручные классы', () => {
    renderConfig('timer-config');
    const cls = screen.getByRole('button', { name: 'writing_start' }).className;
    expect(cls).toContain('bg-text-main');
    expect(cls).toContain('text-surface-base');
    expect(cls).toContain('px-6');
    expect(cls).toContain('text-base');
    expect(cls).not.toContain('py-4');
    expect(cls).not.toContain('text-sm');
  });

  it('пресеты времени и слов — цели касания минимум 44 px', () => {
    renderConfig('timer-config');
    for (const preset of screen.getAllByRole('button', { name: /goal_time_min/ })) {
      expect(preset.className).toContain('min-h-11');
    }
    cleanup();
    renderConfig('words-config');
    for (const preset of screen.getAllByRole('button', { name: 'archive_word_count' })) {
      expect(preset.className).toContain('min-h-11');
    }
  });
});
