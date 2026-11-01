import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDraftSession } from '../useDraftSession';
import { WritingDraftService } from '../../services/WritingDraftService';
import { useContentStore } from '../../store/useContentStore';
import type { LocalDraft } from '../../../../core/storage/localDb';

vi.mock('../../services/WritingDraftService', () => ({
  WritingDraftService: {
    loadDraft: vi.fn(),
    bumpDraftGeneration: vi.fn(),
    deleteDraft: vi.fn(),
  },
}));

describe('DW-F-3: useDraftSession не подставляет устаревший ответ загрузки', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useContentStore.setState({ content: '', title: '', wordCount: 0, ownerUid: null });
  });

  it('ответ загрузки A, пришедший после смены на B, в редактор не попадает', async () => {
    let resolveLoad!: (value: LocalDraft | null) => void;
    vi.mocked(WritingDraftService.loadDraft).mockReturnValue(
      new Promise((resolve) => { resolveLoad = resolve; }),
    );
    const { result, rerender } = renderHook(
      ({ uid }: { uid: string }) => useDraftSession(uid, false),
      { initialProps: { uid: 'u-a' } },
    );

    let loading!: Promise<void>;
    act(() => { loading = result.current.autoLoadDraftIfEmpty(); });
    rerender({ uid: 'u-b' });
    await act(async () => {
      resolveLoad({ content: 'текст A', title: '', wordCount: 2 } as LocalDraft);
      await loading;
    });

    expect(useContentStore.getState().content).toBe('');
    expect(useContentStore.getState().ownerUid).toBeNull();
  });

  it('свой ответ подставляется и помечает владельца', async () => {
    vi.mocked(WritingDraftService.loadDraft).mockResolvedValue(
      { content: 'текст A', title: '', wordCount: 2 } as never,
    );
    const { result } = renderHook(() => useDraftSession('u-a', false));

    await act(async () => { await result.current.autoLoadDraftIfEmpty(); });

    expect(useContentStore.getState().content).toBe('текст A');
    expect(useContentStore.getState().ownerUid).toBe('u-a');
  });
});
