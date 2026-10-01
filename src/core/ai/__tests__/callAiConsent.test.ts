import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callAi } from '../callAi';
import { setAiConsent, useAiConsentStore } from '../aiConsent';
import { setProfileLoaded } from '../../crypto/cryptoHelpers';
import { setIndexingConsent } from '../indexingConsent';
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

  describe('AG-BILL-1 per-call charge flag', () => {
    it('defaults to bulk charge when opts are omitted', async () => {
      setProfileLoaded('user-123', true);
      setAiConsent('user-123', true);

      await callAi('summarizeDocument', { content: 'test note' });

      expect(global.fetch).toHaveBeenCalledWith('/api/summarizeDocument', expect.objectContaining({
        body: JSON.stringify({ data: { content: 'test note' } }),
      }));
    });

    it('sets charge: user when opts.charge is user', async () => {
      setProfileLoaded('user-123', true);
      setAiConsent('user-123', true);

      await callAi('chatWithAI', { messages: [] }, { charge: 'user' });

      expect(global.fetch).toHaveBeenCalledWith('/api/chatWithAI', expect.objectContaining({
        body: JSON.stringify({ data: { messages: [], charge: 'user' } }),
      }));
    });

    it('does not bleed charge: user to concurrent calls', async () => {
      setProfileLoaded('user-123', true);
      setAiConsent('user-123', true);

      let resolveUserCall!: (value: any) => void;
      const userCallPromise = new Promise((resolve) => { resolveUserCall = resolve; });

      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url === '/api/userTurn') {
          return userCallPromise.then(() => ({
            ok: true,
            json: () => Promise.resolve({ result: { success: true } }),
          }));
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ result: { success: true } }),
        });
      });
      global.fetch = fetchMock;

      // Start user turn with charge: 'user'
      const userTurn = callAi('userTurn', { prompt: 'user text' }, { charge: 'user' });

      // D-25: embedDocument уходит только с согласием на поиск по смыслу.
      setIndexingConsent('user-123', 'granted');
      // Start concurrent background call with default/no charge
      const bgTurn = callAi('embedDocument', { content: 'bg text' });

      await bgTurn;
      resolveUserCall(true);
      await userTurn;

      // Assert bgTurn payload did NOT get charge: 'user'
      expect(fetchMock).toHaveBeenCalledWith('/api/embedDocument', expect.objectContaining({
        body: JSON.stringify({ data: { content: 'bg text' } }),
      }));

      // Assert userTurn payload did get charge: 'user'
      expect(fetchMock).toHaveBeenCalledWith('/api/userTurn', expect.objectContaining({
        body: JSON.stringify({ data: { prompt: 'user text', charge: 'user' } }),
      }));
    });
  });
});
