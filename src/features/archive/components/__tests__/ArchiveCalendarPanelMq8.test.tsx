// MQ-8: панель «Календарь и статистика» на телефоне — одна плоская поверхность: подписи
// строчные Inter, нулевые показатели скрыты, у панели нет внутренней прокрутки и мёртвой
// колонки справа от содержимого. Десктопная боковая панель не меняется.
import type { ReactElement } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { LanguageProvider } from '../../../../shared/i18n';
import { ArchiveStats } from '../ArchiveStats';
import { Calendar } from '../Calendar';
import { ArchiveSidebarContent } from '../MobileArchiveSidebarSheet';
import { MobileInlinePanel } from '../MobileInlinePanel';
import type { ArchiveSession } from '../../types';

const session = (wordCount: number, durationSec: number): ArchiveSession => ({
  id: `d_${wordCount}`, userId: 'u1', content: 'Body', duration: durationSec, wordCount, sessionWordsAdded: wordCount,
  sittings: [], charCount: 4, wpm: 8, title: 'T', tags: [], createdAt: new Date(2026, 8, 1, 9, 5),
  sessionStartTime: new Date(2026, 8, 1, 9, 5).getTime(), _isLocal: true,
});
const wrap = (ui: ReactElement) => render(<LanguageProvider>{ui}</LanguageProvider>);

describe('MQ-8: плоская статистика', () => {
  beforeEach(() => cleanup());

  it('0 минут — плитки минут нет, остальные показатели на месте', () => {
    wrap(<ArchiveStats flat sessions={[session(40, 20)]} streakDays={0} title="Вся статистика" />);
    expect(screen.queryByText(/^мин/)).toBeNull();
    expect(screen.getByText('заметка')).toBeInTheDocument();
    expect(screen.getByText('слов')).toBeInTheDocument();
  });

  it('без карточек и моно-капса', () => {
    const { container } = wrap(<ArchiveStats flat sessions={[session(400, 600)]} streakDays={3} title="Вся статистика" />);
    expect(container.innerHTML).not.toContain('uppercase');
    expect(container.innerHTML).not.toContain('font-mono');
    expect(container.innerHTML).not.toContain('border');
    expect(screen.getByText('минут')).toBeInTheDocument();
  });

  it('десктоп (без flat) — прежние плитки с рамкой и капсом', () => {
    const { container } = wrap(<ArchiveStats sessions={[session(40, 20)]} streakDays={0} title="Вся статистика" />);
    expect(container.innerHTML).toContain('uppercase');
    expect(screen.getByText('минут')).toBeInTheDocument();
  });
});

describe('MQ-8: плоский календарь', () => {
  beforeEach(() => cleanup());

  it('дни недели строчными, кнопки месяца 44 px; десктоп прежний', () => {
    const { container } = wrap(<Calendar flat sessions={[]} selectedDate={null} onSelectDate={vi.fn()} />);
    expect(container.innerHTML).not.toContain('uppercase');
    expect(screen.getByRole('button', { name: 'Предыдущий месяц' }).className).toContain('h-11');
    cleanup();
    const desktop = wrap(<Calendar sessions={[]} selectedDate={null} onSelectDate={vi.fn()} />);
    expect(desktop.container.innerHTML).toContain('uppercase');
  });
});

describe('MQ-8: содержимое панели и каркас', () => {
  beforeEach(() => cleanup());

  const content = (flat: boolean) => wrap(
    <ArchiveSidebarContent
      filteredByFilters={[session(40, 20)]} streakDays={0} statsTitle="Вся статистика" sessions={[session(40, 20)]}
      sessionsByDate={{ '2026-09-01': 1 }} wordsByDate={{ '2026-09-01': 40 }} selectedDate={null}
      onSelectDate={vi.fn()} onSelectMonth={vi.fn()} wordCloud={[{ word: 'глина', count: 3 }]} maxCount={3}
      onWordClick={vi.fn()} collapseCloud flat={flat}
    />,
  );

  it('flat: ни одной карточки с рамкой и ни одного разделителя', () => {
    const { container } = content(true);
    expect(container.querySelectorAll('.rounded-2xl').length).toBe(0);
    expect(container.querySelectorAll('.h-px').length).toBe(0);
    expect(container.innerHTML).not.toContain('uppercase');
  });

  it('не flat: карточки остались (лист на десктопе в узком окне)', () => {
    const { container } = content(false);
    expect(container.querySelectorAll('.rounded-2xl').length).toBeGreaterThan(1);
  });

  it('панель: «×» делит строку с названием, колонки pr-12 и прокрутки нет', () => {
    const { container } = wrap(<MobileInlinePanel testId="p" title="Календарь и статистика" onClose={vi.fn()}><span>x</span></MobileInlinePanel>);
    expect(screen.getByText('Календарь и статистика')).toBeInTheDocument();
    expect(container.innerHTML).not.toContain('pr-12');
    expect(container.innerHTML).not.toContain('overflow-y');
    expect(container.innerHTML).not.toContain('max-h-');
  });
});
