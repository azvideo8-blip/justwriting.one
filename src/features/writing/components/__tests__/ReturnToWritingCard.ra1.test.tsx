// RA1-3: карточка возврата на пустом главном. Текста заметки в ней нет —
// только дата последней записи и «Продолжить» (решение владельца 2026-10-24),
// поэтому заголовок заметки не должен попадать в DOM ни при каких условиях.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReturnToWritingCard } from '../ReturnToWritingCard';
import { useContentStore } from '../../store/useContentStore';
import { useTimerStore } from '../../store/useTimerStore';

const note = {
  localId: 'local_1',
  title: 'Секретный заголовок заметки',
  totalWords: 12,
  totalDuration: 60,
  currentVersion: 1,
  sessionsCount: 1,
  firstSessionAt: new Date(2026, 9, 21).getTime(),
  lastSessionAt: new Date(2026, 9, 21, 12).getTime(),
  tags: [],
  storage: { local: true, cloud: false },
};

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({
    t: (k: string, p?: Record<string, string | number>) => (p?.date !== undefined ? `${k}:${p.date}` : k),
    tp: (k: string) => k,
    language: 'ru',
  }),
}));

describe('RA1-3: карточка «Продолжить» на главном', () => {
  beforeEach(() => {
    useContentStore.setState({ content: '', wordCount: 0, initialWordCount: 0 });
    useTimerStore.setState({ status: 'idle' });
  });

  it('пустой редактор: дата и «Продолжить», текста заметки нет', () => {
    const onContinue = vi.fn();
    render(<ReturnToWritingCard note={note} onContinue={onContinue} />);

    expect(screen.getByTestId('return-to-writing')).toBeInTheDocument();
    expect(screen.getByText(/home_return_last_note:/)).toBeInTheDocument();
    expect(screen.queryByText('Секретный заголовок заметки'), 'текст заметки на главном не показываем').toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'home_return_continue' }));
    expect(onContinue).toHaveBeenCalledWith(note);
  });

  it('есть текст — карточки нет', () => {
    useContentStore.setState({ content: 'Пишу' });
    render(<ReturnToWritingCard note={note} onContinue={vi.fn()} />);
    expect(screen.queryByTestId('return-to-writing')).toBeNull();
  });

  it('идёт запись — карточки нет', () => {
    useTimerStore.setState({ status: 'writing' });
    render(<ReturnToWritingCard note={note} onContinue={vi.fn()} />);
    expect(screen.queryByTestId('return-to-writing')).toBeNull();
  });

  it('hidden (черновик/дзен) — карточки нет', () => {
    render(<ReturnToWritingCard note={note} onContinue={vi.fn()} hidden />);
    expect(screen.queryByTestId('return-to-writing')).toBeNull();
  });
});
