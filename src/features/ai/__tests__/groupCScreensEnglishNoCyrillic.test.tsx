import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { LanguageProvider } from '../../../shared/i18n';
import { ToastProvider } from '../../../shared/components/Toast';
import { ThinkingIndicator } from '../components/chat/ThinkingIndicator';
import { AIChatComposer } from '../components/chat/AIChatComposer';
import { AIChatHeader } from '../components/chat/AIChatHeader';
import { AIChatMessages } from '../components/chat/AIChatMessages';
import { AIChatSidebar } from '../components/chat/AIChatSidebar';
import {
  AttachedNoteCard,
  AttachedFileCard,
  AttachedSummaryCard,
  AssistantTurn,
} from '../components/AIChatPresentational';
import { SummaryModal } from '../components/SummaryModal';
import { DocumentPickerModal } from '../components/DocumentPickerModal';
import { PersonaDetailModal } from '../components/PersonaDetailModal';
import { CreatePersonaModal } from '../components/CreatePersonaModal';
import { ContactDoors } from '../components/ContactDoors';
import { AuthorPortrait } from '../components/AuthorPortrait';
import { LifeStoryTimeline } from '../components/LifeStoryTimeline';
import { ArchiveAnalysisButton } from '../components/ArchiveAnalysisButton';
import { ProfileRefreshButton } from '../components/ProfileRefreshButton';

vi.mock('../../../core/auth', () => ({
  getCurrentUser: () => ({ uid: 'u123', email: 'test@example.com' }),
}));

vi.mock('../services/AIProfileService', () => ({
  AIProfileService: {
    getPortrait: vi.fn().mockResolvedValue('Psychological portrait content'),
    generate: vi.fn().mockResolvedValue({ ok: true, markdown: 'Generated' }),
    exportMarkdown: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('../services/LifeStoryService', () => ({
  LifeStoryService: {
    getAll: vi.fn().mockResolvedValue([]),
    getDefaultEventDate: (d: string) => d,
  },
}));

vi.mock('../services/NoteAnalysisService', () => ({
  NoteAnalysisService: {
    findPending: vi.fn().mockResolvedValue({ ids: [], totalDocuments: 0, alreadyAnalyzed: 0, noContent: 0, tooShort: 0, excluded: 0 }),
    analyzePending: vi.fn().mockResolvedValue({ analyzed: 0, missingVectors: 0 }),
  },
}));

vi.mock('../services/AIProfileRefreshService', () => ({
  AIProfileRefreshService: {
    getCurrentStep: () => null,
    subscribe: () => () => {},
    estimate: vi.fn().mockResolvedValue({ seconds: 60, totalCalls: 5, steps: [] }),
    run: vi.fn().mockResolvedValue({ failed: [] }),
  },
}));

describe('T-1 (c) AI panel components English localization (no Cyrillic characters)', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('app_language', 'en');
  });

  const assertNoCyrillicInElement = (container: HTMLElement) => {
    const cyrillicRegex = /[А-Яа-яЁё]/;
    expect(container.textContent).not.toMatch(cyrillicRegex);

    const elementsWithAttrs = container.querySelectorAll('[placeholder], [aria-label], [title], [alt]');
    elementsWithAttrs.forEach(el => {
      ['placeholder', 'aria-label', 'title', 'alt'].forEach(attr => {
        const val = el.getAttribute(attr);
        if (val) {
          expect(val).not.toMatch(cyrillicRegex);
        }
      });
    });
  };

  it('ThinkingIndicator has no Cyrillic text in English', () => {
    const { container } = render(
      <LanguageProvider>
        <ThinkingIndicator name="Assistant" />
      </LanguageProvider>
    );
    assertNoCyrillicInElement(container);
  });

  it('AIChatComposer has no Cyrillic text or attrs in English', () => {
    const { container } = render(
      <LanguageProvider>
        <AIChatComposer
          inputText={"Some text longer than 1500 characters so that the note paste button appears. ".repeat(30)}
          setInputText={() => {}}
          inputRef={{ current: null }}
          isLoading={false}
          onStop={() => {}}
          onSend={() => {}}
          pendingAttachments={[]}
          removePendingAttachment={() => {}}
          onPasteAsNote={() => {}}
          attachMenuOpen={false}
          setAttachMenuOpen={() => {}}
          attachMenuRef={{ current: null }}
          fileInputRef={{ current: null }}
          onFileUpload={() => {}}
          onOpenDocPicker={() => {}}
          dailyLimitRemaining={10}
          dailyLimitTotal={30}
          maxInputChars={4000}
          personaName="Helper"
          crisisActive={true}
          dismissCrisis={() => {}}
        />
      </LanguageProvider>
    );
    assertNoCyrillicInElement(container);
  });

  it('AIChatHeader has no Cyrillic text or attrs in English', () => {
    const { container } = render(
      <LanguageProvider>
        <AIChatHeader
          isMobile={false}
          headerVisual={{ color: '#888', mono: 'H', role: { ru: 'Роль', en: 'Role' } }}
          activePersonaName="Helper"
          activeRole="Assistant"
          dialogueTitle="Chat title"
          hasActiveDialogue={true}
          activeDialogueId="d1"
          onOpenMemory={() => {}}
          responseLength="standard"
          reasoning={true}
          onSetResponseLength={() => {}}
          onToggleReasoning={() => {}}
          onExport={() => {}}
          onArchive={() => {}}
          onDelete={() => {}}
          onRename={() => {}}
          selectedPersonaId="p1"
          setSelectedPersonaId={() => {}}
          allPersonas={[{ id: 'p1', name: 'Helper', emoji: '🤖', isPreset: true }]}
          openPersonaDetail={() => {}}
          onCreatePersona={() => {}}
        />
      </LanguageProvider>
    );
    assertNoCyrillicInElement(container);
  });

  it('AIChatMessages has no Cyrillic text in English', () => {
    const { container } = render(
      <LanguageProvider>
        <AIChatMessages
          displayMessages={[
            { role: 'assistant', content: 'Hello world', searchRequest: 'query', reasoning: 'Thinking steps' },
            { role: 'user', content: 'User message' },
          ]}
          streamingMessage={null}
          streamingReasoning={null}
          isLoading={false}
          error={null}
          clearError={() => {}}
          consentRequired={null}
          onOpenSettings={() => {}}
          convPersonaName="Helper"
          convVisual={{ color: '#888', mono: 'H', role: { ru: 'Роль', en: 'Role' } }}
          onCopyMessage={() => {}}
          onDeleteMessage={() => {}}
          onFeedback={() => {}}
          onRegenerate={() => {}}
          onSwitchVariant={() => {}}
          onCreateNote={() => {}}
          onForcedSearch={() => {}}
          dailyLimitRemaining={10}
          followUps={['Follow up 1']}
          onSuggestion={() => {}}
          starters={['Starter 1']}
          activeDialogueId="d1"
          activePersonaName="Helper"
          headerVisual={{ color: '#888', mono: 'H', role: { ru: 'Роль', en: 'Role' } }}
          proactiveHint="Let's discuss «project»"
          setInputText={() => {}}
          isMobile={false}
          messagesEndRef={{ current: null }}
          previewSession={null}
          onClosePreview={() => {}}
          setCitationPreviewSession={() => {}}
        />
      </LanguageProvider>
    );
    assertNoCyrillicInElement(container);
  });

  it('AIChatSidebar has no Cyrillic attrs in English', () => {
    const { container } = render(
      <LanguageProvider>
        <AIChatSidebar
          dialogues={[]}
          archivedDialogues={[]}
          activeDialogueId={null}
          onSelectDialogue={() => {}}
          showArchived={false}
          setShowArchived={() => {}}
          onNewDialogue={() => {}}
          onUnarchive={() => {}}
        />
      </LanguageProvider>
    );
    assertNoCyrillicInElement(container);
  });

  it('Presentational cards and turns have no Cyrillic in English', () => {
    const { container: c1 } = render(
      <LanguageProvider>
        <AttachedNoteCard content={'[Прикреплена заметка: "Note title"]\nNote body'} />
        <AttachedFileCard content={'[Прикреплен файл: "File.txt"]\nFile body'} />
        <AttachedSummaryCard content={'[Прикреплено саммари заметки: "Summary title"]\nSummary body'} />
        <AssistantTurn
          name="Helper"
          color="#888"
          mono="H"
          onCopy={() => {}}
          onCreateNote={() => {}}
          onRegenerate={() => {}}
          onFeedback={() => {}}
          onDelete={() => {}}
        >
          Turn content
        </AssistantTurn>
      </LanguageProvider>
    );
    assertNoCyrillicInElement(c1);
  });

  it('SummaryModal has no Cyrillic text in English', () => {
    const { container } = render(
      <LanguageProvider>
        <SummaryModal
          summary={{
            documentId: 'd1',
            tone: 'positive',
            frequentWords: ['writing', 'notes'],
            themes: ['habits'],
            insights: ['Key insight'],
            extractedFacts: ['Fact 1'],
            processedAt: Date.now(),
          }}
          onClose={() => {}}
        />
      </LanguageProvider>
    );
    assertNoCyrillicInElement(container);
  });

  it('DocumentPickerModal has no Cyrillic text or attrs in English', () => {
    const { container } = render(
      <LanguageProvider>
        <DocumentPickerModal isOpen={true} onClose={() => {}} onSelect={() => {}} />
      </LanguageProvider>
    );
    assertNoCyrillicInElement(container);
  });

  it('PersonaDetailModal has no Cyrillic text or attrs in English', () => {
    const { container } = render(
      <LanguageProvider>
        <PersonaDetailModal
          persona={{
            id: 'custom_1',
            name: 'Custom Buddy',
            isPreset: false,
            systemPrompt: 'You are a helper',
            color: '#888',
            mono: 'C',
          }}
          onClose={() => {}}
          onChanged={() => {}}
        />
      </LanguageProvider>
    );
    assertNoCyrillicInElement(container);
  });

  it('CreatePersonaModal has no Cyrillic text or attrs in English', () => {
    const { container } = render(
      <LanguageProvider>
        <CreatePersonaModal isOpen={true} onClose={() => {}} onCreated={() => {}} />
      </LanguageProvider>
    );
    assertNoCyrillicInElement(container);
  });

  it('ContactDoors has no Cyrillic text in English', () => {
    const { container } = render(
      <LanguageProvider>
        <ContactDoors readOnly={true} />
      </LanguageProvider>
    );
    assertNoCyrillicInElement(container);
  });

  it('AuthorPortrait has no Cyrillic text in English', () => {
    const { container } = render(
      <ToastProvider>
        <LanguageProvider>
          <AuthorPortrait readOnly={false} />
        </LanguageProvider>
      </ToastProvider>
    );
    assertNoCyrillicInElement(container);
  });

  it('LifeStoryTimeline has no Cyrillic text in English', () => {
    const { container } = render(
      <LanguageProvider>
        <LifeStoryTimeline />
      </LanguageProvider>
    );
    assertNoCyrillicInElement(container);
  });

  it('ArchiveAnalysisButton has no Cyrillic text in English', () => {
    const { container } = render(
      <ToastProvider>
        <LanguageProvider>
          <ArchiveAnalysisButton />
        </LanguageProvider>
      </ToastProvider>
    );
    assertNoCyrillicInElement(container);
  });

  it('ProfileRefreshButton has no Cyrillic text in English', () => {
    const { container } = render(
      <ToastProvider>
        <LanguageProvider>
          <ProfileRefreshButton />
        </LanguageProvider>
      </ToastProvider>
    );
    assertNoCyrillicInElement(container);
  });

  it('renders expected Russian Cyrillic strings when in Russian locale', () => {
    localStorage.setItem('app_language', 'ru');
    const { getByText: getByTextDoors } = render(
      <LanguageProvider>
        <ContactDoors />
      </LanguageProvider>
    );
    expect(getByTextDoors('Три двери контакта')).toBeTruthy();

    const { getByText: getByTextArchive } = render(
      <ToastProvider>
        <LanguageProvider>
          <ArchiveAnalysisButton />
        </LanguageProvider>
      </ToastProvider>
    );
    expect(getByTextArchive('Разобрать заметки')).toBeTruthy();

    const { getByText: getByTextProfile } = render(
      <ToastProvider>
        <LanguageProvider>
          <ProfileRefreshButton />
        </LanguageProvider>
      </ToastProvider>
    );
    expect(getByTextProfile('Обновить профиль')).toBeTruthy();
  });
});
