/**
 * Н-4 (дейлик 17.11): «выйти и удалить данные» в одной вкладке — соседняя
 * вкладка того же аккаунта узнаёт о выходе только после ответа сервера, а её
 * таймеры черновика (30 с, debounce, уход со страницы) пишут через мутатор.
 * Метка стирания (localStorage, общая для вкладок) обязана остановить запись
 * в мутаторе — одной проверкой для всех таймеров и для гостя.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { applyWrite, buildGuestDraftRecord, bumpDraftGeneration, clearEditorTextOwner, getDraftGeneration } from '../draftWriter';
import { getLocalDb } from '../../../../core/storage/localDb';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';
import { skipFlushOnAccountReload } from '../../../../core/auth/accountReload';
import { clearSignOutWipeMark } from '../../../../core/auth/signOutWipeMark';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const WIPE_MARK_KEY = 'jw_signout_wipe_at';

async function storedRow(uid: string): Promise<Record<string, unknown> | undefined> {
  const db = await getLocalDb(uid);
  return (await db.get('drafts', uid)) as Record<string, unknown> | undefined;
}

describe('Н-4: выход со стиранием в соседней вкладке останавливает запись черновика', () => {
  beforeEach(() => {
    skipFlushOnAccountReload(false);
    localStorage.clear();
    clearEditorTextOwner();
  });

  it('метка соседней вкладки стоит — строка и копия аккаунта не пишутся', async () => {
    const uid = 'u_n4_tab';
    bumpDraftGeneration(uid);
    // Метку поставила ДРУГАЯ вкладка: в памяти этой вкладки флага нет.
    localStorage.setItem(WIPE_MARK_KEY, String(Date.now()));
    const rec = { content: 'MARKER_N4_после_стирания', owner: uid, updatedAt: Date.now() };
    expect(await applyWrite(rec, 'edit', { uid, epoch: getDraftGeneration(uid) })).toBe('stale-epoch');
    expect(await applyWrite(rec, 'edit', { uid, target: 'copy', epoch: getDraftGeneration(uid) })).toBe('stale-epoch');
    expect(await storedRow(uid), 'черновик воссоздан в стёртой базе').toBeUndefined();
    expect(localStorage.getItem(STORAGE_KEYS.DRAFT(uid)), 'копия воссоздана').toBeNull();
  });

  it('гость: метка стоит — гостевая копия не пишется', async () => {
    const guest = 'guest_n4';
    localStorage.setItem(WIPE_MARK_KEY, String(Date.now()));
    const rec = buildGuestDraftRecord({ content: 'MARKER_N4_гость', owner: guest, timestamp: Date.now() });
    expect(await applyWrite(rec, 'edit', { uid: guest, target: 'copy', epoch: getDraftGeneration(guest) })).toBe('stale-epoch');
    expect(localStorage.getItem(STORAGE_KEYS.GUEST_DRAFT)).toBeNull();
  });

  it('КОНТРОЛЬ: метка старше минуты или снята новым входом — запись идёт', async () => {
    const uid = 'u_n4_ctrl';
    bumpDraftGeneration(uid);
    localStorage.setItem(WIPE_MARK_KEY, String(Date.now() - 61_000));
    const rec = { content: 'MARKER_N4_ctrl', owner: uid, updatedAt: Date.now() };
    expect(await applyWrite(rec, 'edit', { uid, epoch: getDraftGeneration(uid) })).toBe('written');

    skipFlushOnAccountReload();
    clearSignOutWipeMark(); // так снимает метку SIGNED_IN (supabaseAuthProvider)
    expect(await applyWrite(rec, 'edit', { uid, epoch: getDraftGeneration(uid) })).toBe('written');
    expect((await storedRow(uid))?.content).toBe('MARKER_N4_ctrl');
  });
});
