import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Кэш портрета в localStorage привязан к аккаунту.
 *
 * До этого ключ был общий — `ai_user_portrait`. Выход из аккаунта чистит
 * IndexedDB и ключи, помеченные uid'ом; общий ключ не попадал ни туда, ни
 * туда. Отсюда две беды:
 *
 * 1. После «выйти и стереть всё с этого компьютера» портрет со специальными
 *    категориями (интимная жизнь, семья, имена третьих лиц) оставался лежать
 *    в браузере открытым текстом.
 * 2. `getPortrait` читает localStorage вторым шагом — когда IndexedDB пуста.
 *    То есть следующий человек, вошедший в этом браузере, получал ЧУЖОЙ
 *    портрет в системную подсказку на каждом ходу чата.
 */

let currentUid: string | null = 'user-A';

vi.mock('../../../../core/auth', () => ({
  getCurrentUser: () => (currentUid ? { uid: currentUid } : null),
}));
vi.mock('../../../../core/data', () => ({ DataProvider: { getProfile: vi.fn(async () => null) } }));
vi.mock('../../../../core/crypto/cryptoHelpers', () => ({
  maybeEncrypt: async (o: unknown) => o,
  maybeDecrypt: async (o: unknown) => o,
}));
vi.mock('../../../../core/services/CloudSyncService', () => ({
  CloudSyncService: { syncPortraitToCloud: vi.fn() },
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

// IndexedDB пуста — ровно то состояние, в котором getPortrait идёт в localStorage.
vi.mock('../../../../core/storage/localDb', () => ({
  getLocalDb: vi.fn(async () => ({
    get: vi.fn(async () => undefined),
    getAll: vi.fn(async () => []),
    put: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  })),
}));

const { AIProfileService, portraitCacheKey } = await import('../AIProfileService');
const { accountScopedLocalStorageKeys, clearAccountScopedStorage } =
  await import('../../../auth/services/accountScopedKeys');

describe('кэш портрета привязан к аккаунту', () => {
  beforeEach(() => {
    localStorage.clear();
    currentUid = 'user-A';
  });

  it('портрет одного человека не подставляется другому', async () => {
    localStorage.setItem(portraitCacheKey('user-A'), 'портрет первого человека');

    currentUid = 'user-B';
    const forB = await AIProfileService.getPortrait();

    expect(forB).toBeNull();
  });

  it('общий ключ прошлых сборок уносится при первом же чтении', async () => {
    localStorage.setItem('ai_user_portrait', 'портрет, оставшийся от кого-то');

    const got = await AIProfileService.getPortrait();

    expect(got).toBeNull();
    expect(localStorage.getItem('ai_user_portrait')).toBeNull();
  });

  it('выход из аккаунта уносит портрет этого человека и не трогает чужой', () => {
    localStorage.setItem(portraitCacheKey('user-A'), 'портрет A');
    localStorage.setItem(portraitCacheKey('user-B'), 'портрет B');

    clearAccountScopedStorage('user-A');

    expect(localStorage.getItem(portraitCacheKey('user-A'))).toBeNull();
    expect(localStorage.getItem(portraitCacheKey('user-B'))).toBe('портрет B');
  });

  /**
   * Список стираемого при выходе — обещание, данное человеку в диалоге. Ключ
   * портрета обязан быть в нём: это самый чувствительный единичный артефакт.
   */
  it('ключ портрета объявлен в списке стираемого при выходе', () => {
    expect(accountScopedLocalStorageKeys('user-A')).toContain(portraitCacheKey('user-A'));
  });
});
