// U-10 (хвост, решение владельца 2026-10-18): кнопки панели письма сгруппированы,
// как в нижней панели десктопа: разделитель и общая подложка `bg-text-main/[0.04]
// rounded-xl` (`BottomStats.tsx:276-278`), а не две кнопки, лежащие в панели отдельно.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MobileWriteToolbar } from '../MobileWriteToolbar';
import { useTimerStore } from '../../store/useTimerStore';
import { useContentStore } from '../../store/useContentStore';

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru' }),
}));
vi.mock('../../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    aiPanelOpen: false,
    setAiPanelOpen: vi.fn(),
    effectiveHeaderVisibility: { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
  }),
}));
vi.mock('../../hooks/useDictation', () => ({
  useDictation: () => ({ isListening: false, toggle: vi.fn(), hasSupport: true, isVaultActive: false, aiNoticeRemaining: null }),
}));

function renderIdle() {
  cleanup();
  useContentStore.setState({ content: 'Глина сохнет.', wordCount: 2, wpm: 10, wpmHistory: [] });
  useTimerStore.setState({
    status: 'writing', sessionType: 'free', seconds: 60, wordGoal: 0, timerDuration: 0,
    sessionStartWords: 0, sessionStartSeconds: 0,
  } as Partial<ReturnType<typeof useTimerStore.getState>>);
  return render(<MobileWriteToolbar onStop={vi.fn()} />);
}

describe('U-10: кнопки панели письма собраны в группу, как на десктопе', () => {
  beforeEach(() => { cleanup(); });

  it('микрофон и «Сохранить» лежат в одной подложке, перед ней разделитель', () => {
    renderIdle();
    const save = screen.getByRole('button', { name: 'topbar_save' });
    const plate = save.parentElement as HTMLElement;
    expect(plate.className, 'у группы кнопок нет подложки как на десктопе').toContain('bg-text-main/[0.04]');
    expect(plate.className).toContain('rounded-xl');
    // В группе ровно два значка: микрофон и сохранение.
    expect(plate.querySelectorAll('button')).toHaveLength(2);
    // Токен режима — вне группы: он во всю ширину, как строка статуса.
    const chip = document.querySelector('[data-write-chip]') as HTMLElement;
    expect(plate.contains(chip)).toBe(false);
    // Разделитель перед группой — как в `BottomStats`.
    const divider = plate.previousElementSibling as HTMLElement;
    expect(divider.className).toContain('w-px');
    expect(divider.className).toContain('bg-border-subtle');
  });

  // Регрессия, которую поймал мобильный e2e (`dictation-panel-above-toolbar.mb5`,
  // `write-toolbar-calm.mf3`): вертикальный отступ подложки делал спокойную строку
  // на 4 px выше строки диктовки, а широкий кластер сдвигал числа чипа за край на
  // 320 px. Геометрию в jsdom не измерить, но её причину — классы — закрепить можно.
  it('подложка группы не добавляет вертикального отступа и кластер компактный', () => {
    renderIdle();
    const save = screen.getByRole('button', { name: 'topbar_save' });
    const plate = save.parentElement as HTMLElement;
    const tokens = plate.className.split(/\s+/);
    for (const t of tokens) {
      expect(t, `у подложки появился вертикальный отступ: ${t}`).not.toMatch(/^py-/);
      expect(t).not.toMatch(/^pt-/);
      expect(t).not.toMatch(/^pb-/);
    }
    const outer = plate.parentElement as HTMLElement;
    expect(outer.className).toContain('gap-1');
    expect(outer.className).toContain('ml-1');
    expect(outer.className).not.toMatch(/(^|\s)(gap|ml)-2(\s|$)/);
  });

  it('цели касания в группе остались 44 px, нейтральный микрофон без рамки', () => {
    renderIdle();
    const save = screen.getByRole('button', { name: 'topbar_save' });
    const plate = save.parentElement as HTMLElement;
    const [mic] = [...plate.querySelectorAll('button')].filter(b => b !== save);
    expect(save.className).toContain('w-11');
    expect(mic!.className).toContain('w-11');
    expect(mic!.className).toContain('h-11');
    // В спокойном состоянии значок без рамки: рамка дублировала подложку группы.
    expect(mic!.className, 'у нейтрального микрофона осталась видимая рамка').toContain('border-transparent');
  });
});
