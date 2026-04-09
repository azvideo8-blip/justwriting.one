import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WritingPage } from '../pages/WritingPage';
import * as useWritingSessionHook from '../hooks/useWritingSession';
import { LanguageProvider } from '../../../core/i18n';
import { UIProvider } from '../../../contexts/UIContext';

// Mock the hook
vi.mock('../hooks/useWritingSession', () => ({
  useWritingSession: vi.fn()
}));

// Mock docx and file-saver
vi.mock('docx', () => ({
  Document: vi.fn(),
  Packer: { toBlob: vi.fn().mockResolvedValue(new Blob()) },
  Paragraph: vi.fn(),
  TextRun: vi.fn()
}));

vi.mock('file-saver', () => ({
  saveAs: vi.fn()
}));

const renderWithProviders = (ui: React.ReactElement) => {
  return render(
    <LanguageProvider>
      <UIProvider>
        {ui}
      </UIProvider>
    </LanguageProvider>
  );
};

describe('WritingPage', () => {
  const mockUser = { uid: 'test-uid', displayName: 'Test User' } as unknown as import('firebase/auth').User;
  const mockProfile = { uid: 'test-uid', email: 'test@example.com', nickname: 'test-nick' };

  const defaultHookValue = {
    status: 'idle',
    setStatus: vi.fn(),
    title: '',
    setTitle: vi.fn(),
    content: '',
    setContent: vi.fn(),
    seconds: 0,
    wpm: 0,
    wordCount: 0,
    isPublic: false,
    setIsPublic: vi.fn(),
    isAnonymous: false,
    setIsAnonymous: vi.fn(),
    handleStart: vi.fn(),
    handleSave: vi.fn(),
    handleCancel: vi.fn(),
    isOnline: true,
    pinnedThoughts: [],
    showPinnedInput: false,
    setShowPinnedInput: vi.fn(),
    addPinnedThought: vi.fn(),
    removePinnedThought: vi.fn(),
    updatePinnedThought: vi.fn(),
    resetSession: vi.fn(),
    resetSessionMetadata: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useWritingSessionHook.useWritingSession).mockReturnValue(defaultHookValue as unknown as ReturnType<typeof useWritingSessionHook.useWritingSession>);
  });

  it('renders header and settings button in idle state', () => {
    renderWithProviders(<WritingPage user={mockUser} profile={mockProfile} />);
    expect(screen.getByTitle(/Новая сессия/i)).toBeInTheDocument();
  });

  it('calls resetSessionMetadata when clicking "Новая сессия"', () => {
    renderWithProviders(<WritingPage user={mockUser} profile={mockProfile} />);
    const startButton = screen.getByTitle(/Новая сессия/i);
    fireEvent.click(startButton);
    expect(defaultHookValue.resetSessionMetadata).toHaveBeenCalled();
  });

  it('shows finish modal and calls handleSave when clicking "Сохранить"', async () => {
    vi.mocked(useWritingSessionHook.useWritingSession).mockReturnValue({
      ...defaultHookValue,
      status: 'finished'
    } as unknown as ReturnType<typeof useWritingSessionHook.useWritingSession>);

    renderWithProviders(<WritingPage user={mockUser} profile={mockProfile} />);
    const saveButton = screen.getByText(/Сохранить/i);
    fireEvent.click(saveButton);
    expect(defaultHookValue.handleSave).toHaveBeenCalled();
  });

  it('triggers docx export when clicking DOCX button in finish modal', async () => {
    const { saveAs } = await import('file-saver');
    vi.mocked(useWritingSessionHook.useWritingSession).mockReturnValue({
      ...defaultHookValue,
      status: 'finished'
    } as unknown as ReturnType<typeof useWritingSessionHook.useWritingSession>);

    renderWithProviders(<WritingPage user={mockUser} profile={mockProfile} />);
    const docxButton = screen.getByText(/DOCX/i);
    fireEvent.click(docxButton);
    
    await waitFor(() => {
      expect(saveAs).toHaveBeenCalled();
    });
  });
});
