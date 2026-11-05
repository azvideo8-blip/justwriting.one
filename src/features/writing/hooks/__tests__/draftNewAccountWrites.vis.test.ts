// VIS, проверка владельца 04.11 (тикет, строка 42): «Сначала проверь тестом,
// остаётся ли после DW6-4 состояние "новый аккаунт печатает, запись не идёт"».
//
// Состояние из строки 5 карты: зеркало редактора держит прежний аккаунт A
// (`markEditorTextOwner`), снимок A ждёт доставки, и писатели B отказывают —
// `ownsText` (`useDraftAutosave.ts:226-243`) возвращает «нет», `doAutosaveLocal`
// отдаёт `SKIPPED`, статус остаётся `idle`.
//
// Отказ настоящий: база A отказывает по-настоящему, запись идёт настоящим
// мутатором (образец draftRescueTail.dw64.test.ts).
import 'fake-indexeddb/auto';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppUser } from '../../../../core/auth/types';
import { resetDbInstance, type LocalDraft } from '../../../../core/storage/localDb';
import { useContentStore } from '../../store/useContentStore';
import { useSessionMetaStore } from '../../store/useSessionMetaStore';
import { useTimerStore } from '../../store/useTimerStore';
import { useEncryptionStore } from '../../../../core/crypto/useEncryptionStore';
import {
  clearAllRescuePayloads,
  clearEditorTextOwner,
  markEditorTextOwner,
  rememberRescuePayload,
} from '../../services/draftWriter';
import { useDraftAutosave } from '../useDraftAutosave';

const fail = vi.hoisted(() => ({ uid: '' }));
vi.mock('../../../../core/storage/localDb', async (importActual) => {
  const actual = await importActual<typeof import('../../../../core/storage/localDb')>();
  return {
    ...actual,
    getLocalDb: vi.fn(async (uid?: string | null) => {
      const db = await actual.getLocalDb(uid ?? undefined);
      if (!fail.uid || uid !== fail.uid) return db;
      return {
        objectStoreNames: db.objectStoreNames,
        get: vi.fn(async () => { throw new Error('IDB отказала'); }),
        put: vi.fn(async () => { throw new Error('IDB отказала'); }),
        delete: vi.fn(async () => { throw new Error('IDB отказала'); }),
        transaction: vi.fn(() => { throw new Error('IDB отказала'); }),
        done: Promise.resolve(),
      } as unknown as typeof db;
    }),
  };
});

vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => false }));
vi.mock('../../../../core/auth/accountReload', () => ({
  onBeforeAccountReload: () => () => {},
  isAccountReloadPending: () => false,
}));
vi.mock('../../../../shared/hooks/useLayoutMode', () => ({ useLayoutMode: () => ({ layoutMode: 'desktop' }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => false,
  maybeEncrypt: async (d: Record<string, unknown>) => d,
  maybeDecrypt: async (d: Record<string, unknown>) => d,
  isProfileLoaded: () => true,
}));

const A_TEXT = 'текст прежнего входа A';

const data = (content: string) => ({
  title: '',
  content,
  pinnedThoughts: [] as string[],
  seconds: 5,
  wpm: 12,
  wordCount: content.trim() ? content.trim().split(/\s+/).length : 0,
  initialWordCount: 0,
  sessionStartTime: undefined,
  activeSessionId: null,
  status: 'writing' as const,
});

const settle = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)); });

const type = async (rerender: (props: { d: ReturnType<typeof data> }) => void, content: string) => {
  await act(async () => {
    useContentStore.getState().setContent(content);
    rerender({ d: data(content) });
  });
  await settle(900);
};

async function row(uid: string): Promise<LocalDraft | undefined> {
  const db = await (await import('../../../../core/storage/localDb')).getLocalDb(uid);
  return await db.get('drafts', uid) as LocalDraft | undefined;
}

/** Стоячее состояние неудачного спасения: текст A на экране, снимок A ждёт, зеркало — A. */
function afterFailedRescue(A: string) {
  rememberRescuePayload(A, { userId: A, owner: A, content: A_TEXT, title: '', wordCount: 4, epoch: 0 } as unknown as LocalDraft);
  useContentStore.setState({ content: A_TEXT, title: '', wordCount: 4, ownerUid: A });
  markEditorTextOwner(A);
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetDbInstance();
  clearAllRescuePayloads();
  clearEditorTextOwner();
  useEncryptionStore.setState({ encryptionEnabled: {} });
  useSessionMetaStore.getState().resetSessionMetadata();
  useTimerStore.setState({ status: 'writing' });
});

afterEach(() => {
  fail.uid = '';
  clearAllRescuePayloads();
  clearEditorTextOwner();
});

describe('VIS проверка: печатает новый аккаунт, пока снимок прежнего не доставлен', () => {
  it('P1: B дописывает в конец — его слова записываются ему', async () => {
    const A = 'u_vis_p1_A'; const B = 'u_vis_p1_B';
    fail.uid = A;
    afterFailedRescue(A);

    const { rerender, unmount } = renderHook(
      ({ d }) => useDraftAutosave({ uid: B } as AppUser, d),
      { initialProps: { d: data(A_TEXT) } },
    );
    await settle(300);
    await type(rerender, `${A_TEXT} и слова B`);
    await settle(400);

    expect((await row(B))?.content, 'слова B не записаны в базу B').toContain('слова B');
    fail.uid = '';
    expect((await row(A))?.content ?? '', 'слова B ушли в базу A').not.toContain('слова B');
    unmount();
  });

  // Н-1 (отчёт VIS-B): состояние «новый аккаунт печатает, запись не идёт» после
  // DW6-4 ОСТАЁТСЯ, когда напечатанное B не начинается со снимка A (B стёр чужой
  // текст и печатает свой). Измерено 04.11 при отказывающей базе A:
  //   {"screen":"совершенно другой текст B продолжение","mirror":"u_vis_p2_A",
  //    "pending":["u_vis_p2_A"],"saveStatus":"idle"}
  // строки B нет ни в одном адресе, статус `idle`, человек не видит ничего, кроме
  // баннера T1 (он поднят, потому что снимок A ждёт). Механизм:
  //   `draftOwnerGuard.ts:60-64` — печать не переводит зеркало на B, пока оно
  //     называет другой аккаунт;
  //   `useDraftAutosave.ts:257-269` — `ownsText` возвращает «нет» и зовёт спасение;
  //   `useDraftAutosave.ts:170` — спасение выходит сразу: буфер больше не
  //     начинается со снимка, а повтор (`retryRescuePayloads`) ждёт ответа базы A;
  //   `useDraftAutosave.ts:329` + `useDraftCore.ts:174` — писатель отдаёт
  //     `SKIPPED`, статус становится `idle`.
  //
  // Заметка ревьюера 04.11 21:55, п.1: у Н-1 было продолжение, и оно закрыто в
  // БАЗЕ коммитом `175e329e` (слит в vis-1): когда база A оживала, повтор
  // доставлял снимок, а зеркало всё ещё называло A — слова B уходили в адрес A
  // (I3) и стирались с экрана (I1). Теперь `handOverEditorAfterDelivery`
  // (useDraftAutosave.ts:43-54) передаёт редактор печатающему. Остаётся только
  // состояние ПОКА база A отказывает: текст B только на экране, под баннером T1,
  // и правило записи не меняем (§5, «Не делать»).
  // Тест не пишется: правило записи VIS менять не вправе, а закреплять нынешний
  // исход как верный нельзя (урок приёмки DW-6).
  it.todo('P2: B стирает чужой текст и печатает свой — его слова записываются ему (Н-1)');
});
