import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Значок «1 ошибка» на пустом месте.
 *
 * Сайт, открытый внутри чужого фрейма, ловит в свой `window.onerror` чужую
 * `SecurityError` про cross-origin frame: внешний скрипт полез к нашему окну и
 * получил отказ. Приложение записывало её как свою — человек видел ошибку,
 * которой у него нет, а в Sentry уходил шум с чужого кода. Найдено при проверке
 * прода 2026-09-04.
 *
 * Отсекать надо УЗКО. Проверка ниже держит обе границы: чужое не проходит,
 * своё проходит — включая `SecurityError` по другому поводу.
 */

// Наблюдаем за журналом активности: именно он рисует значок «N ошибок».
// Sentry без DSN не вызывается вовсе, так что проверять надо не его.
const addError = vi.fn();
vi.mock('../../activity/useActivityLogStore', () => ({
  useActivityLogStore: { getState: () => ({ addError, addActivity: vi.fn() }) },
}));

const { setupGlobalErrorListeners } = await import('../reportError');

function throwToWindow(error: unknown, message: string) {
  window.dispatchEvent(new ErrorEvent('error', { error, message }));
}

describe('чужая ошибка встраивания не выдаётся за нашу', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupGlobalErrorListeners();
  });

  it('SecurityError про cross-origin frame не попадает в отчёт', () => {
    const e = Object.assign(new Error("Blocked a frame with origin \"https://example.com\" from accessing a cross-origin frame."), { name: 'SecurityError' });

    throwToWindow(e, e.message);

    expect(addError, 'ошибка чужого окна — не наша').not.toHaveBeenCalled();
  });

  it('настоящая ошибка по-прежнему попадает', () => {
    throwToWindow(new TypeError('doc.uuid is not a function'), 'doc.uuid is not a function');

    expect(addError).toHaveBeenCalledTimes(1);
  });

  /**
   * Граница с другой стороны: SecurityError бывает и по нашей вине — например,
   * при обращении к хранилищу в режиме, где оно запрещено. Такую глотать нельзя.
   */
  it('SecurityError по другому поводу не проглатывается', () => {
    const e = Object.assign(new Error('The operation is insecure.'), { name: 'SecurityError' });

    throwToWindow(e, e.message);

    expect(addError, 'молча терять свои ошибки нельзя').toHaveBeenCalledTimes(1);
  });
});
