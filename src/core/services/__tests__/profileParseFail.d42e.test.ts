// Н-4 (дейлик 21.11): строка профиля есть, но не разобралась — это «не прочитали»,
// а не «профиля нет». Иначе потребители создают профиль заново и пишут поверх.
// Мутация: вернуть `error: false` в ветке `!parsed.success` — красный.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getProfile = vi.hoisted(() => vi.fn());
vi.mock('../../data', () => ({ DataProvider: { getProfile } }));
vi.mock('../../auth', () => ({ getCurrentUser: () => ({ uid: 'u_d42e' }) }));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { ProfileService } from '../ProfileService';

const UID = 'u_d42e';
const BROKEN = { email: 'a@example.test', nickname: 'Синтетика', earnedAchievements: 'не массив' };

beforeEach(() => { getProfile.mockReset(); });

describe('Н-4: сбой разбора профиля ≠ «профиля нет»', () => {
  it('getProfile: битая строка → error true', async () => {
    getProfile.mockResolvedValue(BROKEN);
    expect(await ProfileService.getProfile(UID)).toEqual({ data: null, error: true });
  });

  it('loadEarnedAchievements: битая строка → error true', async () => {
    getProfile.mockResolvedValue(BROKEN);
    expect(await ProfileService.loadEarnedAchievements(UID)).toEqual({ ids: [], error: true, resetAt: null });
  });

  it('контроль: строки нет → честное «нет» без ошибки', async () => {
    getProfile.mockResolvedValue(null);
    expect(await ProfileService.getProfile(UID)).toEqual({ data: null, error: false });
    expect((await ProfileService.loadEarnedAchievements(UID)).error).toBe(false);
  });

  it('контроль: целая строка читается', async () => {
    getProfile.mockResolvedValue({ ...BROKEN, earnedAchievements: ['words_1'] });
    expect((await ProfileService.loadEarnedAchievements(UID)).ids).toEqual(['words_1']);
  });
});
