// DW6-4 (остаток приёмки шага 5, §4.3 строка 6): `rescueForPreviousOwner`
// пропускает повтор спасения, если на экране снимок прежнего владельца ИЛИ его
// «продолжение» (`typed.startsWith(held)`), а потом делает `clear()`. Если база A
// отказывает постоянно, текст A возвращается на экран, B дописывает свои слова, и
// следующее спасение стирает хвост B, нигде его не записав. При снимке только с
// заголовком (`held === ''`) под это подходит ЛЮБОЙ текст.
//
// Правило одно: набранное не стирается, не будучи где-то записано (I1), и текст A
// не попадает в адреса B (I3). Хвост после снимка — слова того, кто печатает.
//
// Мутация: вернуть прежний guard (`typed.startsWith(held)` без выделения хвоста) →
// кейсы 1 и 2 красные.
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
  pendingRescuePayloads,
  rememberRescuePayload,
} from '../../services/draftWriter';
import { useDraftAutosave } from '../useDraftAutosave';

// База A отказывает постоянно — тот «запасной путь + постоянный сбой IndexedDB»,
// в котором живёт остаток. База B работает по-настоящему.
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

// Свои пары uid на кейс: fake-indexeddb переживает `resetDbInstance`, и общий
// ключ черновика переносил строку из теста в тест.
const A = 'u_dw64_A1';
const B = 'u_dw64_B1';
const userB = { uid: B } as AppUser;
const A_TEXT = 'DW64 текст прежнего владельца A';
const B_TAIL = 'хвост который дописал B';
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

/** Так же, как это делает редактор: текст меняется в сторе, и те же props
 *  приходят в хук. Расхождение стора и props — не продукт, а тест. */
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

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  resetDbInstance();
  clearAllRescuePayloads();
  clearEditorTextOwner();
  useEncryptionStore.setState({ encryptionEnabled: {} });
  useSessionMetaStore.getState().resetSessionMetadata();
  useTimerStore.setState({ status: 'writing' });
  fail.uid = A;
});

afterEach(() => {
  fail.uid = '';
});

describe('DW6-4: хвост нового владельца не стирается спасением', () => {
  it('B дописал поверх возвращённого текста A: хвост остаётся на экране и записан в адреса B', async () => {
    // Состояние после неудачного спасения: снимок A ждёт доставки, его текст на
    // экране, владелец экрана — A.
    rememberRescuePayload(A, { userId: A, owner: A, content: A_TEXT, title: '', wordCount: 5 } as unknown as LocalDraft);
    useContentStore.setState({ content: A_TEXT, title: '', wordCount: 5, ownerUid: A });
    // Так оставляет экран неудачное спасение: текст A на экране, владелец — A.
    markEditorTextOwner(A);

    const { rerender, unmount } = renderHook(({ d }) => useDraftAutosave(userB, d), { initialProps: { d: data(A_TEXT) } });
    // Ждаем, пока первое спасение (по смене аккаунта) закончит отказываться:
    // повтор во время его работы отменяется `rescuingRef`.
    await settle(400);
    expect(useContentStore.getState().content, 'текст A не вернулся на экран').toBe(A_TEXT);

    await type(rerender, MIXED);
    expect(useContentStore.getState().content, 'слова B стёрты спасением без записи').toBe(B_TAIL);
    const bRow = await row(B);
    expect(bRow?.content, 'хвост B не записан в базу B').toBe(B_TAIL);
    expect(bRow?.content ?? '', 'текст A уехал в базу B (I3)').not.toContain(A_TEXT);
    expect(pendingRescuePayloads().some(r => r.userId === A), 'снимок A потерян без доставки').toBe(true);
    unmount();
  });

  it('ревьюер 04.11: заголовок и закрепления A не уходят в строку B вместе с хвостом (I3)', async () => {
    const A4 = 'u_dw64_A4'; const B4 = 'u_dw64_B4'; fail.uid = A4;
    const userB4 = { uid: B4 } as AppUser;
    const withA = (content: string) => ({ ...data(content), title: 'ЗАГОЛОВОК_A_DW6R', pinnedThoughts: ['МЫСЛЬ_A_DW6R'], activeSessionId: 'сессия-A' });
    rememberRescuePayload(A4, { userId: A4, owner: A4, content: A_TEXT, title: 'ЗАГОЛОВОК_A_DW6R', wordCount: 5 } as unknown as LocalDraft);
    useContentStore.setState({ content: A_TEXT, title: 'ЗАГОЛОВОК_A_DW6R', wordCount: 5, ownerUid: A4 });
    markEditorTextOwner(A4);

    const { rerender, unmount } = renderHook(({ d }) => useDraftAutosave(userB4, d), { initialProps: { d: withA(A_TEXT) } });
    await settle(400);
    await act(async () => {
      useContentStore.getState().setContent(MIXED);
      rerender({ d: withA(MIXED) });
    });
    await settle(800);

    const bRow = await row(B4);
    expect(bRow?.content).toBe(B_TAIL);
    expect(bRow?.title ?? '', 'заголовок A уехал в базу B').not.toContain('ЗАГОЛОВОК_A_DW6R');
    expect(JSON.stringify(bRow?.pinnedThoughts ?? []), 'закрепление A уехало в базу B').not.toContain('МЫСЛЬ_A_DW6R');
    expect(bRow?.activeSessionId ?? null, 'сессия A уехала в базу B').toBeNull();
    unmount();
  });

  // Ревьюер 04.11: снимок доставлен повтором, а зеркало всё ещё называет A. Следующая
  // попытка считала весь буфер текстом A: слова B уходили в адрес A и стирались с экрана.
  const untilDelivered = async (uidA: string, uidB: string, first: string) => {
    fail.uid = uidA;
    rememberRescuePayload(uidA, { userId: uidA, owner: uidA, content: A_TEXT, title: 'ЗАГОЛОВОК_A_R', wordCount: 5 } as unknown as LocalDraft);
    useContentStore.setState({ content: A_TEXT, title: 'ЗАГОЛОВОК_A_R', wordCount: 5, ownerUid: uidA });
    markEditorTextOwner(uidA);
    const hook = renderHook(({ d }) => useDraftAutosave({ uid: uidB } as AppUser, d), { initialProps: { d: { ...data(A_TEXT), title: 'ЗАГОЛОВОК_A_R' } } });
    await settle(400);
    const put = async (text: string) => {
      await act(async () => {
        useContentStore.getState().setContent(text);
        hook.rerender({ d: { ...data(text), title: useContentStore.getState().title } });
      });
      await settle(800);
    };
    await put(first);
    fail.uid = '';
    return { put, unmount: hook.unmount };
  };

  it('B стёр текст A и печатает своё, база A ожила: слова B у B, снимок A у A', async () => {
    const a = 'u_dw64_A5'; const b = 'u_dw64_B5';
    const { put, unmount } = await untilDelivered(a, b, 'свои слова B');
    await put('свои слова B дальше');
    await put('свои слова B ещё дальше');
    const aRow = await row(a);
    expect(aRow?.content, 'снимок A не доставлен').toBe(A_TEXT);
    expect(useContentStore.getState().content, 'слова B стёрты с экрана').toBe('свои слова B ещё дальше');
    const bRow = await row(b);
    expect(bRow?.content, 'слова B не записаны в адрес B').toBe('свои слова B ещё дальше');
    expect(bRow?.title ?? '', 'заголовок A уехал в адрес B').not.toContain('ЗАГОЛОВОК_A_R');
    expect(pendingRescuePayloads().some(r => r.userId === a)).toBe(false);
    unmount();
  });

  it('снимок только с заголовком: любой набранный текст остаётся и записывается', async () => {
    const A2 = 'u_dw64_A2'; const B2 = 'u_dw64_B2'; fail.uid = A2;
    const userB2 = { uid: B2 } as AppUser;
    rememberRescuePayload(A2, { userId: A2, owner: A2, content: '', title: 'Заголовок A', wordCount: 0 } as unknown as LocalDraft);
    useContentStore.setState({ content: '', title: '', wordCount: 0, ownerUid: B2 });
    markEditorTextOwner(B2);

    const { rerender, unmount } = renderHook(({ d }) => useDraftAutosave(userB2, d), { initialProps: { d: data('') } });
    await settle(400);
    await type(rerender, B_TAIL);

    expect(useContentStore.getState().content, 'текст B стёрт спасением чужого снимка').toBe(B_TAIL);
    expect((await row(B2))?.content).toBe(B_TAIL);
    unmount();
  });

  // Зелёный контроль I3: текст A не имеет права оказаться в адресах B ни в одном
  // из двух кейсов выше — проверяем прямо здесь, что база B чиста от A.
  it('база B не содержит слов прежнего владельца', async () => {
    const A3 = 'u_dw64_A3'; const B3 = 'u_dw64_B3'; fail.uid = A3;
    const userB3 = { uid: B3 } as AppUser;
    rememberRescuePayload(A3, { userId: A3, owner: A3, content: A_TEXT, title: '', wordCount: 5 } as unknown as LocalDraft);
    useContentStore.setState({ content: A_TEXT, title: '', wordCount: 5, ownerUid: A });

    const { rerender, unmount } = renderHook(({ d }) => useDraftAutosave(userB3, d), { initialProps: { d: data(A_TEXT) } });
    await settle(400);
    await type(rerender, MIXED);
    const bRow = await row(B3);
    expect(bRow?.content ?? '', 'смешанный буфер уехал в базу B (I3)').not.toContain('владел');
    unmount();
  });
});
