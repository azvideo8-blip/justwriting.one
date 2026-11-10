// VIS T4 (утверждено владельцем 04.11, строка 7 карты): гостю при настоящей
// нехватке места показывается существующий `editor_error_quota`, а не «Ошибка
// сохранения». `markError` различает нехватку только по самому броску
// (`DOMException` + `QuotaExceededError`), а обёртка «обе половины отказали»
// причину теряла: на полном устройстве гость видел слова, которые не говорят,
// что делать (освободить место).
//
// Отказ настоящий: строка IDB и LS-копия пишутся настоящим мутатором
// (`applyWrite`) и обе отказывают настоящей нехваткой места. Показ — настоящий
// `useDraftCore.wrapSave`, тот же, через который гостевую запись ведёт
// `useDraftManager.ts:82`.
//
// Мутация: вернуть `throw new Error('GUEST_DRAFT_SAVE_FAILED: …')` без причины —
// кейс 1 красный (`saveErrorKind` станет 'unknown'); бросать причину всегда, а
// не только когда отказали обе половины, — красный кейс 2.
import 'fake-indexeddb/auto';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDraftCore } from '../../hooks/useDraftCore';
import { useDraftWriteAlertStore } from '../../store/useDraftWriteAlertStore';
import { saveGuestDraftToStorage } from '../GuestDraftService';
import type { DraftRecord } from '../draftWriter';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => false }));

/** Настоящая форма отказа браузера при нехватке места. */
const quota = () => new DOMException('storage full', 'QuotaExceededError');

const failIdb = vi.hoisted(() => ({ on: false }));
vi.mock('../../../../core/storage/localDb', async (importActual) => {
  const actual = await importActual<typeof import('../../../../core/storage/localDb')>();
  return {
    ...actual,
    getLocalDb: vi.fn(async (uid?: string | null) => {
      if (!failIdb.on) return actual.getLocalDb(uid ?? undefined);
      return {
        objectStoreNames: ['drafts'],
        // Устройство полное: транзакция не открывается вовсе.
        transaction: () => { throw new DOMException('storage full', 'QuotaExceededError'); },
      } as never;
    }),
  };
});

const GUEST = 'guest_vis_t4';
const rec: DraftRecord = { content: 'гостевой текст VIS', title: '', wordCount: 3 };

let setItemSpy: ReturnType<typeof vi.spyOn> | null = null;
function failLocalStorage() {
  setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw quota(); });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  failIdb.on = false;
  useDraftWriteAlertStore.setState({ localWriteStuck: false });
});

afterEach(() => {
  setItemSpy?.mockRestore();
  setItemSpy = null;
  failIdb.on = false;
});

describe('VIS T4: гостю видна настоящая причина — нехватка места', () => {
  it('обе половины отказали по месту: статус ошибки называет причину', async () => {
    failIdb.on = true;
    failLocalStorage();

    const { result } = renderHook(() => useDraftCore({ userId: GUEST }));
    await act(async () => {
      await result.current.wrapSave(
        async () => { await saveGuestDraftToStorage(rec, { uid: GUEST, epoch: 0 }); },
        'draftManager/autosave',
      );
    });

    expect(result.current.saveStatus, 'отказ не показан').toBe('error');
    expect(result.current.saveErrorKind, 'причина нехватки места потеряна').toBe('quota');
  });

  it('контроль: одна половина отказала — правила записи это не меняет', async () => {
    // Строка IDB не открылась, но копия легла: текст в читаемом адресе, и
    // `loadGuestDraftFromStorage` его заберёт. Это «записано», а не потеря —
    // бросать причину здесь нельзя (иначе «Ошибка сохранения» на спасённом тексте).
    failIdb.on = true;

    const { result } = renderHook(() => useDraftCore({ userId: GUEST }));
    let saved: boolean | undefined;
    await act(async () => {
      // Правило разбора итога — то же, что у настоящего гостевого писателя
      // (`useDraftManager.ts:97-100`): пропуск по эпохе тихий, прочий отказ — ошибка.
      saved = await result.current.wrapSave(
        async () => {
          const outcome = await saveGuestDraftToStorage(rec, { uid: GUEST, epoch: 0 });
          if (outcome === 'stale-epoch') return { localSkipped: true, localSkipOutcome: outcome };
          if (outcome !== 'written') throw new Error(`GUEST_DRAFT_REFUSED: ${outcome}`);
        },
        'draftManager/autosave',
      );
    });

    expect(saved, 'запись одной половины не прошла').toBe(true);
    expect(localStorage.getItem('jw_guest_draft'), 'копия не записана').toContain('гостевой текст VIS');
    expect(result.current.saveStatus, 'спасённый текст показан ошибкой').not.toBe('error');
    expect(result.current.saveErrorKind).toBeNull();
  });
});
