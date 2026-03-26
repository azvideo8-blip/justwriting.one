import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WritingView } from '../views/WritingView';
import * as useWritingSessionHook from '../hooks/useWritingSession';

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

describe('WritingView', () => {
  const mockUser = { uid: 'test-uid', displayName: 'Test User' } as unknown as import('firebase/auth').User;
  const mockProfile = { nickname: 'test-nick' };

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
    handlePause: vi.fn(),
    handleFinish: vi.fn(),
    handleSave: vi.fn(),
    formatTime: (s: number) => `${s}s`,
    isOnline: true
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useWritingSessionHook.useWritingSession).mockReturnValue(defaultHookValue as unknown as ReturnType<typeof useWritingSessionHook.useWritingSession>);
  });

  it('renders header and settings button in idle state', () => {
    render(<WritingView user={mockUser} profile={mockProfile} />);
    expect(screen.getByText(/Новая/i)).toBeInTheDocument();
    expect(screen.getByTitle(/Настройки текста/i)).toBeInTheDocument();
  });

  it('calls handleStart when clicking "Новая"', () => {
    render(<WritingView user={mockUser} profile={mockProfile} />);
    const startButton = screen.getByText(/Новая/i);
    fireEvent.click(startButton);
    expect(defaultHookValue.handleStart).toHaveBeenCalled();
  });

  it('shows finish modal and calls handleSave when clicking "Сохранить"', async () => {
    vi.mocked(useWritingSessionHook.useWritingSession).mockReturnValue({
      ...defaultHookValue,
      status: 'finished'
    } as unknown as ReturnType<typeof useWritingSessionHook.useWritingSession>);

    render(<WritingView user={mockUser} profile={mockProfile} />);
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

    render(<WritingView user={mockUser} profile={mockProfile} />);
    const docxButton = screen.getByText(/DOCX/i);
    fireEvent.click(docxButton);
    
    await waitFor(() => {
      expect(saveAs).toHaveBeenCalled();
    });
  });
});
