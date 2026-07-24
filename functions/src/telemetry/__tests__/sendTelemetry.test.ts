import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpsError } from 'firebase-functions/v2/https';

const mockSet = vi.fn().mockResolvedValue(undefined);
const mockDoc = vi.fn().mockReturnValue({
  get: vi.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
  set: mockSet,
});
const mockGetFirestore = vi.fn().mockReturnValue({
  doc: mockDoc,
});

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => mockGetFirestore(),
  FieldValue: {
    serverTimestamp: () => 'SERVER_TIMESTAMP',
  },
}));

vi.mock('firebase-functions/v2/https', () => {
  class MockHttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    onCall: (_opts: unknown, handler: Function) => handler,
    HttpsError: MockHttpsError,
  };
});

import { sendTelemetry } from '../sendTelemetry';

describe('sendTelemetry Cloud Function', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws unauthenticated if request.auth is missing', async () => {
    await expect(
      // @ts-expect-error test request
      sendTelemetry({ data: { telemetryId: 'tel-1' }, auth: null })
    ).rejects.toThrow(HttpsError);
  });

  it('throws invalid-argument if payload validation fails', async () => {
    await expect(
      // @ts-expect-error test request
      sendTelemetry({ data: { reasoningRatio: 5 }, auth: { uid: 'user-1' } })
    ).rejects.toThrow(HttpsError);
  });

  it('saves anonymized telemetry and updates rate limit cooldown on success', async () => {
    mockDoc.mockReturnValue({
      get: vi.fn().mockResolvedValue({ exists: false }),
      set: mockSet,
    });

    const payload = {
      telemetryId: 'tel-anon-123',
      activeTheme: 'amethyst',
      notesCountBucket: '11-50',
      averageWordCount: 150,
      reasoningRatio: 0.25,
      sentAt: '2026-07-24T12:00:00Z',
    };

    // @ts-expect-error test request
    const res = await sendTelemetry({ data: payload, auth: { uid: 'user-1' } });
    expect(res).toEqual({ success: true });

    expect(mockDoc).toHaveBeenCalledWith('telemetryCooldown/user-1');
    expect(mockDoc).toHaveBeenCalledWith('anonymizedTelemetry/tel-anon-123');
    expect(mockSet).toHaveBeenCalledWith(payload, { merge: true });
  });

  it('enforces 24-hour rate limit per user', async () => {
    const recentSentAt = Date.now() - 1000; // 1 second ago
    mockDoc.mockReturnValue({
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({ lastSentAt: recentSentAt }),
      }),
      set: mockSet,
    });

    const payload = {
      telemetryId: 'tel-anon-123',
    };

    await expect(
      // @ts-expect-error test request
      sendTelemetry({ data: payload, auth: { uid: 'user-1' } })
    ).rejects.toThrow(HttpsError);
  });
});
