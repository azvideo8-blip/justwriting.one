// DW5-3.1 (находка ревью кода 0.11.5): неудачное спасение крутится само.
//
// A→B в этой же вкладке, запись A в базу отказывает постоянно. Обычная смена
// аккаунта перезагружает страницу (`supabaseAuthProvider.ts:185`), так что путь
// запасной, но он существует: спасение очищает редактор ДО записи, при отказе
// возвращает текст A на экран и назначает владельцем экрана A, следующая попытка
// автосохранения видит чужого владельца и зовёт спасение ЗАНОВО — с `clear()`.
// На круг (0,5–1 с) текст A исчезает и возвращается, два отчёта об ошибке, и
// набранное поверх стирается без записи.
//
// Правка: повтор спасения не снимает чужой редактор повторно — снимок, который
// уже ждёт своей доставки, принадлежит пути повтора (`retryRescuePayloads`),
// и тот ходит с паузой.
import 'fake-indexeddb/auto';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppUser } from '../../../../core/auth/types';
import type { LocalDraft } from '../../../../core/storage/localDb';
import { emitDomainEvent } from '../../../../core/events/domainEvents';
import { useContentStore } from '../../store/useContentStore';
import { loadDraftIntoStore } from '../../store/storeActions';
import { useSessionMetaStore } from '../../store/useSessionMetaStore';
import { useTimerStore } from '../../store/useTimerStore';
import { useEncryptionStore } from '../../../../core/crypto/useEncryptionStore';
import {
  clearAllRescuePayloads,
  clearEditorTextOwner,
  getEditorTextOwner,
  markEditorTextOwner,
  pendingRescuePayloads,
  rememberRescuePayload,
} from '../../services/draftWriter';
import { useDraftAutosave } from '../useDraftAutosave';
import { persistDraft } from '../../utils/draftPersistence';
import { reportError } from '../../../../shared/errors/reportError';

vi.mock('../../utils/draftPersistence', () => ({
  buildLocalDraft: vi.fn((user: AppUser, current: { content: string; title: string }, epoch?: number) => ({
    userId: user.uid, ...current, ...(epoch !== undefined ? { epoch } : {}),
  })),
  persistDraft: vi.fn(),
}));
vi.mock('../../../../core/auth/accountReload', () => ({
  onBeforeAccountReload: () => () => {},
  isAccountReloadPending: () => false,
}));
vi.mock('../../../../shared/hooks/useLayoutMode', () => ({ useLayoutMode: () => ({ layoutMode: 'mobile' }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const A = 'u_dw53loop_A';
const B = 'u_dw53loop_B';
const userA = { uid: A } as AppUser;
const userB = { uid: B } as AppUser;
const A_TEXT = 'DW53 текст прежнего владельца A';
const B_WORDS = 'DW53 слова нового владельца B';

const dataOf = (content: string) => ({
  title: '',
  content,
  pinnedThoughts: [] as string[],
  seconds: 5,
  wpm: 12,
  wordCount: content.split(/\s+/).length,
  initialWordCount: 0,
  sessionStartTime: undefined,
  activeSessionId: null,
  status: 'writing' as const,
});

const writeAttemptsFor = (uid: string): number =>
  vi.mocked(persistDraft).mock.calls
    .filter(call => (call[0] as { userId?: string }).userId === uid).length;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  clearAllRescuePayloads();
  clearEditorTextOwner();
  useEncryptionStore.setState({ encryptionEnabled: {} });
  useSessionMetaStore.getState().resetSessionMetadata();
  useTimerStore.setState({ status: 'writing' });
  useContentStore.setState({ content: A_TEXT, title: '', wordCount: 5, tags: [], labelId: undefined, ownerUid: A });
  // Запись строки отказывает всегда — этот тест про повтор, а не про записанный текст.
  vi.mocked(persistDraft).mockResolvedValue({ localOk: false, remoteOk: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DW5-3.1: отказавшее спасение не гоняет редактор по кругу', () => {
  // Ревью 0.11.6: возвращённый текст сам по себе — правка для отсрочки. Пока снимок
  // ждёт доставки, редактор не очищается: это мигание и отчёт об ошибке на каждый круг.
  it('B не печатает: возвращённый текст не очищается по кругу, снимок доносит повтор', async () => {
    markEditorTextOwner(A);
    // Как в приложении: текст хук получает из стора, очистка и возврат — две правки.
    const { rerender } = renderHook(
      ({ user }: { user: AppUser }) => useDraftAutosave(user, dataOf(useContentStore(s => s.content))),
      { initialProps: { user: userA } },
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(1_200); });
    rerender({ user: userB });
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    expect(useContentStore.getState().content).toBe(A_TEXT);

    let clears = 0;
    const unsubscribe = useContentStore.subscribe(state => { if (state.content === '') clears++; });
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    unsubscribe();

    expect(clears, 'редактор очищался по кругу').toBe(0);
    expect(useContentStore.getState().content).toBe(A_TEXT);
    expect(writeAttemptsFor(B), 'текст A не пишется как текст B').toBe(0);
  });

  it('снимок дошёл повтором — экран нового владельца освобождается', async () => {
    markEditorTextOwner(A);
    const { rerender } = renderHook(
      ({ user }: { user: AppUser }) => useDraftAutosave(user, dataOf(useContentStore(s => s.content))),
      { initialProps: { user: userA } },
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(1_200); });
    rerender({ user: userB });
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    expect(useContentStore.getState().content).toBe(A_TEXT);

    vi.mocked(persistDraft).mockResolvedValue({ localOk: true, localSkipped: false, remoteOk: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(31_000); });

    expect(useContentStore.getState().content, 'текст A остался на экране B').toBe('');
  });

  it('три секунды таймеров — не больше двух попыток записи A, слова B на экране', async () => {
    markEditorTextOwner(A);
    const { rerender } = renderHook(
      ({ user, data }: { user: AppUser; data: ReturnType<typeof dataOf> }) => useDraftAutosave(user, data),
      { initialProps: { user: userA, data: dataOf(A_TEXT) } },
    );
    // A: отсрочка сработала и упёрлась в отказ.
    await act(async () => { await vi.advanceTimersByTimeAsync(1_200); });

    // Смена аккаунта в этой же вкладке — спасение A, оно отказывает.
    rerender({ user: userB, data: dataOf(A_TEXT) });
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });

    // Новый владелец печатает поверх возвращённого текста.
    useContentStore.getState().setContent(B_WORDS);
    rerender({ user: userB, data: dataOf(B_WORDS) });
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });

    expect(useContentStore.getState().content, 'повторное спасение стёрло набранное B').toContain('B');
    // Потолок: своя запись A до смены, одно спасение и одна доставка снимка.
    // Дальше повтор не повторяется: возврат текста на экран больше не правка, и
    // редактор после набора B не меняется.
    expect(writeAttemptsFor(A), 'отказанное спасение повторяется на каждый тик отсрочки')
      .toBeLessThanOrEqual(3);
    const rescueReports = vi.mocked(reportError).mock.calls.filter(
      call => String(call[0]).includes('DRAFT_RESCUE_FAILED'),
    );
    expect(rescueReports.length, 'один и тот же отказ рапортуется на каждый круг').toBeLessThanOrEqual(2);
  });
});

describe('DW5-3.4: снимки спасения и зеркало владельца — общие мелочи находки', () => {
  it('выход «стереть всё с этого компьютера» снимает и ждущие снимки спасения', () => {
    rememberRescuePayload(A, { userId: A, content: A_TEXT, title: '', seconds: 0, wpm: 0, wordCount: 1, updatedAt: 1 } as LocalDraft);
    expect(pendingRescuePayloads(), 'снимок не поставлен').toHaveLength(1);

    emitDomainEvent({ type: 'account.reset', userId: A });

    expect(pendingRescuePayloads(), 'снимок пережил стирание аккаунта').toHaveLength(0);
  });

  it('подстановка текста в редактор называет владельца и в зеркале, а не только в сторе', () => {
    loadDraftIntoStore({ content: A_TEXT, title: '', wordCount: 5 }, A);

    expect(useContentStore.getState().ownerUid, 'стор не знает владельца').toBe(A);
    expect(getEditorTextOwner(), 'зеркало редактора осталось пустым (I6)').toBe(A);
  });
});
