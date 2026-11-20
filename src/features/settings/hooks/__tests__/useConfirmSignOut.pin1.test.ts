// PIN-1 (дейлик 20.11): выход из окна подтверждения — итог назван по смыслу.
//  общий отказ → error «не удалось выйти» + проброс; UnsyncedLocalDataError → без тоста (окно показывает inline);
//  LocalWipeFailedError → без тоста (то же сообщение покажет новая страница); успех → событие сброса.
// Мутации: убрать условие `!isUnsynced && !isWipeFailed` (красные кейсы 2–3); убрать showToast (кейс 1);
// убрать `throw e` (кейсы 1–3 теряют отказ).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const h = vi.hoisted(() => ({ signOut: vi.fn(), showToast: vi.fn(), emit: vi.fn() }));
vi.mock('../../../../app/AuthService', () => ({ AuthService: { signOut: (...a: unknown[]) => h.signOut(...a) } }));
vi.mock('../../../../core/events/domainEvents', () => ({ emitDomainEvent: (...a: unknown[]) => h.emit(...a) }));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: h.showToast }) }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));

import { useConfirmSignOut } from '../useConfirmSignOut';

const named = (name: string) => Object.assign(new Error(name), { name });

describe('PIN-1: useConfirmSignOut', () => {
  beforeEach(() => vi.clearAllMocks());

  it('1. общий отказ выхода — error «не удалось выйти» и проброс', async () => {
    h.signOut.mockRejectedValue(new Error('MARKER_PIN1_NET'));
    const { result } = renderHook(() => useConfirmSignOut());
    await expect(result.current({ clearLocalData: false })).rejects.toThrow('MARKER_PIN1_NET');
    expect(h.showToast).toHaveBeenCalledWith('error_signout_failed', 'error');
    expect(h.emit).not.toHaveBeenCalled();
  });

  it('2. есть несинхронизированное (UnsyncedLocalDataError) — без тоста, ошибка проброшена в окно', async () => {
    h.signOut.mockRejectedValue(named('UnsyncedLocalDataError'));
    const { result } = renderHook(() => useConfirmSignOut());
    await expect(result.current({ clearLocalData: true })).rejects.toMatchObject({ name: 'UnsyncedLocalDataError' });
    expect(h.showToast).not.toHaveBeenCalled();
  });

  it('3. стирание не удалось (LocalWipeFailedError) — без тоста, проброс', async () => {
    h.signOut.mockRejectedValue(named('LocalWipeFailedError'));
    const { result } = renderHook(() => useConfirmSignOut());
    await expect(result.current({ clearLocalData: true, force: true })).rejects.toMatchObject({ name: 'LocalWipeFailedError' });
    expect(h.showToast).not.toHaveBeenCalled();
  });

  it('КОНТРОЛЬ: выход удался — событие сброса, без тоста', async () => {
    h.signOut.mockResolvedValue(undefined);
    const { result } = renderHook(() => useConfirmSignOut());
    await result.current({ clearLocalData: false });
    expect(h.emit).toHaveBeenCalledWith({ type: 'account.reset' });
    expect(h.showToast).not.toHaveBeenCalled();
  });
});
