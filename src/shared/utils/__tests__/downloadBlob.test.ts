import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { downloadBlob } from '../downloadBlob';

describe('downloadBlob', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:http://localhost/mock-blob-url');
    vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('F-051: defers revoking object URL so asynchronous downloads can start', () => {
    const blob = new Blob(['test content'], { type: 'text/plain' });
    downloadBlob(blob, 'test.txt');

    // Right after downloadBlob, URL must not be revoked yet
    expect(window.URL.revokeObjectURL).not.toHaveBeenCalled();

    // After timer expires, URL is revoked
    vi.advanceTimersByTime(1000);
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/mock-blob-url');
  });
});
