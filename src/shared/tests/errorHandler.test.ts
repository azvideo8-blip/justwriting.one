import { mapAuthError } from '../../core/errors/errorHandler';
import { describe, it, expect } from 'vitest';

describe('errorHandler', () => {
  it('maps permission-denied correctly', () => {
    expect(mapAuthError({ code: 'permission-denied' })).toBe('У тебя нет прав для выполнения этого действия.');
  });

  it('maps auth errors correctly', () => {
    expect(mapAuthError({ code: 'auth/user-not-found' })).toBe('Неверный email или пароль.');
  });

  it('maps unknown errors to default', () => {
    expect(mapAuthError({ code: 'unknown' })).toBe('Что-то пошло не так');
  });
});
