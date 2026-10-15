// MQ-3: autoLoadDraftIfEmpty различает «черновик подставлен в пустой редактор» (баннеру
// «Восстановить» нечего делать) и «в редакторе другой текст» (есть что выбирать).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSessionPersistence } from '../useSessionPersistence';
import { WritingDraftService } from '../../services/WritingDraftService';
import { useContentStore } from '../../store/useContentStore';
import type { AppUser } from '../../../../core/auth/types';

vi.mock('../useDraftAutosave', () => ({
  useDraftAutosave: () => ({ saveStatus: 'idle', saveErrorKind: null, lastSavedAt: null }),
}));
vi.mock('../../../../shared/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
vi.mock('../../utils/draftUtils', () => ({ applyDraftToStores: vi.fn() }));

const user: AppUser = { uid: 'mq3_user', email: 'a@b.c', displayName: 't', photoURL: null, metadata: { creationTime: null, lastSignInTime: null } };
const actions = {
  setContent: vi.fn(), setTitle: vi.fn(), setPinnedThoughts: vi.fn(), setActiveSessionId: vi.fn(), setHasDraft: vi.fn(), setDraftInEditor: vi.fn(),
  resetAndClear: vi.fn(), resetSession: vi.fn(), setStatus: vi.fn(), setInitialWordCount: vi.fn(), setInitialDuration: vi.fn(),
};
const slice = { title: '', content: '', pinnedThoughts: [], tags: [], sessionType: 'free' as const, activeSessionId: null, initialDuration: 0, initialWordCount: 0, sessionStartTime: null };
const timing = { seconds: 0, wpm: 0, wordCount: 0, status: 'idle' as const, timeGoalReached: false, wordGoalReached: false };
const draft = { userId: 'mq3_user', title: '', content: 'Текст из облачного черновика', seconds: 3, wpm: 2, wordCount: 4, updatedAt: Date.now() };

describe('MQ-3: draftInEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(WritingDraftService, 'loadDraft').mockResolvedValue(draft);
    vi.spyOn(WritingDraftService, 'clearLegacyDraft').mockResolvedValue(undefined);
  });

  it('пустой редактор: черновик подставлен — draftInEditor=true, hasDraft по-прежнему выставляется', async () => {
    useContentStore.setState({ content: '' });
    renderHook(() => useSessionPersistence(user, null, slice, timing, actions));
    await waitFor(() => expect(actions.setDraftInEditor).toHaveBeenCalledWith(true));
    expect(actions.setHasDraft).toHaveBeenCalledWith(true);
  });

  it('в редакторе другой текст: draftInEditor=false — «Восстановить» осмысленно', async () => {
    useContentStore.setState({ content: 'Совсем другой текст' });
    renderHook(() => useSessionPersistence(user, null, slice, timing, actions));
    await waitFor(() => expect(actions.setDraftInEditor).toHaveBeenCalledWith(false));
    expect(actions.setDraftInEditor).not.toHaveBeenCalledWith(true);
  });

  it('в редакторе уже тот же текст: draftInEditor=true', async () => {
    useContentStore.setState({ content: draft.content });
    renderHook(() => useSessionPersistence(user, null, slice, timing, actions));
    await waitFor(() => expect(actions.setDraftInEditor).toHaveBeenCalledWith(true));
  });
});
