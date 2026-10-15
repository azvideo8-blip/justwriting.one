// MQ-1: тег, введённый руками в «Записано.» на телефоне, виден фишкой с «×» — после SA-24
// подсказок нет, и введённый тег раньше нигде не рисовался.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { WritingFinishModal } from '../WritingFinishModal';
import { useContentStore } from '../../store/useContentStore';
import { useTimerStore } from '../../store/useTimerStore';
import { useSessionMetaStore } from '../../store/useSessionMetaStore';

let layoutMode: 'desktop' | 'mobile' = 'mobile';

const mockShowToast = vi.fn();
vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));
vi.mock('../../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode, setLayoutMode: vi.fn() }),
}));
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru' }),
}));
vi.mock('../../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    quietStats: false,
    setQuietStats: vi.fn(),
    effectiveHeaderVisibility: { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
  }),
}));
vi.mock('motion/react', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    AnimatePresence: ({ children }: any) => <>{children}</>,
    motion: {
      div: ({ children, className, onClick, ...props }: any) => (
        <div className={className} onClick={onClick} {...props}>{children}</div>
      ),
      button: ({ children, className, onClick, ...props }: any) => (
        <button className={className} onClick={onClick} {...props}>{children}</button>
      ),
    },
    useReducedMotion: () => true,
  };
});
vi.mock('../WpmChart', () => ({ WpmChart: () => <div data-testid="wpm-chart" /> }));
vi.mock('../../../lifeLog/hooks/useCorpusDf', () => ({
  buildCorpusDf: vi.fn().mockResolvedValue({ df: new Map(), N: 0 }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

const userDocs = vi.hoisted(() => ({ tags: [] as string[][] }));
vi.mock('../../../../core/services/LocalDocumentService', async (orig) => {
  const actual = await orig<typeof import('../../../../core/services/LocalDocumentService')>();
  return {
    ...actual,
    LocalDocumentService: {
      ...actual.LocalDocumentService,
      getDocumentsByOwner: vi.fn(async () => userDocs.tags.map((tags, i) => ({ id: `d${i}`, tags }))),
    },
  };
});

const TEXT = 'Сегодня глина была послушной. Впервые за неделю руки сами знали, что делать.';

// Теги держит родитель (useWritingPage); хост повторяет это, иначе setTags — заглушка.
function Host({ onSave }: { onSave: () => Promise<unknown> }) {
  const [tags, setTags] = React.useState<string[]>([]);
  return <WritingFinishModal isOpen onCancel={vi.fn()} onSave={onSave as never} tags={tags} setTags={setTags} />;
}

function renderModal(onSave = vi.fn().mockResolvedValue({ docId: 'doc_1', cloudSynced: true, isTooLarge: false })) {
  const view = render(<Host onSave={onSave} />);
  return { ...view, onSave };
}

const typeTag = (word: string) => {
  const input = screen.getByLabelText('finish_add_tag') as HTMLInputElement;
  fireEvent.change(input, { target: { value: word } });
  fireEvent.keyDown(input, { key: 'Enter' });
  return input;
};

describe('MQ-1: a hand-typed tag is drawn on the phone sheet', () => {
  beforeEach(() => {
    cleanup();
    layoutMode = 'mobile';
    userDocs.tags = [];
    useContentStore.setState({ content: TEXT, wordCount: 17, initialWordCount: 0, wpm: 40 });
    useTimerStore.setState({ seconds: 40, sessionStartSeconds: 0, accumulatedDuration: 40, totalPauseSeconds: 0, status: 'idle' } as Partial<ReturnType<typeof useTimerStore.getState>>);
    useSessionMetaStore.setState({ savedDocumentId: 'doc_1', sessionStartTime: Date.now() });
  });

  it('empty userTags: «керамика» + Enter → a #керамика chip with a 44 px remove target', () => {
    renderModal();
    const input = typeTag('керамика');
    expect(input.value).toBe('');
    const chip = screen.getByRole('button', { name: /archive_tag_remove.*#керамика/ });
    expect(chip.className).toContain('min-h-11');
    expect(chip.textContent).toContain('#керамика');
  });

  it('two typed tags are both visible', () => {
    renderModal();
    typeTag('керамика');
    typeTag('терпение');
    expect(screen.getAllByRole('button', { name: /archive_tag_remove/ })).toHaveLength(2);
  });

  it('the remove button drops the tag from what is saved', async () => {
    const { onSave } = renderModal();
    typeTag('керамика');
    typeTag('терпение');
    fireEvent.click(screen.getByRole('button', { name: /archive_tag_remove.*#керамика/ }));
    expect(screen.queryByRole('button', { name: /archive_tag_remove.*#керамика/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'common_save' }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]![0].tags).toEqual(['терпение']);
  });

  it('a suggestion that is already chosen is not offered twice', async () => {
    userDocs.tags = [['глина']];
    renderModal();
    const sugg = await screen.findByRole('button', { name: '#глина' });
    fireEvent.click(sugg);
    expect(screen.queryByRole('button', { name: '#глина' })).toBeNull();
    expect(screen.getByRole('button', { name: /archive_tag_remove.*#глина/ })).toBeTruthy();
  });
});
