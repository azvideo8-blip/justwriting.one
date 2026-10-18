import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { LanguageProvider } from '../../../../shared/i18n';
import { ArchiveStats } from '../ArchiveStats';
import { ArchiveSession } from '../../types';

const session = (wordCount: number, durationSec: number): ArchiveSession => ({
  id: `doc_${wordCount}_${durationSec}`,
  userId: 'u1',
  content: 'Body',
  duration: durationSec,
  wordCount,
  sessionWordsAdded: wordCount,
  sittings: [],
  charCount: 4,
  wpm: 8,
  title: 'Title',
  tags: [],
  createdAt: new Date(2026, 8, 1, 9, 5),
  sessionStartTime: new Date(2026, 8, 1, 9, 5).getTime(),
  _isLocal: true,
});

function renderStats(sessions: ArchiveSession[], streakDays: number) {
  return render(
    <LanguageProvider>
      <ArchiveStats sessions={sessions} streakDays={streakDays} title="Статистика" />
    </LanguageProvider>,
  );
}

describe('DC-A5 плитки статистики: стрик и множественное число', () => {
  beforeEach(() => cleanup());

  it('нулевой стрик: плитки нет (пустой архив и загрузка не показывают «0 дней»)', () => {
    renderStats([], 0);
    expect(screen.queryByText(/подряд/)).not.toBeInTheDocument();
  });

  it.each([
    [1, 'день подряд'],
    [2, 'дня подряд'],
    [5, 'дней подряд'],
    [11, 'дней подряд'],
    [21, 'день подряд'],
    [22, 'дня подряд'],
  ])('стрик %i читается как «%i %s»', (days, label) => {
    renderStats([session(10, 60)], days);
    expect(screen.getAllByText(label)).toHaveLength(1);
    expect(screen.getAllByText(String(days)).length).toBeGreaterThan(0);
  });

  it.each([
    [1, 'заметка'],
    [2, 'заметки'],
    [5, 'заметок'],
    [21, 'заметка'],
  ])('%i заметок в архиве — подпись «%s»', (n, label) => {
    cleanup();
    renderStats(Array.from({ length: n }, (_, i) => session(10, 60 + i)), 3);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('минуты: 60 секунд — «минута», 120 — «минуты», 300 — «минут»', () => {
    cleanup();
    renderStats([session(10, 60)], 3);
    expect(screen.getByText('минута')).toBeInTheDocument();
    cleanup();
    renderStats([session(10, 120)], 3);
    expect(screen.getByText('минуты')).toBeInTheDocument();
    cleanup();
    renderStats([session(10, 300)], 3);
    expect(screen.getByText('минут')).toBeInTheDocument();
  });

  it('слова: одно — «слово», пять — «слов»', () => {
    cleanup();
    renderStats([session(1, 60)], 3);
    expect(screen.getByText('слово')).toBeInTheDocument();
    cleanup();
    renderStats([session(5, 60)], 3);
    expect(screen.getByText('слов')).toBeInTheDocument();
  });

  it('подписи не раскрывают ключи i18n', () => {
    renderStats([session(3, 60)], 4);
    expect(screen.queryByText(/archive_stat_/)).not.toBeInTheDocument();
    expect(screen.queryByText(/home_streak_days/)).not.toBeInTheDocument();
  });

  it('без стрика три плитки, со стриком — четыре', () => {
    const { container } = renderStats([session(3, 60)], 0);
    expect(container.querySelectorAll('.grid.grid-cols-2 > div')).toHaveLength(3);
    cleanup();
    const withStreak = renderStats([session(3, 60)], 4).container;
    expect(withStreak.querySelectorAll('.grid.grid-cols-2 > div')).toHaveLength(4);
  });

  it('D-9: пустой архив — ни одной нулевой плитки', () => {
    const { container } = renderStats([], 0);
    expect(container.querySelectorAll('.grid.grid-cols-2 > div')).toHaveLength(0);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('D-9: нулевые минуты при заметках — плитки минут нет', () => {
    renderStats([session(120, 0), session(80, 0)], 3);
    expect(screen.getByText('слов')).toBeInTheDocument();
    expect(screen.queryByText('минут')).not.toBeInTheDocument();
  });
});
