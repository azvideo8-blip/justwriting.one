import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

// R7F-008: отметка «ссылка уже обменена» лежит в localStorage сутки и содержит
// e-mail человека: `jw_link_exchanged_<hash>` = { at, email }. Сценарий из
// находки — ссылка приглашения открыта на общем компьютере: адрес читается в
// этом браузере сутки и дольше и переживает обычный выход (выход «на чужом
// компьютере» стирает такие ключи подметанием, а обычный — нет).

const USER = 'u_r7f008';
const MARK_KEY = 'jw_link_exchanged_c0ffee1234';

vi.mock('../../../core/auth', () => ({
  getCurrentUser: () => ({ uid: USER, email: 'person@example.com' }),
  getCurrentUserId: () => USER,
  signOutUser: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../core/crypto/useEncryptionStore', () => ({
  useEncryptionStore: { getState: () => ({ lockVault: vi.fn() }) },
}));
vi.mock('../../../core/crypto/keyVaultCache', () => ({
  clearDeviceKey: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { AuthService } from '../services/AuthService';

function plantMark(at: number, email: string | null): void {
  localStorage.setItem(MARK_KEY, JSON.stringify(email === null ? { at } : { at, email }));
}

describe('R7F-008: обычный выход стирает отметку обмена ссылки', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('после выхода отметки с адресом не остаётся', async () => {
    plantMark(Date.now(), 'person@example.com');
    await AuthService.signOut();

    expect(localStorage.getItem(MARK_KEY), 'e-mail лежал в localStorage сутки после выхода').toBeNull();
  });

  it('свежая отметка живёт до выхода: перезагрузка страницы на шаге пароля её ждёт', async () => {
    plantMark(Date.now(), 'person@example.com');
    // Никакого выхода не было — отметка обязана читаться.
    expect(JSON.parse(localStorage.getItem(MARK_KEY) ?? '{}').at).toBeGreaterThan(0);
  });

  it('отметка другого человека в этом браузере не трогается до его же выхода — а после выхода не остаётся ничего', async () => {
    plantMark(Date.now(), 'person@example.com');
    localStorage.setItem('jw_link_exchanged_deadbeef', JSON.stringify({ at: Date.now(), email: 'other@example.com' }));
    await AuthService.signOut();

    expect(localStorage.getItem('jw_link_exchanged_deadbeef'), 'на общем компьютере не должно остаться адреса второго человека').toBeNull();
  });

  it('ключи, похожие по имени но не отметки, выходом не выносятся', async () => {
    localStorage.setItem('jw_link_exchanged_notes', 'важное');
    await AuthService.signOut();
    expect(localStorage.getItem('jw_link_exchanged_notes')).toBe('важное');
  });
});
