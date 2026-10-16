import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataProvider } from '../../../../core/data';
import { savePrivacyConsent } from '../PrivacyConsentBody';
import { AI_CONSENT_VERSION_REQUIRED } from '../../../../core/constants/privacyVersion';

vi.mock('../../../../core/data', () => ({
  DataProvider: { updateProfile: vi.fn().mockResolvedValue(undefined) },
}));

// R7F-004: повторное принятие политики с незалогой ИИ писало `aiConsentAt: null`
// и тем отзывал согласие, данное раньше (на другом устройстве, до сбоя чтения),
// — вместе с серверным свидетелем ai_consent_server_at. Отзыв живёт в настройках.
const payloadOf = (call: number) =>
  (vi.mocked(DataProvider.updateProfile).mock.calls[call] as [string, Record<string, unknown>])[1];

describe('R7F-004: savePrivacyConsent не отзывает согласие на ИИ', () => {
  beforeEach(() => {
    vi.mocked(DataProvider.updateProfile).mockClear();
    localStorage.clear();
  });

  it('без галки ИИ — поля aiConsentAt/aiConsentVersion не уходят в запись', async () => {
    await savePrivacyConsent('u1', false);

    const payload = payloadOf(0);
    expect(payload.privacyVersion).toBe(AI_CONSENT_VERSION_REQUIRED);
    expect('privacyAcceptedAt' in payload).toBe(true);
    expect('aiConsentAt' in payload).toBe(false);
    expect('aiConsentVersion' in payload).toBe(false);
    expect(localStorage.getItem('privacy_accepted_u1')).toBe(String(AI_CONSENT_VERSION_REQUIRED));
  });

  it('с галкой ИИ — согласие штампуется как раньше', async () => {
    await savePrivacyConsent('u1', true);

    const payload = payloadOf(0);
    expect(payload.aiConsentAt).toBeInstanceOf(Date);
    expect(payload.aiConsentVersion).toBe(AI_CONSENT_VERSION_REQUIRED);
  });
});
