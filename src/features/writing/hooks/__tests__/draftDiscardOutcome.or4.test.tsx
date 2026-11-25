// OR-4: «Удалить черновик» при отказе базы. У гостя надгробия нет — черновик на месте, и
// молчаливое «нет черновика» было неправдой. У аккаунта строку закрывает надгробие: полоса
// «есть черновик» обещала бы то, что «Восстановить» уже не отдаст (ревью К29). Настоящий
// draftWriter над IndexedDB, отказывает только стирание строки.
// Мутации: не читать localOk; не смотреть на гостя — красный.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import 'fake-indexeddb/auto';

const showToast = vi.hoisted(() => vi.fn());
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/supabase/client', () => ({ getSupabase: () => { throw new Error('сети в тесте нет'); } }));

import { useDraftSession } from '../useDraftSession';
import { resolve } from '../../services/draftWriter';
import { getLocalDb } from '../../../../core/storage/localDb';
import { useContentStore } from '../../store/useContentStore';

const draft = (key: string) => ({ userId: key, content: 'синтетический черновик', title: '', wordCount: 2, updatedAt: Date.now() });

async function discard(uid: string, isGuest: boolean, rowKey: string) {
  const db = await getLocalDb(uid);
  await db.put('drafts', draft(rowKey) as never);
  const del = vi.spyOn(db, 'delete').mockRejectedValue(new Error('база отказала'));
  const { result } = renderHook(() => useDraftSession(uid, isGuest));
  act(() => { result.current.setHasDraft(true); });
  await act(async () => { await result.current.discardDraft(); });
  expect(del).toHaveBeenCalled();
  del.mockRestore();
  return result.current.hasDraft;
}

describe('OR-4: «Удалить черновик» читает итог', () => {
  beforeEach(() => {
    localStorage.clear();
    showToast.mockClear();
    useContentStore.setState({ content: '', title: '', wordCount: 0 });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('гость: база отказала — черновик на месте, полоса и ошибка', async () => {
    expect(await discard('guest-or4', true, 'guest_draft')).toBe(true);
    expect(showToast).toHaveBeenCalledWith('error_delete_failed', 'error');
    expect((await resolve('guest-or4', { guest: true }))?.content).toBe('синтетический черновик');
  });

  it('аккаунт: база отказала — черновик закрыт надгробием, полосы нет и вернуть нечего', async () => {
    expect(await discard('u-or4', false, 'u-or4')).toBe(false);
    expect(showToast).not.toHaveBeenCalled();
    expect(await resolve('u-or4')).toBeNull();
  });

  it('гость: удалилось — полосы нет, сообщения нет', async () => {
    const { result } = renderHook(() => useDraftSession('guest-or4b', true));
    act(() => { result.current.setHasDraft(true); });
    await act(async () => { await result.current.discardDraft(); });
    expect(result.current.hasDraft).toBe(false);
    expect(showToast).not.toHaveBeenCalled();
  });
});
