// Приёмка DW-5 ревьюером. Настоящий мутатор и настоящая база: моки persistDraft
// (useDraftAutosave.test.ts) не видят, что мутатор отвергает снимок.
//
// Эпоха снимка спасения обязана быть эпохой текста ПРЕЖНЕГО владельца: карты
// эпох у аккаунтов разные, а конец сессии («idle», размонтирование) — не повод
// отказать тексту (правило пакета: не записать ≠ выбросить).
import 'fake-indexeddb/auto';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppUser } from '../../../../core/auth/types';
import { getLocalDb, type LocalDraft } from '../../../../core/storage/localDb';
import { useEncryptionStore } from '../../../../core/crypto/useEncryptionStore';
import { useContentStore } from '../../store/useContentStore';
import { useSessionMetaStore } from '../../store/useSessionMetaStore';
import { useTimerStore } from '../../store/useTimerStore';
import { useDraftAutosave } from '../useDraftAutosave';
import {
  applySave,
  applySessionEnd,
  clearAllRescuePayloads,
  clearEditorTextOwner,
  getDraftGeneration,
  isDraftClosed,
  markEditorTextOwner,
  pendingRescuePayloads,
} from '../../services/draftWriter';

vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => false }));
vi.mock('../../../../core/auth/accountReload', () => ({
  onBeforeAccountReload: () => () => {},
  isAccountReloadPending: () => false,
}));
vi.mock('../../../../shared/hooks/useLayoutMode', () => ({ useLayoutMode: () => ({ layoutMode: 'mobile' }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => false,
  maybeEncrypt: async (d: Record<string, unknown>) => d,
  maybeDecrypt: async (d: Record<string, unknown>) => d,
  isProfileLoaded: () => true,
}));

const A = 'u_dw5r_A';
const B = 'u_dw5r_B';
const userA = { uid: A } as AppUser;
const userB = { uid: B } as AppUser;
const TEXT = 'DW5R текст прежнего владельца';

const data = (content: string, status: 'writing' | 'idle' = 'writing') => ({
  title: '',
  content,
  pinnedThoughts: [] as string[],
  seconds: 5,
  wpm: 12,
  wordCount: 4,
  initialWordCount: 0,
  sessionStartTime: undefined,
  activeSessionId: null,
  status,
});

const settle = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)); });

async function row(uid: string): Promise<string | null> {
  const db = await getLocalDb(uid);
  return ((await db.get('drafts', uid)) as LocalDraft | undefined)?.content ?? null;
}

beforeEach(async () => {
  localStorage.clear();
  clearEditorTextOwner();
  clearAllRescuePayloads();
  useEncryptionStore.setState({ encryptionEnabled: {} });
  useContentStore.setState({ content: TEXT, title: '', wordCount: 4, tags: [], labelId: undefined, ownerUid: A });
  useTimerStore.setState({ status: 'writing' });
  useSessionMetaStore.getState().resetSessionMetadata();
  for (const uid of [A, B]) await (await getLocalDb(uid)).clear('drafts');
});

describe('DW-5 ревью: эпоха снимка спасения', () => {
  // N-47: редактор размонтирован (страница приглашения) и смонтирован под B, а
  // стор текста тот же. Размонтирование подняло эпоху A, новый экземпляр хука
  // эпохи A не знает.
  it('пересоздание редактора под другим аккаунтом: текст A в его базе, у B пустой редактор', async () => {
    markEditorTextOwner(A);
    const first = renderHook(() => useDraftAutosave(userA, data(TEXT)));
    await settle(10);
    first.unmount();
    await settle(50);
    await (await getLocalDb(A)).clear('drafts'); // проверяем именно спасение, а не запись при размонтировании

    const second = renderHook(({ d }) => useDraftAutosave(userB, d), { initialProps: { d: data(TEXT) } });
    await settle(50);
    second.rerender({ d: data(useContentStore.getState().content) });
    await settle(50);

    expect(useContentStore.getState().content, 'текст A остался на экране у B').toBe('');
    expect(await row(A), 'спасение не дошло до базы A').toBe(TEXT);
    expect(await row(B)).toBeNull();
    expect(pendingRescuePayloads()).toHaveLength(0);
    second.unmount();
  });

  // Эпоха B в ref нового экземпляра ниже закрытия A: сравнить их — значит молча
  // выбросить новый текст A, который никем не сохранён.
  it('A уже сохранял заметку: новый текст A при пересоздании под B не считается закрытым', async () => {
    applySave(A);
    markEditorTextOwner(A);
    const first = renderHook(() => useDraftAutosave(userA, data(TEXT)));
    await settle(10);
    first.unmount();
    await settle(50);
    await (await getLocalDb(A)).clear('drafts');

    const second = renderHook(() => useDraftAutosave(userB, data(TEXT)));
    await settle(50);

    expect(await row(A), 'новый текст A потерян как «закрытый»').toBe(TEXT);
    second.unmount();
  });

  // Конец сессии поднял эпоху, текст на экране остался (S-8). Это не закрытие.
  it('смена аккаунта после конца сессии: конец сессии снимку не отказ', async () => {
    markEditorTextOwner(A);
    const { rerender, unmount } = renderHook(
      ({ user, d }) => useDraftAutosave(user, d),
      { initialProps: { user: userA, d: data(TEXT) } },
    );
    await settle(10);
    await (await getLocalDb(A)).clear('drafts');
    rerender({ user: userA, d: data(TEXT, 'idle') });
    await settle(10);
    rerender({ user: userB, d: data(TEXT, 'idle') });
    await settle(50);

    expect(await row(A), 'спасение не дошло до базы A').toBe(TEXT);
    expect(useContentStore.getState().content, 'текст A вернулся на экран B').toBe('');
    unmount();
  });

  // «Сохранить» → сброс сессии → статус idle: конец сессии идёт сразу за
  // закрытием и не имеет права стереть память о нём.
  it('конец сессии после сохранения не отменяет закрытия черновика', () => {
    const before = getDraftGeneration(A);
    applySave(A);
    applySessionEnd(A);
    expect(isDraftClosed(A, before)).toBe(true);
    // Текст, начатый после закрытия, закрытием не закрыт, хоть эпоха и поднята.
    const typedAfter = getDraftGeneration(A);
    applySessionEnd(A);
    expect(isDraftClosed(A, typedAfter)).toBe(false);
  });
});
