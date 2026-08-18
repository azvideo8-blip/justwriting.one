import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callAi } from '../callAi';
import { setAiConsent, useAiConsentStore } from '../aiConsent';
import { setProfileLoaded } from '../../crypto/cryptoHelpers';
import * as auth from '../../auth';

vi.mock('../../auth', () => ({
  getIdToken: vi.fn(),
  getCurrentUser: vi.fn(),
}));

describe('callAi consent gating (Ticket 2 / 152-ФЗ)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAiConsentStore.setState({ consents: {} });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: { success: true } }),
    });
    vi.mocked(auth.getIdToken).mockResolvedValue('valid-token');
    vi.mocked(auth.getCurrentUser).mockReturnValue({ uid: 'user-123', email: 'test@example.com' } as any);
  });

  it('throws AI_CONSENT_REQUIRED when user profile is loaded and consent is not given', async () => {
    setProfileLoaded('user-123', true);
    setAiConsent('user-123', false);

    await expect(callAi('summarize', { text: 'hello' })).rejects.toThrow('AI_CONSENT_REQUIRED');
  });

  it('executes successfully when user profile is loaded and consent is granted', async () => {
    setProfileLoaded('user-123', true);
    setAiConsent('user-123', true);

    const res = await callAi<{ success: boolean }>('summarize', { text: 'hello' });
    expect(res).toEqual({ success: true });
    expect(global.fetch).toHaveBeenCalledWith('/api/summarize', expect.any(Object));
  });

  it('allows deleteAccount regardless of AI consent status (CONSENT_EXEMPT)', async () => {
    setProfileLoaded('user-123', true);
    setAiConsent('user-123', false);

    const res = await callAi<{ success: boolean }>('deleteAccount', {});
    expect(res).toEqual({ success: true });
    expect(global.fetch).toHaveBeenCalledWith('/api/deleteAccount', expect.any(Object));
  });

  it('allows sendTelemetry regardless of AI consent status (CONSENT_EXEMPT)', async () => {
    setProfileLoaded('user-123', true);
    setAiConsent('user-123', false);

    const res = await callAi<{ success: boolean }>('sendTelemetry', { event: 'app_open' });
    expect(res).toEqual({ success: true });
    expect(global.fetch).toHaveBeenCalledWith('/api/sendTelemetry', expect.any(Object));
  });

  it('does not block calls when profile has not finished loading yet', async () => {
    setProfileLoaded('user-123', false);
    setAiConsent('user-123', false);

    const res = await callAi<{ success: boolean }>('summarize', { text: 'hello' });
    expect(res).toEqual({ success: true });
  });

  it('throws AUTH_REQUIRED when user is not logged in / token missing', async () => {
    vi.mocked(auth.getIdToken).mockResolvedValue(null);

    await expect(callAi('summarize', {})).rejects.toThrow('AUTH_REQUIRED');
  });
});
