import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { getIndexingConsent, setIndexingConsent, INDEXING_CONSENT_VERSION } from '../../../core/ai/indexingConsent';

/**
 * Аудит диалогов, раунд 2 (2026-10-07): на новом устройстве окно «Поиск по
 * смыслу» всплывало посреди разговора у человека, который согласился давно —
 * штамп лежит в профиле, а клиент смотрел только в localStorage устройства.
 */

let capturedOnUpdate: ((data: unknown) => void) | null = null;
vi.mock('../../../core/data', () => ({
  DataProvider: {
    subscribeToProfile: (_uid: string, onUpdate: (data: unknown) => void) => {
      capturedOnUpdate = onUpdate;
      return () => { capturedOnUpdate = null; };
    },
    getProfile: vi.fn().mockResolvedValue(null),
    updateProfile: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('../../../core/crypto/cryptoHelpers', () => ({ setEncryptionEnabled: vi.fn(), setProfileLoaded: vi.fn() }));
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'user-ix', email: 'a@b.c', displayName: 'A' } }),
}));

const { ProfileProvider } = await import('../contexts/ProfileContext');

describe('согласие на индексацию подтягивается из профиля', () => {
  beforeEach(() => {
    localStorage.clear();
    setIndexingConsent('user-ix', 'unanswered');
    capturedOnUpdate = null;
  });

  it('штамп в профиле на новом устройстве — согласие есть, второй раз не спрашиваем', async () => {
    render(<ProfileProvider><div /></ProfileProvider>);
    capturedOnUpdate?.({ uid: 'user-ix', email: 'a@b.c', indexingConsentAt: '2026-10-06T10:00:00Z', indexingConsentVersion: INDEXING_CONSENT_VERSION });
    await waitFor(() => expect(getIndexingConsent('user-ix')).toBe('granted'));
  });

  it('отказ на этом устройстве штамп из профиля не перебивает', async () => {
    setIndexingConsent('user-ix', 'refused');
    render(<ProfileProvider><div /></ProfileProvider>);
    capturedOnUpdate?.({ uid: 'user-ix', email: 'a@b.c', indexingConsentAt: '2026-10-06T10:00:00Z', indexingConsentVersion: INDEXING_CONSENT_VERSION });
    await new Promise(r => setTimeout(r, 50));
    expect(getIndexingConsent('user-ix')).toBe('refused');
  });

  it('без штампа согласие не появляется', async () => {
    render(<ProfileProvider><div /></ProfileProvider>);
    capturedOnUpdate?.({ uid: 'user-ix', email: 'a@b.c', nickname: 'A' });
    await new Promise(r => setTimeout(r, 50));
    expect(getIndexingConsent('user-ix')).toBe('unanswered');
  });
});
