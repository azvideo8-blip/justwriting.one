// MR-8: мобильная шапка архива и десктопная шапка.
// Десктоп проверяется на то, что мобильная ветка в него не проникла: «⌘K»,
// Список/Сетка и сортировка остаются на месте.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LanguageProvider } from '../../../../shared/i18n';
import { MobileArchiveHeader } from '../MobileArchiveHeader';
import { ArchiveHeader } from '../ArchiveHeader';

const mobileProps = {
  title: 'Заметки',
  count: 2,
  countLabel: 'записи',
  searchQuery: '',
  searchVisible: true,
  searchInputRef: { current: null },
  onSearchChange: vi.fn(),
  onOpenMenu: vi.fn(),
  allTags: ['глина', 'семья'],
  selectedTags: [] as string[],
  onToggleTag: vi.fn(),
};

const renderMobile = (over: Partial<typeof mobileProps> = {}) => render(
  <LanguageProvider>
    <MobileArchiveHeader {...mobileProps} {...over} />
  </LanguageProvider>,
);

describe('MR-8: мобильная шапка архива', () => {
  it('заголовок, поле поиска и «⋯» — без бейджа ⌘K', () => {
    renderMobile();
    expect(screen.getByRole('heading', { name: 'Заметки' })).toBeTruthy();
    expect(screen.getByRole('searchbox', { name: 'Поиск по заметкам...' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ещё' })).toBeTruthy();
    expect(screen.queryByText('⌘K')).toBeNull();
  });

  // Владелец 27.10: поиск скрыт по умолчанию, включается в листе «⋯».
  // Мутация: рисовать поле без searchVisible → красный.
  it('поиск выключен — поля нет, заголовок и «⋯» на месте', () => {
    renderMobile({ searchVisible: false });
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Ещё' })).toBeTruthy();
  });

  it('при вводе поиска подходящие теги становятся чипсами, а без ввода их нет', () => {
    const { rerender } = renderMobile();
    expect(screen.queryByRole('button', { name: '#глина' })).toBeNull();

    rerender(
      <LanguageProvider>
        <MobileArchiveHeader {...mobileProps} searchQuery="гл" />
      </LanguageProvider>,
    );
    expect(screen.getByRole('button', { name: '#глина' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '#семья' })).toBeNull();
  });

  it('тап по чипсу отдаёт тег в фильтр', () => {
    const onToggleTag = vi.fn();
    renderMobile({ searchQuery: 'семь', onToggleTag });
    fireEvent.click(screen.getByRole('button', { name: '#семья' }));
    expect(onToggleTag).toHaveBeenCalledWith('семья');
  });

  it('выбранный тег виден чипсом даже когда не подходит под ввод', () => {
    renderMobile({ searchQuery: 'ничего', selectedTags: ['глина'] });
    expect(screen.getByRole('button', { name: '#глина' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('MR-8: десктопная шапка не изменилась', () => {
  it('сохраняет ⌘K, переключатель вида и сортировку', () => {
    render(
      <LanguageProvider>
        <ArchiveHeader
          title="Заметки"
          count={2}
          countLabel="записи"
          subtitle="Подзаголовок"
          searchQuery=""
          searchInputRef={{ current: null }}
          onSearchChange={vi.fn()}
          searchPlaceholder="Поиск по заметкам..."
          viewMode="list"
          onViewModeChange={vi.fn()}
          listLabel="Список"
          gridLabel="Сетка"
          sortMode="newest"
          onSortModeChange={vi.fn()}
          sortLabels={{ newest: 'Сначала новые', oldest: '', longest: '', shortest: '', title_az: '', title_za: '' }}
        />
      </LanguageProvider>,
    );
    expect(screen.getByText('⌘K')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Список' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Сетка' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Сначала новые' })).toBeTruthy();
    expect(screen.getByText('Подзаголовок')).toBeTruthy();
  });
});
