import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSendTelemetry = vi.fn().mockResolvedValue({ data: { success: true } });
const mockHttpsCallable = vi.fn().mockReturnValue(mockSendTelemetry);

vi.mock('firebase/auth', () => ({
  getAuth: () => ({ currentUser: { uid: 'user-1' } }),
}));

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn().mockReturnValue({ app: 'mockApp' }),
  httpsCallable: (...args: unknown[]) => mockHttpsCallable(...args),
}));


vi.mock('../../storage/localDb', () => ({
  getLocalDb: () => Promise.resolve({
    getAll: (store: string) => {
      if (store === 'documents') return Promise.resolve([{ totalWords: 100 }, { totalWords: 200 }]);
      if (store === 'aiDialogues') return Promise.resolve([{ reasoning: true }, { reasoning: false }]);
      return Promise.resolve([]);
    },
  }),
}));

import { TelemetryService } from '../TelemetryService';

describe('TelemetryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('calls sendTelemetry callable function when interval has passed and user is signed in', async () => {
    await TelemetryService.maybeSendTelemetry();

    expect(mockHttpsCallable).toHaveBeenCalledWith(expect.anything(), 'sendTelemetry');
    expect(mockSendTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        telemetryId: expect.any(String),
        notesCountBucket: '0-10',
        averageWordCount: 150,
        reasoningRatio: 0.5,
      })
    );
  });

  it('skips sending telemetry if send interval (14 days) has not passed', async () => {
    localStorage.setItem('telemetry_last_send', String(Date.now()));
    await TelemetryService.maybeSendTelemetry();

    expect(mockSendTelemetry).not.toHaveBeenCalled();
  });
});
