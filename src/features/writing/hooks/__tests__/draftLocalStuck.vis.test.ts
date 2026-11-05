// VIS T3 (утверждено владельцем 04.11, строка 6 карты): локальная запись
// отказала подряд — текст стоит только на экране, и человек обязан это видеть.
// Одиночный отказ остаётся за существующим значком и словами (`error`), баннер
// поднимается со второго подряд и снимается принятой записью.
//
// Отказ настоящий: база аккаунта отказывает по-настоящему (образец
// draftRescueTail.dw64.test.ts), запись идёт настоящим писателем через
// настоящий мутатор.
//
// Мутации: `>= 2` → `>= 1` в `useDraftCore.markError` — кейс 1 красный (баннер
// на первом же отказе); убрать обнуление в `markSaved` — кейс 2 красный;
// считать пропуски отказами (ветка `localSkipped` → `markError`) — кейс 3 красный.
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
import { applySave, clearAllRescuePayloads, clearEditorTextOwner } from '../../services/draftWriter';
import { useDraftAutosave } from '../useDraftAutosave';

const fail = vi.hoisted(() => ({ uid: '' }));
const quota = vi.hoisted(() => ({ uid: '' }));
vi.mock('../../../../core/storage/localDb', async (importActual) => {
  const actual = await importActual<typeof import('../../../../core/storage/localDb')>();
  return {
    ...actual,
    getLocalDb: vi.fn(async (uid?: string | null) => {
      const db = await actual.getLocalDb(uid ?? undefined);
      if (quota.uid && uid === quota.uid) {
        return new Proxy(db, {
          get(target, prop) {
            if (prop === 'transaction') return () => { throw new DOMException('нет места', 'QuotaExceededError'); };
            const value = Reflect.get(target, prop) as unknown;
            return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
          },
        });
      }
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

/** Правка + ожидание отсрочки (500 мс на десктопе): одна попытка записи. */
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

const stuck = () => useDraftWriteAlertStore.getState().localWriteStuck;

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
  useDraftWriteAlertStore.setState({ rescueNotWritten: false, localWriteStuck: false });
});

describe('VIS T3: локальная запись отказала подряд — текст только на экране', () => {
  it('первый отказ — значок и слова, второй подряд — состояние баннера', async () => {
    const A = 'u_vis_t3_A1';
    fail.uid = A;
    const { result, rerender, unmount } = renderHook(
      ({ d }) => useDraftAutosave({ uid: A } as AppUser, d),
      { initialProps: { d: data('') } },
    );
    await settle(200);

    await type(rerender, 'первая попытка');
    expect(result.current.saveStatus, 'одиночный отказ не показан существующим статусом').toBe('error');
    expect(stuck(), 'баннер поднят после одного отказа').toBe(false);

    await type(rerender, 'вторая попытка');
    expect(stuck(), 'два отказа подряд не подняли состояние').toBe(true);

    await type(rerender, 'третья попытка');
    expect(stuck(), 'состояние мигает на каждой попытке').toBe(true);
    // База снова отвечает — но записи за отказавшие попытки в ней нет: текст
    // стоял только на экране, ровно то, что говорит баннер.
    fail.uid = '';
    expect(await row(A), 'отказанная запись всё-таки легла в базу').toBeUndefined();
    unmount();
  });

  it('принятая запись снимает состояние', async () => {
    const A = 'u_vis_t3_A2';
    fail.uid = A;
    const { rerender, unmount } = renderHook(
      ({ d }) => useDraftAutosave({ uid: A } as AppUser, d),
      { initialProps: { d: data('') } },
    );
    await settle(200);
    await type(rerender, 'первая попытка');
    await type(rerender, 'вторая попытка');
    expect(stuck(), 'состояние не поднялось').toBe(true);

    // База снова отвечает: ближайшая же правка записывает текст и снимает баннер.
    fail.uid = '';
    await type(rerender, 'текст после восстановления');

    expect((await row(A))?.content, 'текст не записан').toBe('текст после восстановления');
    expect(stuck(), 'принятая запись не сняла состояние').toBe(false);
    unmount();
  });

  it('текст стёрт — пропуск «нечего сохранять» снимает состояние и счётчик', async () => {
    const A = 'u_vis_t3_A5';
    fail.uid = A;
    const { rerender, unmount } = renderHook(
      ({ d }) => useDraftAutosave({ uid: A } as AppUser, d),
      { initialProps: { d: data('') } },
    );
    await settle(200);
    await type(rerender, 'первая попытка');
    await type(rerender, 'вторая попытка');
    expect(stuck(), 'состояние не поднялось').toBe(true);

    // Заметка ревьюера 04.11 21:55, п.2: человек стёр текст — дальше каждая
    // попытка пропускается («нечего сохранять»), markSaved не зовётся, и баннер
    // висел бы над пустым редактором неправдой.
    await type(rerender, '');
    expect(stuck(), 'баннер висит над пустым редактором').toBe(false);

    // Счётчик снят тем же пропуском: один новый отказ после ожившей базы —
    // ещё не «два подряд».
    fail.uid = A;
    await type(rerender, 'один отказ после сброса');
    expect(stuck(), 'счётчик отказов не снят пропуском').toBe(false);
    unmount();
  });

  it('сброс сессии снимает состояние', async () => {
    const A = 'u_vis_t3_A6';
    fail.uid = A;
    const { rerender, unmount } = renderHook(
      ({ d }) => useDraftAutosave({ uid: A } as AppUser, d),
      { initialProps: { d: data('') } },
    );
    await settle(200);
    await type(rerender, 'первая попытка');
    await type(rerender, 'вторая попытка');
    expect(stuck(), 'состояние не поднялось').toBe(true);

    // Человек сохранил заметку через окно (или сменил аккаунт): сессия
    // сбрасывается, текста в редакторе больше нет — баннер стал неправдой.
    const { resetAndClear } = await import('../../store/storeActions');
    act(() => { resetAndClear(); });
    expect(stuck(), 'сброс сессии не снял состояние').toBe(false);
    unmount();
  });

  it('размонтирование редактора снимает состояние', async () => {
    const A = 'u_vis_t3_A7';
    fail.uid = A;
    const { rerender, unmount } = renderHook(
      ({ d }) => useDraftAutosave({ uid: A } as AppUser, d),
      { initialProps: { d: data('') } },
    );
    await settle(200);
    await type(rerender, 'первая попытка');
    await type(rerender, 'вторая попытка');
    expect(stuck(), 'состояние не поднялось').toBe(true);

    // Человек вышел из редактора: баннер больше не показывается, и следующая
    // сессия не должна начинаться с чужого «только на экране».
    unmount();
    expect(stuck(), 'размонтирование не сняло состояние').toBe(false);
  });

  it('закрытие черновика между отказами не мешает принятой записи снять состояние', async () => {
    const A = 'u_vis_t3_A8';
    const { result, rerender, unmount } = renderHook(
      ({ d }) => useDraftAutosave({ uid: A } as AppUser, d),
      { initialProps: { d: data('') } },
    );
    await settle(200);
    // Сначала строка должна существовать: правило эпохи сверяется с ней.
    await type(rerender, 'успешно записанный текст');
    expect(await row(A), 'строка не записана до отказов').toBeDefined();

    // Отказы устройства поднимают состояние; строка в базе остаётся старой.
    fail.uid = A;
    await type(rerender, 'первая попытка');
    await type(rerender, 'вторая попытка');
    expect(stuck(), 'состояние не поднялось').toBe(true);

    // База ожила, черновик закрывали сохранением заметки (applySave), но
    // правка снята уже после закрытия — запись принимается мутатором и
    // снимает состояние, как любая принятая.
    fail.uid = '';
    await act(async () => {
      useContentStore.getState().setContent('правка после сохранения заметки');
      rerender({ d: data('правка после сохранения заметки') });
      applySave(A);
    });
    await settle(800);

    expect(result?.current?.saveStatus, 'штатный пропуск показан ошибкой').not.toBe('error');
    expect((await row(A))?.content, 'текст после закрытия не записан').toBe('правка после сохранения заметки');
    expect(stuck(), 'принятая запись не сняла состояние').toBe(false);
    unmount();
  });

  it('контроль: штатный пропуск (закрытый черновик) отказом не считается', async () => {
    const A = 'u_vis_t3_A3';
    const { result, rerender, unmount } = renderHook(
      ({ d }) => useDraftAutosave({ uid: A } as AppUser, d),
      { initialProps: { d: data('') } },
    );
    await settle(200);

    for (const content of ['сохранение принято раз', 'сохранение принято два', 'сохранение принято три']) {
      // Правка снимает эпоху, сохранение заметки поднимает её до записи —
      // мутатор отвергает запись штатно ('stale-epoch'). Это не отказ устройства.
      await act(async () => {
        useContentStore.getState().setContent(content);
        rerender({ d: data(content) });
      });
      applySave(A);
      await settle(800);
    }

    expect(result.current.saveStatus, 'штатный пропуск показан ошибкой').not.toBe('error');
    expect(stuck(), 'штатные пропуски подняли баннер').toBe(false);
    unmount();
  });

  it('I3: в состоянии нет ни текста заметки, ни адреса аккаунта', async () => {
    const A = 'u_vis_t3_A4';
    fail.uid = A;
    const { rerender, unmount } = renderHook(
      ({ d }) => useDraftAutosave({ uid: A } as AppUser, d),
      { initialProps: { d: data('') } },
    );
    await settle(200);
    await type(rerender, 'секретный текст VIS');
    await type(rerender, 'секретный текст VIS продолжение');
    expect(stuck()).toBe(true);

    const dumped = JSON.stringify(useDraftWriteAlertStore.getState());
    expect(dumped, 'в показе текст заметки').not.toContain('секретный текст VIS');
    expect(dumped, 'в показе адрес аккаунта').not.toContain(A);
    unmount();
  });

  it('ревью кандидата: нет места у аккаунта — причина доезжает до показа, как у гостя', async () => {
    const U = 'u_vis_quota';
    quota.uid = U;
    const { result, rerender, unmount } = renderHook(({ d }) => useDraftAutosave({ uid: U } as AppUser, d), { initialProps: { d: data('') } });
    await act(async () => {
      useContentStore.getState().setContent('текст');
      rerender({ d: data('текст') });
    });
    await settle(800);
    quota.uid = '';
    expect(result.current.saveStatus).toBe('error');
    expect(result.current.saveErrorKind, 'причина нехватки места потеряна').toBe('quota');
    unmount();
  });
});
