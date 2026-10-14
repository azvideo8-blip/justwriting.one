import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../../../shared/i18n';
import { AccountAISection } from '../components/AccountAISection';
import { SyncSettingsSection } from '../components/SyncSettingsSection';
import { EditorTab } from '../components/EditorTab';
import { WritingFinishModal } from '../../writing/components/WritingFinishModal';
import { DocumentPreview } from '../../archive/components/DocumentPreview';
import { GuidePage } from '../../navigation/pages/GuidePage';

import { AboutSettingsSection } from '../components/AboutSettingsSection';
import { ProfileHero } from '../../profile/components/ProfileHero';
import { Sidebar } from '../../navigation/components/Sidebar';
import { BottomNav } from '../../navigation/components/BottomNav';
import { InlineTags } from '../../archive/components/InlineTags';
import { ArchiveTagBar } from '../../archive/components/ArchiveTagBar';
import { ArchiveLabelBar } from '../../archive/components/ArchiveLabelBar';

vi.mock('../../../core/auth', () => ({
  getCurrentUser: () => ({ uid: 'u123', email: 'test@example.com' }),
}));

vi.mock('../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({ isAuthenticated: true, isGuest: false, user: { uid: 'u123' }, loading: false }),
}));

vi.mock('../../../core/theme/ThemeProvider', () => ({
  useTheme: () => ({
    themeId: 'modern',
    setThemeId: vi.fn(),
    themes: {
      modern: { id: 'modern', nameRu: 'Современный', nameEn: 'Modern', cssClass: 'theme-modern' },
      notion: { id: 'notion', nameRu: 'Тёплый', nameEn: 'Warm', cssClass: 'theme-notion' },
    },
  }),
}));

vi.mock('../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    fontFamily: 'Inter',
    setFontFamily: vi.fn(),
    fontSize: 16,
    setFontSize: vi.fn(),
    lineHeight: 1.6,
    setLineHeight: vi.fn(),
    editorWidth: 60,
    setEditorWidth: vi.fn(),
    silenceMode: false,
    setSilenceMode: vi.fn(),
    typographyEnabled: true,
    setTypographyEnabled: vi.fn(),
    zenModeEnabled: false,
    setZenModeEnabled: vi.fn(),
    streamMode: false,
    toggleStreamMode: vi.fn(),
    headerVisibility: { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
    toggleVisibility: vi.fn(),
    typewriterScrolling: false,
    setTypewriterScrolling: vi.fn(),
    focusModeEnabled: false,
    setFocusModeEnabled: vi.fn(),
    autoHideCursor: false,
    setAutoHideCursor: vi.fn(),
  }),
}));

vi.mock('../../auth/hooks/useAuthStatus', () => ({
  useAuthStatus: () => ({ user: { uid: 'u123' }, loading: false }),
}));

vi.mock('../../../core/sync/useSyncStatus', () => ({
  useSyncStatus: () => ({
    status: 'synced',
    hasPending: false,
    lastSyncTime: Date.now(),
    isVaultLocked: false,
    isManualUploadTriggered: false,
    retryFailedTasks: vi.fn(),
  }),
}));

vi.mock('../../writing/contexts/WritingSessionContext', () => ({
  useWritingSession: () => ({
    text: 'Some test text',
    seconds: 120,
    accumulatedDuration: 120,
    sessionStartSeconds: 0,
    initialDuration: 0,
    initialWordCount: 0,
    totalPauseSeconds: 0,
    wordCount: 15,
    isSessionActive: false,
    entryMood: 3,
    setEntryMood: vi.fn(),
    notesCount: 5,
    streakDays: 2,
    todayWordCount: 15,
  }),
}));

import { ToastProvider } from '../../../shared/components/Toast';

/** Портал (MB-4) выносит окно в document.body. Смотреть надо на отрендеренное
 *  целиком: container после портала пуст, и проверка «нет кириллицы» прошла бы
 *  на пустоте, а снимок усох бы до нуля. */
function renderedHtml(): string {
  return document.body.innerHTML;
}

function renderedText(): string {
  return document.body.textContent ?? '';
}


function renderInEnglish(ui: React.ReactElement) {
  localStorage.setItem('app_language', 'en');
  return render(
    <LanguageProvider>
      <ToastProvider>
        <MemoryRouter>
          {ui}
        </MemoryRouter>
      </ToastProvider>
    </LanguageProvider>
  );
}

function renderInRussian(ui: React.ReactElement) {
  localStorage.setItem('app_language', 'ru');
  return render(
    <LanguageProvider>
      <ToastProvider>
        <MemoryRouter>
          {ui}
        </MemoryRouter>
      </ToastProvider>
    </LanguageProvider>
  );
}

const mockSession = {
  id: 'session-123',
  title: 'Test Note',
  content: 'Hello world content',
  date: '2026-09-28',
  words: 3,
  durationSeconds: 10,
  tags: [],
  createdAt: '2026-09-28T12:00:00Z',
  updatedAt: '2026-09-28T12:00:00Z',
} as any;

describe('T-1 (b) Settings, Editor, Guide and Archive screens English localization (no Cyrillic characters)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('AccountAISection has no Cyrillic text when rendered in English', () => {
    renderInEnglish(
      <AccountAISection userId="u123" />
    );
    expect(renderedHtml(), 'проверка стала бы вакуумной').not.toMatch(/[а-яёА-ЯЁ]/);
  });

  it('SyncSettingsSection has no Cyrillic text when rendered in English', () => {
    renderInEnglish(
      <SyncSettingsSection userId="u123" />
    );
    expect(renderedHtml(), 'проверка стала бы вакуумной').not.toMatch(/[а-яёА-ЯЁ]/);
  });

  it('EditorTab has no Cyrillic text when rendered in English', () => {
    renderInEnglish(
      <EditorTab />
    );
    expect(renderedHtml(), 'проверка стала бы вакуумной').not.toMatch(/[а-яёА-ЯЁ]/);
  });

  it('WritingFinishModal has no Cyrillic text when rendered in English', () => {
    renderInEnglish(
      <WritingFinishModal
        isOpen={true}
        onSave={async () => null}
        onCancel={() => {}}
      />
    );
    expect(renderedHtml(), 'проверка стала бы вакуумной').not.toMatch(/[а-яёА-ЯЁ]/);
  });

  it('DocumentPreview has no Cyrillic text when rendered in English', () => {
    renderInEnglish(
      <DocumentPreview
        session={mockSession}
        onClose={() => {}}
        onContinue={() => {}}
        onAttach={() => {}}
      />
    );
    expect(renderedHtml(), 'проверка стала бы вакуумной').not.toMatch(/[а-яёА-ЯЁ]/);
  });

  it('GuidePage has no Cyrillic text when rendered in English', () => {
    renderInEnglish(
      <GuidePage />
    );
    expect(renderedHtml(), 'проверка стала бы вакуумной').not.toMatch(/[а-яёА-ЯЁ]/);
  });

  it('AboutSettingsSection has no Cyrillic text or attrs when rendered in English', () => {
    renderInEnglish(
      <AboutSettingsSection />
    );
    expect(renderedHtml(), 'проверка стала бы вакуумной').not.toMatch(/[а-яёА-ЯЁ]/);
  });

  it('ProfileHero has no Cyrillic text or attrs when rendered in English', () => {
    renderInEnglish(
      <ProfileHero user={{ uid: 'u123', email: 'test@example.com' } as any} profile={{ streakDays: 3 } as any} isGuest={false} onStartSession={() => {}} />
    );
    expect(renderedHtml(), 'проверка стала бы вакуумной').not.toMatch(/[а-яёА-ЯЁ]/);
  });

  it('Sidebar has no Cyrillic text or attrs when rendered in English', () => {
    renderInEnglish(
      <Sidebar isAdmin={true} />
    );
    expect(renderedHtml(), 'проверка стала бы вакуумной').not.toMatch(/[а-яёА-ЯЁ]/);
  });

  it('BottomNav has no Cyrillic text or attrs when rendered in English', () => {
    renderInEnglish(
      <BottomNav />
    );
    expect(renderedHtml(), 'проверка стала бы вакуумной').not.toMatch(/[а-яёА-ЯЁ]/);
  });

  it('InlineTags has no Cyrillic text or attrs when rendered in English', () => {
    renderInEnglish(
      <InlineTags tags={['tag1']} onChange={() => {}} />
    );
    expect(renderedHtml(), 'проверка стала бы вакуумной').not.toMatch(/[а-яёА-ЯЁ]/);
  });

  it('ArchiveTagBar has no Cyrillic text or attrs when rendered in English', () => {
    renderInEnglish(
      <ArchiveTagBar
        allTags={['tag1']}
        selectedTags={[]}
        onToggleTag={() => {}}
        renamingTag={null}
        renameTagValue=""
        setRenameTagValue={() => {}}
        onStartRename={() => {}}
        onRenameSubmit={() => {}}
        onRenameCancel={() => {}}
        onDeleteTag={() => {}}
        onResetTags={() => {}}
        showControls={true}
      />
    );
    expect(renderedHtml(), 'проверка стала бы вакуумной').not.toMatch(/[а-яёА-ЯЁ]/);
  });

  it('ArchiveLabelBar has no Cyrillic text or attrs when rendered in English', () => {
    renderInEnglish(
      <ArchiveLabelBar
        labels={[{ id: 'l1', name: 'Label 1', color: '#ff0000' }]}
        selectedLabels={[]}
        onToggleLabel={() => {}}
        addingLabel={false}
        setAddingLabel={() => {}}
        newLabelName=""
        setNewLabelName={() => {}}
        newLabelColor="#ff0000"
        setNewLabelColor={() => {}}
        onAddLabel={() => {}}
        editingLabelId={null}
        setEditingLabelId={() => {}}
        editLabelName=""
        setEditLabelName={() => {}}
        editLabelColor="#ff0000"
        setEditLabelColor={() => {}}
        onUpdateLabel={() => {}}
        onDeleteLabel={() => {}}
        showControls={true}
      />
    );
    expect(renderedHtml(), 'проверка стала бы вакуумной').not.toMatch(/[а-яёА-ЯЁ]/);
  });
});

describe('T-1 (b) Russian rendering unchanged', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('AccountAISection matches Russian snapshot', () => {
    renderInRussian(
      <AccountAISection userId="u123" />
    );
    expect(renderedText().length, 'портал уехал из снимка').toBeGreaterThan(30);
    expect(renderedText()).toMatchSnapshot();
  });

  it('SyncSettingsSection matches Russian snapshot', () => {
    renderInRussian(
      <SyncSettingsSection userId="u123" />
    );
    expect(renderedText().length, 'портал уехал из снимка').toBeGreaterThan(30);
    expect(renderedText()).toMatchSnapshot();
  });

  it('EditorTab matches Russian snapshot', () => {
    renderInRussian(
      <EditorTab />
    );
    expect(renderedText().length, 'портал уехал из снимка').toBeGreaterThan(30);
    expect(renderedText()).toMatchSnapshot();
  });

  it('WritingFinishModal matches Russian snapshot', () => {
    renderInRussian(
      <WritingFinishModal
        isOpen={true}
        onSave={async () => null}
        onCancel={() => {}}
      />
    );
    expect(renderedText().length, 'портал уехал из снимка').toBeGreaterThan(30);
    expect(renderedText()).toMatchSnapshot();
  });

  it('DocumentPreview matches Russian snapshot', () => {
    renderInRussian(
      <DocumentPreview
        session={mockSession}
        onClose={() => {}}
        onContinue={() => {}}
        onAttach={() => {}}
      />
    );
    expect(renderedText().length, 'портал уехал из снимка').toBeGreaterThan(30);
    expect(renderedText()).toMatchSnapshot();
  });

  it('GuidePage matches Russian snapshot', () => {
    renderInRussian(
      <GuidePage />
    );
    expect(renderedText().length, 'портал уехал из снимка').toBeGreaterThan(30);
    expect(renderedText()).toMatchSnapshot();
  });
});
