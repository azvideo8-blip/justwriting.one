import { describe, it, expect, vi, beforeEach } from 'vitest';
import { streamChat } from '../aiChatTransport';

const USER = 'u_chat_consent_test';

vi.mock('../../../../core/auth', () => ({
  getCurrentUser: () => ({ uid: USER }),
  getIdToken: vi.fn().mockResolvedValue('fake_token'),
}));

const mockGetAiConsent = vi.fn();
const mockIsProfileLoaded = vi.fn();

vi.mock('../../../../core/ai/aiConsent', () => ({
  getAiConsent: () => mockGetAiConsent(),
  isProfileLoaded: () => mockIsProfileLoaded(),
}));

describe('Area 4: Consent gating on AI chat transport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refuses to transmit personal data to /api/chat when AI consent is not granted', async () => {
    mockIsProfileLoaded.mockReturnValue(true);
    mockGetAiConsent.mockReturnValue(false); // User has NOT given consent

    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(streamChat({
      personaId: 'cbt',
      messages: [{ role: 'user', content: 'Secret message' }],
      documentContent: 'Confidential diary entry',
      userPortrait: 'Sensitive psychological traits',
      onChunk: vi.fn(),
    })).rejects.toMatchObject({
      name: 'Error',
      message: 'AI_CONSENT_REQUIRED',
    });

    // Verify ZERO network requests were sent
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
