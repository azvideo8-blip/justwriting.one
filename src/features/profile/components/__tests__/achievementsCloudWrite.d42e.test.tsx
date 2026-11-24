// Н-4 (дейлик 21.11): локальный список ачивок уходит в облако только после того,
// как облачный прочитан и слит. Раньше таймер писал его и при сбое чтения — телефон
// с меньшим списком откатывал облачный.
// Мутация: убрать `cloudReadUid !== user.uid` из эффекта записи — красный.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

const load = vi.hoisted(() => vi.fn());
const update = vi.hoisted(() => vi.fn());
const user = vi.hoisted(() => ({ uid: 'u_d42e' }));
vi.mock('../../../../core/services/ProfileService', () => ({
  ProfileService: { loadEarnedAchievements: load, updateEarnedAchievements: update },
}));
vi.mock('../../../../app/useAuthStatus', () => ({ useAuthStatus: () => ({ user }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { Achievements } from '../Achievements';
import { LanguageProvider } from '../../../../shared/i18n';

const KEY = `unlocked_achievements_${user.uid}`;
const stats = { totalWords: 5000, streakDays: 3, sessionsCount: 12, totalDuration: 0 };

const SESSIONS: never[] = [];

async function mount() {
  const view = render(<LanguageProvider><Achievements stats={stats as never} sessions={SESSIONS} /></LanguageProvider>);
  // act применяет обновления на выходе: сначала ответ чтения, потом таймер записи.
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  return view;
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  load.mockReset();
  update.mockReset().mockResolvedValue(undefined);
  localStorage.setItem(KEY, JSON.stringify(['local_only']));
});
afterEach(() => { vi.useRealTimers(); });

describe('Н-4: ачивки не пишутся поверх непрочитанного облака', () => {
  it('чтение не удалось → облако не тронуто', async () => {
    load.mockResolvedValue({ ids: [], error: true, resetAt: null });
    await mount();
    expect(update).not.toHaveBeenCalled();
  });

  it('чтение ещё идёт → записи нет, пока не пришёл ответ', async () => {
    load.mockReturnValue(new Promise(() => {}));
    await mount();
    expect(update).not.toHaveBeenCalled();
  });

  it('прочитано → уходит слитый список', async () => {
    load.mockResolvedValue({ ids: ['cloud_only'], error: false, resetAt: null });
    await mount();
    expect(update).toHaveBeenCalled();
    const sent = update.mock.calls.at(-1)![1] as string[];
    expect(sent).toEqual(expect.arrayContaining(['local_only', 'cloud_only']));
  });

  it('медленное чтение: ответ пришёл позже двух секунд — запись всё равно случится', async () => {
    let resolve!: (v: unknown) => void;
    load.mockReturnValue(new Promise(r => { resolve = r; }));
    await mount();
    await act(async () => { resolve({ ids: [], error: false, resetAt: null }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(update).toHaveBeenCalledTimes(1);
  });

  // Ревью 0.11.25 N-7: хранилище переполнено — в облако уходит слитый список, а не старый локальный.
  // Мутация: слать из localStorage — красный.
  it('слитое не легло в localStorage → в облако всё равно уходит слитое', async () => {
    load.mockResolvedValue({ ids: ['cloud_only'], error: false, resetAt: null });
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    await mount();
    spy.mockRestore();
    expect(update.mock.calls.at(-1)![1]).toEqual(expect.arrayContaining(['local_only', 'cloud_only']));
  });

  it('сброс: пустой список в облако не пишем (его сбрасывает сам сброс)', async () => {
    localStorage.clear();
    load.mockResolvedValue({ ids: [], error: false, resetAt: null });
    render(<LanguageProvider><Achievements stats={{ totalWords: 0, streakDays: 0, sessionsCount: 0, totalDuration: 0 } as never} sessions={SESSIONS} /></LanguageProvider>);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(update).not.toHaveBeenCalled();
  });
});
