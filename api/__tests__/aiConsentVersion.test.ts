// D-6: версия согласия на ИИ должна быть ОДНОЙ на клиента и сервер. Сервер держал
// собственное число 2, пока клиент (Настройки, ProfileContext) требовал
// PRIVACY_VERSION = 3: человек с согласием версии 2 видел «Не предоставлено» в
// Настройках, хотя ИИ его пропускал.
import { beforeEach, describe, expect, it, vi } from 'vitest';

let consentRow: { ai_consent_at: string | null; ai_consent_version: number | null } | null = null;

vi.mock('../db', () => ({
  pool: {
    on: vi.fn(),
    query: vi.fn(async () => ({ rows: consentRow ? [consentRow] : [] })),
  },
}));

import { postgresAiContext } from '../postgresAiContext';
import { AI_CONSENT_VERSION_REQUIRED } from '../../src/shared/ai/consentVersion';

const GRANTED_AT = '2026-09-01T00:00:00.000Z';

describe('AI consent version is one number for client and server (D-6)', () => {
  beforeEach(() => {
    consentRow = null;
  });

  it('the shared constant is the current policy version', () => {
    expect(AI_CONSENT_VERSION_REQUIRED).toBe(3);
  });

  it('accepts consent given on the current version', async () => {
    consentRow = { ai_consent_at: GRANTED_AT, ai_consent_version: AI_CONSENT_VERSION_REQUIRED };
    await expect(postgresAiContext.getAiConsent('u1')).resolves.toEqual({ granted: true });
  });

  it('rejects the version the settings screen also rejects', async () => {
    // Именно этот случай расходился: сервер пускал (2 >= 2), Настройки показывали
    // «Согласие не предоставлено» (2 < AI_CONSENT_VERSION_REQUIRED).
    consentRow = { ai_consent_at: GRANTED_AT, ai_consent_version: AI_CONSENT_VERSION_REQUIRED - 1 };
    await expect(postgresAiContext.getAiConsent('u1')).resolves.toEqual({ granted: false });
  });

  it('rejects a profile without a consent timestamp', async () => {
    consentRow = { ai_consent_at: null, ai_consent_version: AI_CONSENT_VERSION_REQUIRED };
    await expect(postgresAiContext.getAiConsent('u1')).resolves.toEqual({ granted: false });
  });
});
