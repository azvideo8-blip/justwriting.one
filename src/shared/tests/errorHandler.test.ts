import { mapFirebaseError } from '../../core/errors/errorHandler';
import { describe, it, expect } from 'vitest';

describe('errorHandler', () => {
  it('maps permission-denied correctly', () => {
    expect(mapFirebaseError({ code: 'permission-denied' })).toBe('У вас нет прав для выполнения этого действия.');
  });

  it('maps auth errors correctly', () => {
    expect(mapFirebaseError({ code: 'auth/user-not-found' })).toBe('Неверный email или пароль.');
  });

  it('maps unknown errors to default', () => {
    expect(mapFirebaseError({ code: 'unknown' })).toBe('Произошла ошибка. Попробуйте позже.');
  });
});
