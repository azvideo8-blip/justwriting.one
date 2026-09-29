import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../../../shared/i18n';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { NotFoundPage } from '../pages/NotFoundPage';
import { AboutPage } from '../pages/AboutPage';
import { LandingPage } from '../pages/LandingPage';
import { LegalPage } from '../pages/LegalPage';
import { MobileGoalSheet } from '../../writing/components/MobileGoalSheet';
import { ArchiveHeader } from '../../archive/components/ArchiveHeader';

vi.mock('../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const CYRILLIC = /[Ѐ-ӿ]/;

function renderEn(ui: React.ReactElement) {
  localStorage.setItem(STORAGE_KEYS.APP_LANGUAGE, 'en');
  return render(
    <MemoryRouter>
      <LanguageProvider>
        {ui}
      </LanguageProvider>
    </MemoryRouter>
  );
}

function renderRu(ui: React.ReactElement) {
  localStorage.setItem(STORAGE_KEYS.APP_LANGUAGE, 'ru');
  return render(
    <MemoryRouter>
      <LanguageProvider>
        {ui}
      </LanguageProvider>
    </MemoryRouter>
  );
}

describe('T-1 (e) Screens and components English localization (no Cyrillic characters)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('NotFoundPage has no Cyrillic in English', () => {
    const { container } = renderEn(<NotFoundPage />);
    const text = container.textContent || '';
    expect(text).not.toMatch(CYRILLIC);
    expect(screen.getByText('The requested page does not exist.')).toBeInTheDocument();
    expect(screen.getByText('Back to home')).toBeInTheDocument();
  });

  it('AboutPage has no Cyrillic in English', () => {
    const { container } = renderEn(<AboutPage />);
    const text = container.textContent || '';
    expect(text).not.toMatch(CYRILLIC);
    expect(screen.getByText('Privacy Policy')).toBeInTheDocument();
    expect(screen.getByText('Terms of Service')).toBeInTheDocument();
  });

  it('LandingPage has no Cyrillic in English', () => {
    const { container } = renderEn(<LandingPage />);
    const text = container.textContent || '';
    expect(text).not.toMatch(CYRILLIC);
    expect(screen.getAllByText('Start writing').length).toBeGreaterThan(0);
    expect(screen.getByText('A quiet editor for free writing. One sign, one letter, one minute.')).toBeInTheDocument();
    expect(screen.getByText('Just start writing.')).toBeInTheDocument();
  });

  it('LegalPage has no Cyrillic in English', () => {
    const mockDoc = {
      ru: { updated: '01.01.2026', sections: [{ title: 'Раздел 1', paragraphs: ['Текст 1'] }] },
      en: { updated: 'Jan 1, 2026', sections: [{ title: 'Section 1', paragraphs: ['Paragraph 1'] }] },
    };
    const { container } = renderEn(
      <LegalPage
        doc={mockDoc}
        path="/test"
        titleRu="Заголовок"
        titleEn="Title"
        descriptionRu="Описание"
        descriptionEn="Description"
        draft={true}
      />
    );
    const text = container.textContent || '';
    expect(text).not.toMatch(CYRILLIC);
    expect(screen.getByText('Back')).toBeInTheDocument();
    expect(screen.getByText(/Last updated: Jan 1, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Draft revision/)).toBeInTheDocument();
  });

  it('MobileGoalSheet has no Cyrillic in English presets', () => {
    const { container } = renderEn(
      <MobileGoalSheet
        isOpen={true}
        onClose={vi.fn()}
      />
    );
    const text = container.textContent || '';
    expect(text).not.toMatch(CYRILLIC);
    expect(screen.getByText('100 words')).toBeInTheDocument();
    expect(screen.getByText('5 min.')).toBeInTheDocument();
  });

  it('ArchiveHeader has no Cyrillic in English tab labels', () => {
    const inputRef = { current: null };
    const { container } = renderEn(
      <ArchiveHeader
        title="Notes"
        count={5}
        countLabel="5 notes"
        subtitle="Subtitle"
        searchQuery=""
        searchInputRef={inputRef}
        onSearchChange={vi.fn()}
        searchPlaceholder="Search"
        viewMode="list"
        onViewModeChange={vi.fn()}
        listLabel="List"
        gridLabel="Grid"
        sortMode="newest"
        onSortModeChange={vi.fn()}
        sortLabels={{
          newest: 'Newest',
          oldest: 'Oldest',
          longest: 'Longest',
          shortest: 'Shortest',
          title_az: 'A-Z',
          title_za: 'Z-A',
        }}
        activeTab="notes"
        onTabChange={vi.fn()}
        trashCount={0}
      />
    );
    const text = container.textContent || '';
    expect(text).not.toMatch(CYRILLIC);
    expect(screen.getAllByText('Notes').length).toBeGreaterThan(0);
    expect(screen.getByText('Trash')).toBeInTheDocument();
  });

  it('renders expected Russian Cyrillic strings when in Russian locale', () => {
    const { container } = renderRu(<NotFoundPage />);
    const text = container.textContent || '';
    expect(text).toMatch(CYRILLIC);
    expect(screen.getByText('Запрашиваемая страница не существует.')).toBeInTheDocument();
    expect(screen.getByText('На главную')).toBeInTheDocument();
  });
});
