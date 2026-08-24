import { describe, it, expect, beforeEach } from 'vitest';
import { clearAccountScopedStorage, accountScopedLocalStorageKeys } from '../services/accountScopedKeys';

const A = 'user-aaa';
const B = 'user-bbb';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('clearAccountScopedStorage (AUD-4)', () => {
  it('стирает ключи аккаунта A и не трогает ключи аккаунта B', () => {
    for (const k of accountScopedLocalStorageKeys(A)) {
      localStorage.setItem(k, 'a-value');
    }
    for (const k of accountScopedLocalStorageKeys(B)) {
      localStorage.setItem(k, 'b-value');
    }

    clearAccountScopedStorage(A);

    for (const k of accountScopedLocalStorageKeys(A)) {
      expect(localStorage.getItem(k), `ключ ${k} должен быть удалён`).toBeNull();
    }
    for (const k of accountScopedLocalStorageKeys(B)) {
      expect(localStorage.getItem(k), `чужой ключ ${k} должен уцелеть`).toBe('b-value');
    }
  });

  it('общие настройки (тема, язык) переживают стирание', () => {
    localStorage.setItem('app-theme', 'amethyst');
    localStorage.setItem('app_language', 'ru');
    localStorage.setItem(`enc_enabled_${A}`, '1');

    clearAccountScopedStorage(A);

    expect(localStorage.getItem('app-theme')).toBe('amethyst');
    expect(localStorage.getItem('app_language')).toBe('ru');
    expect(localStorage.getItem(`enc_enabled_${A}`)).toBeNull();
  });

  it('без uid ничего не делает', () => {
    localStorage.setItem(`enc_enabled_${A}`, '1');
    clearAccountScopedStorage(null);
    expect(localStorage.getItem(`enc_enabled_${A}`)).toBe('1');
  });
});
