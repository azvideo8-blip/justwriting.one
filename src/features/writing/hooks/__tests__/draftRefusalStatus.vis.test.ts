// VIS (владелец 04.11, T2 снят): отказ мутатора по владельцу (`no-owner`,
// `owner-mismatch`) показывается существующим статусом `error`, без нового
// текста. Для этого исход не теряется в `SKIPPED`: `persistDraft` его
// возвращает (`draftPersistence.ts:122`), писатель несёт дальше, а `wrapSave`
// разбирает. Штатный пропуск (`stale-epoch`) остаётся тихим — сообщать нечего.
//
// Отказ настоящий: строку пишет мутатор `applyWrite` через настоящий
// `persistDraft` поверх fake-indexeddb. Мок `persistDraft` приёмкой не
// считается (VIS-3, урок DW-5).
//
// Мутация: в `wrapSave` вернуть `setSaveStatus('idle')` на любой пропуск —
// кейс «отказ по владельцу» красный.
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { LocalDraft } from '../../../../core/storage/localDb';
import { resetDbInstance } from '../../../../core/storage/localDb';
import { persistDraft } from '../../utils/draftPersistence';
import { applySave } from '../../services/draftWriter';
import { useDraftCore } from '../useDraftCore';
import { reportError } from '../../../../shared/errors/reportError';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => false }));

const ME = 'u_vis_refused_me';
const OTHER = 'u_vis_refused_other';
const MY_TEXT = 'VIS текст который набрал человек';

/** Хвост писателя дословно (`useDraftAutosave.ts:297-305`): отказ мутатора
 *  производит настоящий `persistDraft`, а не тест. */
async function writeLikeTheWriter(rec: LocalDraft) {
  const result = await persistDraft(rec, { remote: false });
  if (!result.localOk) throw new Error('Local save failed');
  if (result.localSkipped) return { localSkipped: true, localSkipOutcome: result.localSkipOutcome };
  return {};
}

const rec = (over: Partial<LocalDraft> = {}): LocalDraft => ({
  userId: ME,
  owner: ME,
  content: MY_TEXT,
  title: '',
  wordCount: 5,
  ...over,
} as unknown as LocalDraft);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetDbInstance();
  vi.mocked(reportError).mockClear();
});

describe('VIS: отказ записи по владельцу виден как ошибка, а не как «нечего сохранять»', () => {
  it('owner-mismatch: статус error, причина unknown (существующие слова «Ошибка сохранения»)', async () => {
    // Настоящий отказ мутатора: строка подписана другим аккаунтом, а адрес — мой
    // (`applyWrite`, draftWriter.ts:361).
    const res = await persistDraft(rec({ owner: OTHER }), { remote: false });
    expect(res.localSkipped, 'мутатор не отверг чужого владельца').toBe(true);
    expect(res.localSkipOutcome).toBe('owner-mismatch');

    const { result } = renderHook(() => useDraftCore({ userId: ME }));
    await act(async () => { await result.current.wrapSave(() => writeLikeTheWriter(rec({ owner: OTHER })), 'vis/refused'); });

    expect(result.current.saveStatus, 'отказ по владельцу показан пустым индикатором').toBe('error');
    expect(result.current.saveErrorKind).toBe('unknown');
  });

  it('no-owner: тот же статус error', async () => {
    const { result } = renderHook(() => useDraftCore({ userId: ME }));
    await act(async () => { await result.current.wrapSave(() => writeLikeTheWriter(rec({ owner: undefined })), 'vis/refused'); });
    expect(result.current.saveStatus).toBe('error');
  });

  it('журнал отказа не несёт ни текста заметки, ни заголовка', async () => {
    const { result } = renderHook(() => useDraftCore({ userId: ME }));
    await act(async () => { await result.current.wrapSave(() => writeLikeTheWriter(rec({ owner: OTHER, title: 'VIS заголовок' })), 'vis/refused'); });

    const calls = vi.mocked(reportError).mock.calls;
    expect(calls.length, 'отказ не попал в журнал').toBeGreaterThan(0);
    const dumped = JSON.stringify(calls);
    expect(dumped, 'в журнале текст заметки').not.toContain(MY_TEXT);
    expect(dumped, 'в журнале заголовок').not.toContain('VIS заголовок');
    // Адрес другого аккаунта в показ не попадает (I3): статус и причина — без имён.
    expect(result.current.saveErrorKind).toBe('unknown');
  });

  it('журнал: одна запись на состояние, а не на каждую попытку', async () => {
    const { result } = renderHook(() => useDraftCore({ userId: ME }));
    // Заметка ревьюера 04.11 21:55, п.3: автосохранение стучит раз в секунду —
    // три попытки одного и того же состояния не должны засорять журнал.
    await act(async () => { await result.current.wrapSave(() => writeLikeTheWriter(rec({ owner: OTHER })), 'vis/refused'); });
    await act(async () => { await result.current.wrapSave(() => writeLikeTheWriter(rec({ owner: OTHER })), 'vis/refused'); });
    await act(async () => { await result.current.wrapSave(() => writeLikeTheWriter(rec({ owner: OTHER })), 'vis/refused'); });
    expect(result.current.saveStatus, 'повтор попытки не показан ошибкой').toBe('error');

    const refused = vi.mocked(reportError).mock.calls
      .filter(([err]) => err instanceof Error && err.message.startsWith('DRAFT_WRITE_REFUSED'));
    expect(refused.length, 'журнал засорён повторами состояния').toBe(1);
  });

  it('журнал: отказ после принятой записи — новое состояние, запись снова', async () => {
    const { result } = renderHook(() => useDraftCore({ userId: ME }));
    await act(async () => { await result.current.wrapSave(() => writeLikeTheWriter(rec({ owner: OTHER })), 'vis/refused'); });
    await act(async () => { await result.current.wrapSave(() => writeLikeTheWriter(rec()), 'vis/accepted'); });
    expect(result.current.saveStatus, 'принятая запись не сняла ошибку').toBe('saved');
    await act(async () => { await result.current.wrapSave(() => writeLikeTheWriter(rec({ owner: OTHER })), 'vis/refused'); });

    // Защита от передедупливания: состояние ушло (запись принята) и вернулось —
    // это новая запись, не «всё ещё тот же отказ».
    const refused = vi.mocked(reportError).mock.calls
      .filter(([err]) => err instanceof Error && err.message.startsWith('DRAFT_WRITE_REFUSED'));
    expect(refused.length, 'повтор состояния после принятой записи не записан').toBe(2);
  });

  it('контроль: штатный stale-epoch остаётся тихим пропуском (idle)', async () => {
    const { result } = renderHook(() => useDraftCore({ userId: ME }));
    // Эпоха поднята сохранением заметки: запись с прежней эпохой отвергается
    // настоящим мутатором (`applySave` → `isEpochStale`).
    applySave(ME);
    const stale = rec({ epoch: 0 });
    const res = await persistDraft(stale, { remote: false });
    expect(res.localSkipOutcome).toBe('stale-epoch');

    await act(async () => { await result.current.wrapSave(() => writeLikeTheWriter(stale), 'vis/stale'); });
    expect(result.current.saveStatus, 'штатный пропуск зашумел').toBe('idle');
    expect(vi.mocked(reportError), 'штатный пропуск попал в журнал').not.toHaveBeenCalled();
  });

  it('принятая запись снимает ошибку', async () => {
    const { result } = renderHook(() => useDraftCore({ userId: ME }));
    await act(async () => { await result.current.wrapSave(() => writeLikeTheWriter(rec({ owner: OTHER })), 'vis/refused'); });
    expect(result.current.saveStatus).toBe('error');

    await act(async () => { await result.current.wrapSave(() => writeLikeTheWriter(rec()), 'vis/accepted'); });
    expect(result.current.saveStatus, 'успешная запись не сняла ошибку').toBe('saved');
  });
});
