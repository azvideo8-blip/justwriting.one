import 'fake-indexeddb/auto';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { OnboardingGoalScreen } from '../OnboardingGoalScreen';
import { WritingPage } from '../../../../app/pages/WritingPage';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';
import { useTimerStore } from '../../store/useTimerStore';
import { renderWithProviders } from '../../../../test/utils/render';
import { MemoryRouter } from 'react-router-dom';
import { WritingSettingsProvider } from '../../../../core/settings/WritingSettingsContext';
import { ToastProvider } from '../../../../shared/components/Toast';
import { getLocalDb } from '../../../../core/storage/localDb';

vi.mock('../../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({
    isGuest: false,
    user: { uid: 'user-a' },
  }),
}));

vi.mock('../../../../app/useLoginModal', () => ({
  useLoginModal: () => ({
    openLoginModal: vi.fn(),
  }),
}));

vi.mock('../../../../core/sync/useSyncStatus', () => ({
  useSyncStatus: () => ({
    status: 'synced',
    pendingCount: 0,
  }),
}));

vi.mock('../../../../core/crypto/useEncryptionStore', () => ({
  useEncryptionStore: () => ({
    isUnlocked: true,
  }),
  VAULT_UNLOCKED_EVENT: 'vault_unlocked',
}));

describe('AG-ONBOARD-1: OnboardingGoalScreen & writing page gating', () => {
  beforeEach(async () => {
    localStorage.clear();
    useTimerStore.setState({
      wordGoal: 1000,
    });
    for (const uid of ['user-a', 'user-b']) {
      const db = await getLocalDb(uid);
      await db.clear('documents');
    }
  });

  it('OnboardingGoalScreen sets word goal and scopes localStorage key by userId', () => {
    const onComplete = vi.fn();
    const setWordGoal = vi.fn();

    renderWithProviders(
      <OnboardingGoalScreen
        userId="user-a"
        onComplete={onComplete}
        setWordGoal={setWordGoal}
      />
    );

    // Click 300 words preset
    const preset300 = screen.getByText('300');
    fireEvent.click(preset300);

    const startBtn = screen.getByRole('button', { name: /^начать$/i });
    fireEvent.click(startBtn);

    expect(setWordGoal).toHaveBeenCalledWith(300);
    expect(onComplete).toHaveBeenCalledWith(300);
    expect(localStorage.getItem(STORAGE_KEYS.ONBOARDING_DONE('user-a'))).toBe('1');
    expect(localStorage.getItem('onboarding_done')).toBeNull();
  });

  it('WritingPage shows OnboardingGoalScreen for a genuinely new account (zero local docs), saves goal, hides on second visit', async () => {
    const userA = { uid: 'user-a', email: 'a@example.com' } as any;

    const { unmount } = renderWithProviders(
      <ToastProvider>
        <WritingSettingsProvider>
          <MemoryRouter initialEntries={['/']}>
            <WritingPage user={userA} profile={null} />
          </MemoryRouter>
        </WritingSettingsProvider>
      </ToastProvider>
    );

    // Screen only appears after the doc-count check resolves (async by design —
    // see WritingPage.tsx: defaults to hidden so existing accounts are never
    // interrupted while the check is in flight).
    await waitFor(() => {
      expect(screen.getByText(/300/)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /^начать$/i })).toBeInTheDocument();

    // Select preset 100
    fireEvent.click(screen.getByText('100'));
    fireEvent.click(screen.getByRole('button', { name: /^начать$/i }));

    // Word goal applied in useTimerStore
    expect(useTimerStore.getState().wordGoal).toBe(100);
    expect(localStorage.getItem(STORAGE_KEYS.ONBOARDING_DONE('user-a'))).toBe('1');

    unmount();

    // Second visit: screen is not shown
    renderWithProviders(
      <ToastProvider>
        <WritingSettingsProvider>
          <MemoryRouter initialEntries={['/']}>
            <WritingPage user={userA} profile={null} />
          </MemoryRouter>
        </WritingSettingsProvider>
      </ToastProvider>
    );

    expect(screen.queryByText(/сколько хочешь писать/i)).toBeNull();
    expect(screen.getByPlaceholderText('Название сессии')).toBeInTheDocument();
  });

  it('Account B on same browser is shown onboarding screen even if Account A finished it', async () => {
    localStorage.setItem(STORAGE_KEYS.ONBOARDING_DONE('user-a'), '1');

    const userB = { uid: 'user-b', email: 'b@example.com' } as any;

    renderWithProviders(
      <ToastProvider>
        <WritingSettingsProvider>
          <MemoryRouter initialEntries={['/']}>
            <WritingPage user={userB} profile={null} />
          </MemoryRouter>
        </WritingSettingsProvider>
      </ToastProvider>
    );

    // user-b has no key set and no local docs, so OnboardingGoalScreen is shown
    await waitFor(() => {
      expect(screen.getByText(/300/)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /^начать$/i })).toBeInTheDocument();
  });

  it('regression: an existing account (has local docs, flag never set) is never shown the screen', async () => {
    // The flag didn't exist before today — every pre-existing account has
    // docs but no ONBOARDING_DONE key. Must not be shown onboarding.
    const db = await getLocalDb('user-a');
    await db.put('documents', {
      id: 'doc-1',
      guestId: 'user-a',
      title: 'Old note',
      currentVersion: 1,
      totalWords: 10,
      totalDuration: 0,
      sessionsCount: 1,
      firstSessionAt: 1000,
      lastSessionAt: 1000,
      tags: [],
    } as any);

    const userA = { uid: 'user-a', email: 'a@example.com' } as any;

    renderWithProviders(
      <ToastProvider>
        <WritingSettingsProvider>
          <MemoryRouter initialEntries={['/']}>
            <WritingPage user={userA} profile={null} />
          </MemoryRouter>
        </WritingSettingsProvider>
      </ToastProvider>
    );

    // Never shows the onboarding screen, at any point — assert immediately
    // (the default state) and again after the async check has had time to run.
    expect(screen.queryByText(/сколько хочешь писать/i)).toBeNull();
    await waitFor(() => {
      expect(localStorage.getItem(STORAGE_KEYS.ONBOARDING_DONE('user-a'))).toBe('1');
    });
    expect(screen.queryByText(/сколько хочешь писать/i)).toBeNull();
  });
});
