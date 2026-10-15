// MF-6: в «Записано.» на телефоне первая фраза стояла трижды — курсивом под
// статистикой, в поле названия и в самой заметке. Курсива больше нет.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
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

function renderModal(onSave = vi.fn().mockResolvedValue({ docId: 'doc_1', cloudSynced: true, isTooLarge: false })) {
  const onCancel = vi.fn();
  const view = render(<WritingFinishModal isOpen onCancel={onCancel} onSave={onSave} />);
  return { ...view, onCancel, onSave };
}

describe('MF-6: no italic first-sentence line in mobile «Записано.»', () => {
  beforeEach(() => {
    cleanup();
    layoutMode = 'mobile';
    useContentStore.setState({ content: 'Привет! Хочу проверить, насколько хорошо распознаётся.', wordCount: 7, initialWordCount: 0, wpm: 40 });
    useTimerStore.setState({ seconds: 40, sessionStartSeconds: 0, accumulatedDuration: 40, totalPauseSeconds: 0, status: 'idle' } as Partial<ReturnType<typeof useTimerStore.getState>>);
    useSessionMetaStore.setState({ savedDocumentId: 'doc_1', sessionStartTime: Date.now() });
  });

  it('the first sentence appears only as the title placeholder', () => {
    const { container } = renderModal();
    const sheet = container.ownerDocument.querySelector('[aria-labelledby="finish-modal-title"]')!;
    const hits = Array.from(sheet.querySelectorAll('*'))
      .filter(el => el.children.length === 0 && /Привет!/.test(el.textContent ?? ''));
    expect(hits.map(el => el.tagName), 'первая фраза видна вне поля названия').toEqual([]);
    expect(sheet.querySelector('input[placeholder^="Привет!"]'), 'поле названия потеряло подсказку').toBeTruthy();
  });
});
