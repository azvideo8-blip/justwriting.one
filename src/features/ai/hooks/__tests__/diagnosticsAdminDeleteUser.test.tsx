import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// V-3: кнопка «Удалить» в админке — через хук, а не через компонент. После
// удаления список перечитывается (меняется users.length, эффект зовёт fetchData
// заново), поэтому здесь перечитания висят в полёте: строка может исчезнуть
// только потому, что её убрал сам клиент — именно это и проверяется.
const { callAi, getUsers, showToast, confirmDialog, reauthenticate, getCurrentUser } = vi.hoisted(() => ({
  callAi: vi.fn(async (..._args: unknown[]): Promise<unknown> => ({ success: true })),
  getUsers: vi.fn(async (): Promise<unknown> => []),
  showToast: vi.fn(),
  confirmDialog: vi.fn(async () => true),
  reauthenticate: vi.fn(async (_email: string, _password: string) => {}),
  getCurrentUser: vi.fn(() => ({ uid: 'admin-1', email: 'admin@example.com' })),
}));

// Остальные экспорты callAi (onAiQuotaHeaders) оставляем настоящими: стор
// лимитов подписывается на них при импорте.
vi.mock('../../../../core/ai/callAi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../core/ai/callAi')>();
  return { ...actual, callAi: (...a: unknown[]) => callAi(...a) };
});
vi.mock('../../../../core/data', () => ({ DataProvider: { getUsers: () => getUsers() } }));
vi.mock('../../../../core/auth', () => ({
  getCurrentUser: () => getCurrentUser(),
  reauthenticate: (email: string, password: string) => reauthenticate(email, password),
  sendPasswordResetEmail: vi.fn(async () => {}),
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../../../../shared/components/ConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm: confirmDialog }) }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));
vi.mock('../../../auth/hooks/useAdminStatus', () => ({ useAdminStatus: () => ({ isAdmin: true, isStaleToken: false, error: null }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { useDiagnosticsData } from '../useDiagnosticsData';

let server: Array<{ id: string; email: string }>;
let listCalls: number;
let deleteFails: boolean;

function renderAdmin() {
  return renderHook(() => useDiagnosticsData(null, false, 'users'));
}

const uids = (r: { current: { users: Array<{ uid: string }> } }) => r.current.users.map(u => u.uid);

beforeEach(() => {
  server = [{ id: 'u-1', email: 'one@example.com' }, { id: 'u-2', email: 'two@example.com' }];
  listCalls = 0;
  deleteFails = false;
  confirmDialog.mockReset();
  confirmDialog.mockResolvedValue(true);
  reauthenticate.mockReset();
  reauthenticate.mockResolvedValue(undefined);
  showToast.mockClear();
  getUsers.mockImplementation(async () => {
    listCalls += 1;
    if (listCalls > 1) return new Promise(() => {});
    return server.map(r => ({ ...r }));
  });
  callAi.mockReset();
  callAi.mockImplementation(async (endpoint: unknown, data?: unknown) => {
    if (endpoint === 'listUsersWithStatus') return [];
    if (endpoint !== 'adminDeleteUser') return { success: true };
    if (deleteFails) throw new Error('Не удалось удалить пользователя.');
    server = server.filter(r => r.id !== (data as { uid?: string })?.uid);
    return { success: true };
  });
});

describe('админка: «Удалить» пользователя', () => {
  it('отказ от подтверждения — сервер не вызывается, список цел', async () => {
    confirmDialog.mockResolvedValue(false);
    const { result, unmount } = renderAdmin();
    await waitFor(() => expect(uids(result)).toEqual(['u-1', 'u-2']));
    callAi.mockClear();

    await act(async () => { await result.current.handleDeleteUser(result.current.users[0]!); });

    expect(callAi).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
    expect(uids(result)).toEqual(['u-1', 'u-2']);
    unmount();
  });

  // R7Q-009: подтверждение диалога больше не удаляет — удаление требует свежего
  // ввода пароля, иначе живой токен, перехваченный в обход экрана, стирает архив
  // одним POST'ом. Сервер сверяет `amr`, клиент обязан его обновить reauth'ом.
  it('подтверждение без пароля ничего не удаляет', async () => {
    const { result, unmount } = renderAdmin();
    await waitFor(() => expect(uids(result)).toEqual(['u-1', 'u-2']));

    await act(async () => { await result.current.handleDeleteUser(result.current.users[0]!); });

    expect(result.current.pendingDeleteUid).toBe('u-1');
    expect(callAi.mock.calls.some(c => c[0] === 'adminDeleteUser')).toBe(false);
    expect(reauthenticate).not.toHaveBeenCalled();
    unmount();
  });

  it('пароль → re-auth → adminDeleteUser, и строка уходит из списка', async () => {
    const { result, unmount } = renderAdmin();
    await waitFor(() => expect(uids(result)).toEqual(['u-1', 'u-2']));

    await act(async () => { await result.current.handleDeleteUser(result.current.users[0]!); });
    await act(async () => { await result.current.confirmDeleteUser(result.current.users[0]!, 'current-password'); });

    expect(reauthenticate).toHaveBeenCalledWith('admin@example.com', 'current-password');
    expect(callAi).toHaveBeenCalledWith('adminDeleteUser', { uid: 'u-1' });
    await waitFor(() => expect(uids(result)).toEqual(['u-2']));
    expect(showToast).toHaveBeenCalledWith('admin_delete_user_success', 'success');
    expect(result.current.deletingUid).toBeNull();
    expect(result.current.pendingDeleteUid).toBeNull();
    unmount();
  });

  it('неверный пароль — удаления нет, ошибка показана у строки', async () => {
    reauthenticate.mockRejectedValueOnce(Object.assign(new Error('Invalid login credentials'), { code: 'invalid_credentials' }));
    const { result, unmount } = renderAdmin();
    await waitFor(() => expect(uids(result)).toEqual(['u-1', 'u-2']));

    await act(async () => { await result.current.handleDeleteUser(result.current.users[0]!); });
    await act(async () => { await result.current.confirmDeleteUser(result.current.users[0]!, 'wrong'); });

    expect(callAi).not.toHaveBeenCalledWith('adminDeleteUser', expect.anything());
    expect(result.current.deletePasswordError).toBe('settings_delete_account_wrong_password');
    expect(uids(result)).toEqual(['u-1', 'u-2']);
    unmount();
  });

  it('отказ сервера — тост с причиной, строка остаётся', async () => {
    deleteFails = true;
    const { result, unmount } = renderAdmin();
    await waitFor(() => expect(uids(result)).toEqual(['u-1', 'u-2']));

    await act(async () => { await result.current.handleDeleteUser(result.current.users[0]!); });
    await act(async () => { await result.current.confirmDeleteUser(result.current.users[0]!, 'current-password'); });

    expect(callAi).toHaveBeenCalledWith('adminDeleteUser', { uid: 'u-1' });
    expect(showToast).toHaveBeenCalledWith('admin_delete_user_error', 'error');
    expect(uids(result)).toEqual(['u-1', 'u-2']);
    expect(result.current.deletingUid).toBeNull();
    unmount();
  });

  it('пока запрос идёт, строка помечена удаляемой, и отметка снимается по ответе', async () => {
    let release: ((v: { success: true }) => void) | null = null;
    callAi.mockImplementation(async (endpoint: unknown) => {
      if (endpoint === 'listUsersWithStatus') return [];
      return await new Promise<{ success: true }>(res => { release = res; });
    });
    const { result, unmount } = renderAdmin();
    await waitFor(() => expect(uids(result)).toEqual(['u-1', 'u-2']));

    await act(async () => { await result.current.handleDeleteUser(result.current.users[0]!); });

    let done = false;
    act(() => { void result.current.confirmDeleteUser(result.current.users[0]!, 'current-password').then(() => { done = true; }); });
    await waitFor(() => expect(result.current.deletingUid).toBe('u-1'));
    expect(uids(result)).toEqual(['u-1', 'u-2']);

    await act(async () => { release?.({ success: true }); await new Promise(r => setTimeout(r, 0)); });
    await waitFor(() => expect(done).toBe(true));
    expect(result.current.deletingUid).toBeNull();
    unmount();
  });
});
