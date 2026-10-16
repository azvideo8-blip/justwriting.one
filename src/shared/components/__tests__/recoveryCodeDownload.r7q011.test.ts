import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { downloadRecoveryCode } from '../recoveryCodeActions';

// R7Q-011: скачивание отзывало object URL в том же тике, что и `a.click()`.
// WebKit/Android WebView стартуют забор после текущего таска — файл не появлялся,
// а степпер уже докладывал «файл сохранён» и стирал единственный код.
const URL_STUB = 'blob:http://localhost/r7q011';
const t = (key: string) => `‹${key}›`;

describe('R7Q-011: downloadRecoveryCode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(window.URL, 'createObjectURL').mockReturnValue(URL_STUB);
    vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('не отзывает URL сразу и отзывает после старта скачивания', () => {
    expect(downloadRecoveryCode('ABCD-EFGH-IJKL', t)).toBe(true);
    expect(window.URL.revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith(URL_STUB);
  });

  it('в файле лежит сам код', async () => {
    vi.useRealTimers();   // чтение Blob — не по таймерам
    downloadRecoveryCode('WXYZ-1234-QRST', t);
    const calls = (window.URL.createObjectURL as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls.length).toBe(1);
    expect(await (calls[0]![0] as Blob).text()).toContain('WXYZ-1234-QRST');
  });
});
