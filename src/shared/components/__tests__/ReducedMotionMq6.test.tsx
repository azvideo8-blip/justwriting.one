// MQ-6: «Уменьшить движение» снимает сдвиг листа, читалки и тоста. Motion гасит только
// позиционные ключи (`x`, `y`, `scale`…); строка `transform` в initial/animate/exit гасится
// не была — сдвиг играл при включённом системном параметре.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { ModalShell } from '../ModalShell';
import { ToastProvider, useToast } from '../Toast';
import { renderWithProviders } from '../../../test/utils/render';
import { DocumentPreview } from '../../../features/archive/components/DocumentPreview';
import type { ArchiveSession } from '../../../features/archive/types';

vi.mock('../../hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode: 'mobile', setLayoutMode: vi.fn() }),
}));
vi.mock('../../../core/services/StorageService', () => ({
  StorageService: { addLocalCopy: vi.fn(), addCloudCopy: vi.fn(), removeLocalCopy: vi.fn(), removeCloudCopy: vi.fn(), trashDocument: vi.fn() },
}));
vi.mock('../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: { unlinkFromCloud: vi.fn(), clearLocalOnlyForUpload: vi.fn() },
}));

// Два кадра: при reduced-motion значение уже на месте, при обычной анимации пружина/кривая
// в 30 мс ещё в пути (сдвиг ≠ 0).
const frames = () => act(() => new Promise<void>(r => setTimeout(r, 40)));
const settled = (el: HTMLElement) => /^(|none|translate[XY]\(0(px|%)?\)|matrix\(1, 0, 0, 1, 0, 0\))$/.test(el.style.transform.trim());

const reduced = (ui: React.ReactNode) => <MotionConfig reducedMotion="always">{ui}</MotionConfig>;

describe('MQ-6: reduced motion снимает сдвиг', () => {
  beforeEach(() => cleanup());

  it('ModalShell (лист): на первом кадре уже на месте', async () => {
    render(reduced(<ModalShell open onClose={() => {}} labelId="h" variant="sheet"><h2 id="h">T</h2></ModalShell>));
    await frames();
    const dialog = screen.getByRole('dialog');
    expect(settled(dialog), `transform=${dialog.style.transform}`).toBe(true);
  });

  it('читалка: на первом кадре уже на месте', async () => {
    const session = {
      id: 'd1', userId: 'u1', title: 'Заметка', content: 'Текст заметки.', duration: 10, wordCount: 2, charCount: 14, wpm: 1,
      tags: [], createdAt: Date.now(), _isLocal: true,
    } as unknown as ArchiveSession;
    const props = {
      session, onClose: vi.fn(), onContinue: vi.fn(), onTagsChange: vi.fn(), onLabelChange: vi.fn(), onAddLabel: vi.fn(),
      labels: [], allTags: [], onAnalyzeNote: vi.fn(), fetchSummary: vi.fn().mockResolvedValue(null), fetchRelatedNotes: vi.fn().mockResolvedValue([]),
    } as ComponentProps<typeof DocumentPreview>;
    renderWithProviders(reduced(<MemoryRouter><ToastProvider><DocumentPreview {...props} /></ToastProvider></MemoryRouter>));
    await frames();
    const reader = screen.getByTestId('note-reader');
    expect(settled(reader), `transform=${reader.style.transform}`).toBe(true);
  });

  it('тост: на первом кадре уже на месте', async () => {
    function Fire() {
      const { showToast } = useToast();
      React.useEffect(() => { showToast('Готово', 'success'); }, [showToast]);
      return null;
    }
    render(reduced(<ToastProvider><Fire /></ToastProvider>));
    await frames();
    const toast = screen.getByText('Готово').closest('div[style]') as HTMLElement;
    expect(settled(toast), `transform=${toast.style.transform}`).toBe(true);
  });
});
