import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LanguageProvider, useLanguage } from '../../../../shared/i18n';
import { ArchiveHeader } from '../ArchiveHeader';

function CountProbe({ n }: { n: number }) {
  const { tp } = useLanguage();
  return <span data-testid="probe">{`${n} ${tp('archive_count', n)}`}</span>;
}

describe('DC-A5 счётчик записей в заголовке', () => {
  it.each([
    [0, '0 записей'],
    [1, '1 запись'],
    [2, '2 записи'],
    [5, '5 записей'],
    [11, '11 записей'],
    [21, '21 запись'],
    [22, '22 записи'],
  ])('%i — «%s»', (n, expected) => {
    render(
      <LanguageProvider>
        <CountProbe n={n} />
      </LanguageProvider>,
    );
    expect(screen.getByTestId('probe').textContent).toBe(expected);
  });

  it('счётчик — обычная Inter без mono и без uppercase', () => {
    render(
      <LanguageProvider>
        <ArchiveHeader
          title="Заметки"
          count={2}
          countLabel="записи"
          subtitle=""
          searchQuery=""
          searchInputRef={{ current: null }}
          onSearchChange={vi.fn()}
          searchPlaceholder=""
          viewMode="list"
          onViewModeChange={vi.fn()}
          listLabel=""
          gridLabel=""
          sortMode="newest"
          onSortModeChange={vi.fn()}
          sortLabels={{ newest: '', oldest: '', longest: '', shortest: '', title_az: '', title_za: '' }}
        />
      </LanguageProvider>,
    );
    const counter = screen.getByText('2 записи');
    expect(counter.className).not.toContain('font-mono');
    expect(counter.className).not.toContain('uppercase');
    expect(counter.className).not.toContain('tracking-widest');
  });
});
