// VIS T1 (утверждено владельцем 04.11, строки 1 и 2 карты): снимок прежнего
// входа не записан на устройство — человек обязан это видеть. Сейчас отказ
// спасения пишет только в журнал (`useDraftAutosave.ts:210`), а повтор
// (`retryRescuePayloads`, `:253-271`) не пишет никуда: с сейфом открытой копии
// нет (SEC-56), снимок живёт в памяти, и закрытие вкладки теряет текст.
//
// Отказ настоящий: база A отказывает по-настоящему (образец
// draftRescueTail.dw64.test.ts), запись идёт настоящим мутатором.
//
// Мутация: убрать `syncRescueAlert()` из `finally` спасения — кейсы 1 и 2
// красные; убрать его же из повтора — кейс 3 красный (флаг не снимается).
import 'fake-indexeddb/auto';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppUser } from '../../../../core/auth/types';
import { resetDbInstance, type LocalDraft } from '../../../../core/storage/localDb';
import { useContentStore } from '../../store/useContentStore';
import { useSessionMetaStore } from '../../store/useSessionMetaStore';
import { useTimerStore } from '../../store/useTimerStore';
import { useEncryptionStore } from '../../../../core/crypto/useEncryptionStore';
import { useDraftWriteAlertStore } from '../../store/useDraftWriteAlertStore';
import {
  applySave,
  clearAllRescuePayloads,
  clearEditorTextOwner,
  markEditorTextOwner,
  pendingRescuePayloads,
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

const A_TEXT = 'VIS текст прежнего входа A';
const B_TAIL = 'слова которые дописал B';
const MIXED = `${A_TEXT} ${B_TAIL}`;

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
  await settle(800);
};

async function row(uid: string): Promise<LocalDraft | undefined> {
  const db = await (await import('../../../../core/storage/localDb')).getLocalDb(uid);
  return await db.get('drafts', uid) as LocalDraft | undefined;
}

/** Экран после неудачного спасения: текст A стоит, владелец экрана — A.
 *  Снимок запомнит само спасение — здесь только то, что видит человек. */
function leaveAfterFailedRescue(A: string) {
  useContentStore.setState({ content: A_TEXT, title: '', wordCount: 5, ownerUid: A });
  markEditorTextOwner(A);
}

const alert = () => useDraftWriteAlertStore.getState().rescueNotWritten;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetDbInstance();
  clearAllRescuePayloads();
  clearEditorTextOwner();
  useDraftWriteAlertStore.setState({ rescueNotWritten: false, localWriteStuck: false });
  useEncryptionStore.setState({ encryptionEnabled: {} });
  useSessionMetaStore.getState().resetSessionMetadata();
  useTimerStore.setState({ status: 'writing' });
});

afterEach(() => {
  fail.uid = '';
  clearAllRescuePayloads();
  useDraftWriteAlertStore.setState({ rescueNotWritten: false, localWriteStuck: false });
});

describe('VIS T1: снимок прежнего входа не записан — видно на экране', () => {
  it('база прежнего входа отказала: состояние поднято сразу', async () => {
    const A = 'u_vis_t1_A1'; const B = 'u_vis_t1_B1';
    fail.uid = A;
    leaveAfterFailedRescue(A);

    const { rerender, unmount } = renderHook(({ d }) => useDraftAutosave({ uid: B } as AppUser, d), { initialProps: { d: data(A_TEXT) } });
    await settle(400);

    expect(pendingRescuePayloads().some(r => r.userId === A), 'снимок A не остался ждать доставки').toBe(true);
    expect(alert(), 'отказ спасения не виден').toBe(true);
    await type(rerender, MIXED);
    expect(alert(), 'повтор попытки снял состояние').toBe(true);
    unmount();
  });

  it('повтор не удваивает и не гасит: три попытки — одно состояние', async () => {
    const A = 'u_vis_t1_A2'; const B = 'u_vis_t1_B2';
    fail.uid = A;
    leaveAfterFailedRescue(A);

    const { rerender, unmount } = renderHook(({ d }) => useDraftAutosave({ uid: B } as AppUser, d), { initialProps: { d: data(A_TEXT) } });
    await settle(400);
    expect(alert()).toBe(true);

    for (const content of [`${MIXED} раз`, `${MIXED} два`, `${MIXED} три`]) {
      await type(rerender, content);
      expect(alert(), 'состояние мигает на каждой попытке').toBe(true);
    }
    expect(pendingRescuePayloads().filter(r => r.userId === A).length, 'снимков A больше одного').toBe(1);
    unmount();
  });

  it('принятая запись снимает состояние', async () => {
    const A = 'u_vis_t1_A3'; const B = 'u_vis_t1_B3';
    fail.uid = A;
    leaveAfterFailedRescue(A);

    const { rerender, unmount } = renderHook(({ d }) => useDraftAutosave({ uid: B } as AppUser, d), { initialProps: { d: data(A_TEXT) } });
    await settle(400);
    await type(rerender, MIXED);
    expect(alert(), 'состояние не поднялось').toBe(true);

    // База A снова отвечает: ближайшая же попытка автосохранения доносит снимок.
    fail.uid = '';
    await type(rerender, `${B_TAIL} продолжение`);
    await settle(400);

    expect(pendingRescuePayloads().some(r => r.userId === A), 'снимок не доставлен').toBe(false);
    expect((await row(A))?.content, 'текст A не записан в базу A').toBe(A_TEXT);
    expect(alert(), 'принятая запись не сняла состояние').toBe(false);
    unmount();
  });

  it('контроль: закрытый черновик прежнего входа не шумит', async () => {
    const A = 'u_vis_t1_A4'; const B = 'u_vis_t1_B4';
    // База A по-прежнему отказывает: снимок снимает с очереди ТОЛЬКО закрытие
    // (мутация: убрать `isDraftClosed` из повтора — кейс красный).
    fail.uid = A;
    rememberRescuePayload(A, { userId: A, owner: A, content: A_TEXT, title: '', wordCount: 5, epoch: 0 } as unknown as LocalDraft);
    // Сохранение заметки принято: тексту некуда возвращаться (храповик DW-10-F-1).
    applySave(A);

    const { rerender, unmount } = renderHook(({ d }) => useDraftAutosave({ uid: B } as AppUser, d), { initialProps: { d: data('') } });
    await settle(300);
    await type(rerender, 'свой текст под своим аккаунтом');
    await settle(300);

    expect(alert(), 'закрытый черновик зашумел').toBe(false);
    expect(pendingRescuePayloads().some(r => r.userId === A), 'закрытый снимок не снят с очереди').toBe(false);
    expect((await row(B))?.content, 'своя запись не прошла').toBe('свой текст под своим аккаунтом');
    unmount();
  });

  it('контроль: нет ждущего снимка — нет сообщения', async () => {
    const B = 'u_vis_t1_B5';
    const { rerender, unmount } = renderHook(({ d }) => useDraftAutosave({ uid: B } as AppUser, d), { initialProps: { d: data('') } });
    await settle(300);
    await type(rerender, 'обычный текст под своим аккаунтом');

    expect(alert(), 'сообщение поднялось без ждущего снимка').toBe(false);
    expect((await row(B))?.content, 'своя запись не прошла').toBe('обычный текст под своим аккаунтом');
    unmount();
  });

  it('I3: в состоянии нет ни текста, ни адреса прежнего аккаунта', async () => {
    const A = 'u_vis_t1_A6'; const B = 'u_vis_t1_B6';
    fail.uid = A;
    leaveAfterFailedRescue(A);

    const { unmount } = renderHook(({ d }) => useDraftAutosave({ uid: B } as AppUser, d), { initialProps: { d: data(A_TEXT) } });
    await settle(400);
    expect(alert()).toBe(true);

    const dumped = JSON.stringify(useDraftWriteAlertStore.getState());
    expect(dumped, 'в показе текст прежнего аккаунта').not.toContain(A_TEXT);
    expect(dumped, 'в показе адрес прежнего аккаунта').not.toContain(A);
    unmount();
  });
});
