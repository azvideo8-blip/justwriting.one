import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCallAi, mockGetIdToken, mockReportError } = vi.hoisted(() => ({
  mockCallAi: vi.fn(),
  mockGetIdToken: vi.fn(),
  mockReportError: vi.fn(),
}));

let currentUser: { uid: string } | null = { uid: 'u1' };

vi.mock('../../../../core/ai/callAi', () => ({
  callAi: mockCallAi,
}));

vi.mock('../../../../core/auth', () => ({
  getCurrentUser: () => currentUser,
  getIdToken: mockGetIdToken,
}));

vi.mock('../../../../shared/errors/reportError', () => ({
  reportError: mockReportError,
}));

import { AIService } from '../AIService';

describe('chat retries once after token refresh on AUTH_REQUIRED', () => {
  beforeEach(() => {
    mockCallAi.mockReset();
    mockGetIdToken.mockReset();
    mockGetIdToken.mockResolvedValue('fresh-token');
    currentUser = { uid: 'u1' };
  });

  it('refreshes token and retries on AUTH_REQUIRED when user is signed in', async () => {
    mockCallAi
      .mockRejectedValueOnce(Object.assign(new Error('unauthenticated'), { code: 'functions/unauthenticated' }))
      .mockResolvedValueOnce({ result: 'hello' });

    const res = await AIService.chat({ personaId: 'p1', messages: [] });

    expect(mockGetIdToken).toHaveBeenCalledWith(true);
    expect(mockGetIdToken).toHaveBeenCalledTimes(1);
    expect(mockCallAi).toHaveBeenCalledTimes(2);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.text).toBe('hello');
  });

  it('does not retry a second time on consecutive AUTH_REQUIRED', async () => {
    mockCallAi
      .mockRejectedValueOnce(Object.assign(new Error('unauthenticated'), { code: 'functions/unauthenticated' }))
      .mockRejectedValueOnce(Object.assign(new Error('unauthenticated'), { code: 'functions/unauthenticated' }));

    const res = await AIService.chat({ personaId: 'p1', messages: [] });

    expect(mockGetIdToken).toHaveBeenCalledTimes(1);
    expect(mockCallAi).toHaveBeenCalledTimes(2);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('AUTH_REQUIRED');
  });

  it('does not retry when there is no current user', async () => {
    currentUser = null;

    mockCallAi.mockRejectedValueOnce(Object.assign(new Error('unauthenticated'), { code: 'functions/unauthenticated' }));

    const res = await AIService.chat({ personaId: 'p1', messages: [] });

    expect(mockGetIdToken).not.toHaveBeenCalled();
    expect(mockCallAi).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('AUTH_REQUIRED');
  });
});
