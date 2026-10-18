// D-12: на окне высотой меньше контента прокручивалась вся карточка, поэтому
// «Сохранить» уезжал за нижний край. Прокручиваться должно тело, а строка
// действий — оставаться на месте.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { WritingFinishModal } from '../WritingFinishModal';
import { useContentStore } from '../../store/useContentStore';
import { useTimerStore } from '../../store/useTimerStore';
import { useSessionMetaStore } from '../../store/useSessionMetaStore';

vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru' }),
}));

vi.mock('../../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    quietStats: false,
    setQuietStats: vi.fn(),
    effectiveHeaderVisibility: { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
  }),
}));

vi.mock('motion/react', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    AnimatePresence: ({ children }: any) => <>{children}</>,
    motion: {
      div: ({ children, className, onClick, ...props }: any) => <div className={className} onClick={onClick} {...props}>{children}</div>,
      button: ({ children, className, onClick, ...props }: any) => <button className={className} onClick={onClick} {...props}>{children}</button>,
    },
    useReducedMotion: () => true,
  };
});

vi.mock('../WpmChart', () => ({ WpmChart: () => <div data-testid="wpm-chart" /> }));
vi.mock('../../../lifeLog/hooks/useCorpusDf', () => ({ buildCorpusDf: vi.fn().mockResolvedValue({ df: new Map(), N: 0 }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

const scrollers = () => Array.from(document.querySelectorAll('div'))
  .filter(node => /overflow-y-auto/.test(node.className) && /flex-1/.test(node.className));

describe('D-12: «Записано.» на низком окне', () => {
  beforeEach(() => {
    useContentStore.setState({ content: 'Test content', wordCount: 10, initialWordCount: 0, wpm: 20 });
    useTimerStore.setState({
      seconds: 60, sessionStartSeconds: 0, accumulatedDuration: 60, totalPauseSeconds: 0,
      wordGoalReached: false, timeGoalReached: false, status: 'idle',
    });
    useSessionMetaStore.setState({ savedDocumentId: 'doc_1', sessionStartTime: Date.now() });
    document.body.innerHTML = '';
  });

  it('прокручивается тело, а не карточка целиком', () => {
    render(<WritingFinishModal isOpen onCancel={vi.fn()} onSave={vi.fn()} />);

    const list = scrollers();
    expect(list.length, 'области прокрутки тела нет').toBeGreaterThan(0);

    const title = document.getElementById('finish-modal-title');
    // Ревью D-12: заголовок со значком — вне прокрутки, иначе край области
    // прокрутки обрезает вспышку значка.
    expect(title).not.toBeNull();
    expect(list.some(node => node.contains(title)), 'заголовок внутри прокрутки').toBe(false);

    const save = screen.getByText('common_save');
    expect(list.some(node => node.contains(save)), 'кнопка «Сохранить» внутри прокрутки').toBe(false);
  });

  it('карточка не прокручивает себя', () => {
    render(<WritingFinishModal isOpen onCancel={vi.fn()} onSave={vi.fn()} />);
    const card = screen.getByText('common_save').closest('.rounded-3xl');
    expect(card, 'карточка окна не найдена').not.toBeNull();
    expect(card?.className).not.toContain('overflow-y-auto');
    expect(card?.className).toContain('overflow-hidden');
  });
});
