// BR-4 (ревью 25.10): `useEmptyDeviceDetection` на КАЖДОМ `note.saved` звал
// `check()`, а тот читал облако постранично (`DocumentService.getUserDocuments`
// — все заметки с расшифровкой) и никогда не останавливался. Плюс счётчики
// оставались от прежнего аккаунта, а локальный счётчик ставился только после
// облачного чтения — при сбое облака баннер висел с `localCount = 0`.
//
// Ожидание AG-RESTORE-1 сохранено: проверка при заходе читает оба списка, и
// «1 локальная против 3 облачных» по-прежнему спрашивает про восстановление.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

let uid = 'u_br4';
vi.mock('../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({ user: { uid }, isGuest: false }),
}));
vi.mock('../../crypto/encrypt', () => ({ isVaultUnlocked: () => true }));
vi.mock('../../crypto/cryptoHelpers', () => ({ getEncryptionEnabled: () => false }));

const mockLocal = vi.fn();
const mockCloud = vi.fn();
vi.mock('../../services/LocalStorageService', () => ({
  LocalStorageService: { getDocumentsByOwner: (...a: unknown[]) => mockLocal(...a) },
}));
vi.mock('../../services/DocumentService', () => ({
  DocumentService: { getUserDocuments: (...a: unknown[]) => mockCloud(...a) },
}));

import { useEmptyDeviceDetection, getRestoreDismissedKey } from '../useEmptyDeviceDetection';
import { emitDomainEvent } from '../../events/domainEvents';

function docs(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `doc_${i}` }));
}

beforeEach(() => {
  vi.clearAllMocks();
  uid = 'u_br4';
  localStorage.removeItem(getRestoreDismissedKey('u_br4'));
  localStorage.removeItem(getRestoreDismissedKey('u_br4_other'));
  mockLocal.mockResolvedValue(docs(1));
  mockCloud.mockResolvedValue(docs(3));
});

describe('BR-4: перечитка облака только пока на устройстве пусто', () => {
  it('заход: читаются оба списка — вопрос восстановления в силе (AG-RESTORE-1)', async () => {
    const { result } = renderHook(() => useEmptyDeviceDetection());
    await waitFor(() => expect(result.current.shouldPrompt).toBe(true));
    expect(mockLocal).toHaveBeenCalledTimes(1);
    expect(mockCloud).toHaveBeenCalledTimes(1);
  });

  it('локальные записи есть — `note.saved` облако не перечитывает', async () => {
    const { result } = renderHook(() => useEmptyDeviceDetection());
    await waitFor(() => expect(result.current.cloudCount).toBe(3));

    mockLocal.mockResolvedValue(docs(2));
    act(() => { emitDomainEvent({ type: 'note.saved', userId: uid }); });

    await waitFor(() => expect(result.current.localCount).toBe(2));
    expect(mockCloud, 'облако больше не читается').toHaveBeenCalledTimes(1);
  });

  it('сохранение другого аккаунта не запускает проверку вовсе', async () => {
    const { result } = renderHook(() => useEmptyDeviceDetection());
    await waitFor(() => expect(result.current.cloudCount).toBe(3));
    const localCalls = mockLocal.mock.calls.length;

    act(() => { emitDomainEvent({ type: 'note.saved', userId: 'u_br4_other' }); });
    // Дать микротask-ам проверки пройти: иначе утверждение пустое — счётчик
    // вызовов ещё не успел измениться.
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });

    expect(mockLocal).toHaveBeenCalledTimes(localCalls);
    expect(mockCloud).toHaveBeenCalledTimes(1);
    expect(result.current.localCount).toBe(1);
  });

  it('пока на устройстве пусто — `note.saved` перечитывает облако (баннер живёт по счётчику)', async () => {
    mockLocal.mockResolvedValueOnce([]).mockResolvedValueOnce(docs(1));
    const { result } = renderHook(() => useEmptyDeviceDetection());
    await waitFor(() => expect(result.current.showCloudBanner).toBe(true));

    act(() => { emitDomainEvent({ type: 'note.saved', userId: uid }); });

    await waitFor(() => expect(result.current.showCloudBanner).toBe(false));
    expect(result.current.localCount).toBe(1);
  });

  it('сбой облака не оставляет `localCount` нулевым', async () => {
    mockCloud.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useEmptyDeviceDetection());

    await waitFor(() => expect(result.current.localCount).toBe(1));
    expect(result.current.showCloudBanner, 'без облачного числа баннера нет').toBe(false);
  });

  it('смена владельца сбрасывает счётчики — `cloudCount` прошлого аккаунта не остаётся', async () => {
    const { result, rerender } = renderHook(() => useEmptyDeviceDetection());
    await waitFor(() => expect(result.current.cloudCount).toBe(3));

    // Новый аккаунт: чтения ещё не вернулись (висят на промисе) — а числа
    // прошлого уже не должны висеть на экране.
    uid = 'u_br4_other';
    mockLocal.mockReturnValue(new Promise(() => {}));
    mockCloud.mockReturnValue(new Promise(() => {}));
    rerender();

    await waitFor(() => {
      expect(result.current.cloudCount).toBe(0);
      expect(result.current.localCount).toBe(0);
    });
  });

  // Самопроверка 25.10: смена владельца — это ещё и гонка двух проверок.
  it('поздний ответ прежнего владельца не перекрывает числа нового', async () => {
    let releaseFirst: ((v: unknown[]) => void) | null = null;
    mockCloud.mockImplementationOnce(() => new Promise<unknown[]>(res => { releaseFirst = res; }));

    const { result, rerender } = renderHook(() => useEmptyDeviceDetection());
    await waitFor(() => expect(result.current.localCount).toBe(1));

    // Пока облако первого висит, человек переключается: локальное и облачное
    // чтения нового отвечают сразу.
    uid = 'u_br4_other';
    mockLocal.mockResolvedValue(docs(4));
    mockCloud.mockResolvedValueOnce(docs(2));
    rerender();
    await waitFor(() => expect(result.current.cloudCount).toBe(2));

    // Поздний ответ первого не смеет ни показать чужое, ни стереть своё.
    (releaseFirst as unknown as (v: unknown[]) => void)(docs(9));
    await new Promise(r => setTimeout(r, 20));

    expect(result.current.cloudCount, 'поздний ответ стёр числа нового аккаунта').toBe(2);
    expect(result.current.localCount).toBe(4);
    expect(result.current.showCloudBanner, 'поздний ответ поднял баннер чужого аккаунта').toBe(false);
  });
});

describe('Ревью 26.10: копия баннера не читает облако, когда записи на устройстве есть', () => {
  it('баннер монтируется заново при локальных записях — облако не читается ни разу', async () => {
    for (let i = 0; i < 3; i++) {
      const { result, unmount } = renderHook(() => useEmptyDeviceDetection({ cloudOnlyWhenEmpty: true }));
      await waitFor(() => expect(result.current.localCount).toBe(1));
      expect(result.current.showCloudBanner).toBe(false);
      unmount();
    }
    expect(mockCloud).not.toHaveBeenCalled();
  });

  it('контроль: на пустом устройстве баннер читает облако и показывается', async () => {
    mockLocal.mockResolvedValue([]);
    const { result } = renderHook(() => useEmptyDeviceDetection({ cloudOnlyWhenEmpty: true }));
    await waitFor(() => expect(result.current.showCloudBanner).toBe(true));
    expect(result.current.cloudCount).toBe(3);
  });
});
