// B-5: строка в корзине печатала «3 всего слов» — после числа стояла одна
// форма `archive_stat_words`, а `archive_stat_words_one/_few/_many` лежали в
// словарях нетронутыми. Тот же класс дефекта, что D-8 закрыл для количества
// записей: счётчик слов тоже обязан идти через `tp`.
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../../test/utils/render';
import { useLanguage } from '../../../../shared/i18n';
import { ArchiveSession } from '../../types';
import { ArchiveTrashView } from '../ArchiveTrashView';

// Текст фиксируется константами вне JSX: ESLint стережёт кириллицу в разметке.
const TWO_WORDS = '2 слова';
const FIVE_WORDS = '5 слов';
const UNINFLECTED = 'всего слов';

function session(wordCount: number): ArchiveSession {
  return {
    id: `s-${wordCount}`,
    title: 'Удалённый черновик',
    content: 'текст',
    wordCount,
    createdAt: new Date(),
    trashedAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
    tags: [],
    _isLocal: true,
  } as unknown as ArchiveSession;
}

function Harness({ wordCount, isMobile = false }: { wordCount: number; isMobile?: boolean }) {
  const { t, tp } = useLanguage();
  return (
    <ArchiveTrashView
      trashedSessions={[session(wordCount)]}
      onRestore={async () => {}}
      onDeletePermanently={() => {}}
      onEmptyTrash={() => {}}
      t={t}
      tp={tp}
      isMobile={isMobile}
    />
  );
}

describe('B-5: счётчик слов в корзине склоняется', () => {
  it('телефон: два слова — «2 слова», без несклоняемой формы', () => {
    const { container } = renderWithProviders(<Harness wordCount={2} isMobile />);
    const line = screen.getByText(new RegExp(TWO_WORDS));
    expect(line.textContent).toContain(TWO_WORDS);
    expect(container.textContent).not.toContain(UNINFLECTED);
  });

  it('телефон: пять слов — другая форма, «5 слов»', () => {
    const { container } = renderWithProviders(<Harness wordCount={5} isMobile />);
    const line = screen.getByText(new RegExp(FIVE_WORDS));
    expect(line.textContent).toContain(FIVE_WORDS);
    expect(line.textContent).not.toContain(TWO_WORDS);
    expect(container.textContent).not.toContain(UNINFLECTED);
  });

  it('десктоп: те же две формы', () => {
    const { container, unmount } = renderWithProviders(<Harness wordCount={2} />);
    expect(screen.getByText(TWO_WORDS).textContent).toContain(TWO_WORDS);
    expect(container.textContent).not.toContain(UNINFLECTED);
    unmount();
    renderWithProviders(<Harness wordCount={5} />);
    expect(screen.getByText(FIVE_WORDS).textContent).toContain(FIVE_WORDS);
  });
});
