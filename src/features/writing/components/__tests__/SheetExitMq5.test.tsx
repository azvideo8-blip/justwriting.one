// MQ-5: листы «Записано.», действий и переименования после закрытия не исчезают за кадр —
// тело остаётся смонтированным на время ухода. Тест с настоящим motion: AnimatePresence
// внутри ModalShell держит окно, пока играет exit.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { WritingFinishModal } from '../WritingFinishModal';
import { MobileNoteActionsSheet } from '../../../../app/components/MobileNoteActionsSheet';
import { MobileRenameSheet } from '../../../archive/components/MobileRenameSheet';
import { ToastProvider } from '../../../../shared/components/Toast';
import { useContentStore } from '../../store/useContentStore';
import { useTimerStore } from '../../store/useTimerStore';
import { useSessionMetaStore } from '../../store/useSessionMetaStore';
import type { ArchiveSession } from '../../../archive/types';

vi.mock('../../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode: 'mobile', setLayoutMode: vi.fn() }),
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
vi.mock('../WpmChart', () => ({ WpmChart: () => <div /> }));
vi.mock('../../../lifeLog/hooks/useCorpusDf', () => ({ buildCorpusDf: vi.fn().mockResolvedValue({ df: new Map(), N: 0 }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../../../core/services/StorageService', () => ({
  StorageService: { addLocalCopy: vi.fn(), addCloudCopy: vi.fn(), removeLocalCopy: vi.fn(), removeCloudCopy: vi.fn(), trashDocument: vi.fn() },
}));
vi.mock('../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: { getDocumentsByOwner: vi.fn().mockResolvedValue([]), unlinkFromCloud: vi.fn(), clearLocalOnlyForUpload: vi.fn() },
}));

const dialogs = () => document.querySelectorAll('[role="dialog"]').length;
const wait = (ms: number) => act(() => new Promise<void>(r => setTimeout(r, ms)));

describe('MQ-5: лист уходит, а не исчезает', () => {
  beforeEach(() => { cleanup(); });
  afterEach(() => cleanup());

  it('«Записано.»: после isOpen=false окно ещё в DOM, потом уходит', async () => {
    useContentStore.setState({ content: 'Текст.', wordCount: 3, initialWordCount: 0, wpm: 10 });
    useTimerStore.setState({ seconds: 40, sessionStartSeconds: 0, accumulatedDuration: 40, totalPauseSeconds: 0, status: 'idle' } as Partial<ReturnType<typeof useTimerStore.getState>>);
    useSessionMetaStore.setState({ savedDocumentId: 'doc_1', sessionStartTime: Date.now() });
    const onSave = vi.fn();
    const ui = (open: boolean) => <ToastProvider><WritingFinishModal isOpen={open} onCancel={vi.fn()} onSave={onSave} /></ToastProvider>;
    const { rerender } = render(ui(true));
    expect(dialogs()).toBe(1);
    rerender(ui(false));
    expect(dialogs(), 'лист исчез за кадр').toBe(1);
    await wait(700);
    expect(dialogs()).toBe(0);
  });

  const session = {
    id: 'd1', userId: 'u1', title: 'Заметка', content: 'Текст заметки.', duration: 10, wordCount: 2, charCount: 14, wpm: 1,
    tags: [], createdAt: Date.now(), _isLocal: true,
  } as unknown as ArchiveSession;

  it('лист действий: уходит вниз после закрытия', async () => {
    const sheet = (open: boolean) => (
      <ToastProvider>
        <MobileNoteActionsSheet isOpen={open} onClose={vi.fn()} session={session} userId="u1" onOpen={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} onLabelChange={vi.fn()} onStorageChange={vi.fn()} />
      </ToastProvider>
    );
    const { rerender } = render(sheet(true));
    expect(dialogs()).toBe(1);
    rerender(sheet(false));
    expect(dialogs(), 'лист действий исчез за кадр').toBe(1);
    await wait(700);
    expect(dialogs()).toBe(0);
  });

  it('лист переименования: уходит вниз после закрытия', async () => {
    const sheet = (open: boolean) => <MobileRenameSheet open={open} initialTitle="А" onCancel={vi.fn()} onSave={vi.fn()} />;
    const { rerender } = render(sheet(true));
    expect(dialogs()).toBe(1);
    rerender(sheet(false));
    expect(dialogs(), 'лист переименования исчез за кадр').toBe(1);
    await wait(700);
    expect(dialogs()).toBe(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
