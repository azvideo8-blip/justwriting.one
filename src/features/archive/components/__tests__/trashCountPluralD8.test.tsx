// D-8: счётчик в корзине печатал «1 записей» — число подставлялось рядом с
// одной формой `archive_count`, а `_one`/`_few`/`_many` в словарях лежали
// нетронутыми. То же и на телефоне.
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../../test/utils/render';
import { useLanguage } from '../../../../shared/i18n';
import { ArchiveSession } from '../../types';
import { ArchiveTrashView } from '../ArchiveTrashView';

function session(i: number): ArchiveSession {
  return {
    id: `s${i}`,
    title: `Заметка ${i}`,
    content: 'текст',
    wordCount: 3,
    createdAt: new Date(),
    tags: [],
  } as unknown as ArchiveSession;
}

function Harness({ count, isMobile = false }: { count: number; isMobile?: boolean }) {
  const { t, tp } = useLanguage();
  return (
    <ArchiveTrashView
      trashedSessions={Array.from({ length: count }, (_, i) => session(i))}
      onRestore={async () => {}}
      onDeletePermanently={() => {}}
      onEmptyTrash={() => {}}
      t={t}
      tp={tp}
      isMobile={isMobile}
    />
  );
}

describe('D-8', () => {
  it('десктоп: один — «1 запись»', () => {
    renderWithProviders(<Harness count={1} />);
    expect(screen.getByText('1 запись')).toBeInTheDocument();
  });

  it('десктоп: два — «2 записи», пять — «5 записей»', () => {
    const { unmount } = renderWithProviders(<Harness count={2} />);
    expect(screen.getByText('2 записи')).toBeInTheDocument();
    unmount();
    renderWithProviders(<Harness count={5} />);
    expect(screen.getByText('5 записей')).toBeInTheDocument();
  });

  it('телефон: та же склоняемая форма', () => {
    renderWithProviders(<Harness count={1} isMobile />);
    expect(screen.getByText('1 запись')).toBeInTheDocument();
  });
});
