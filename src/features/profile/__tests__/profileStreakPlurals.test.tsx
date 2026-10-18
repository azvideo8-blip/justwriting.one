import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MeStatsSection } from '../../writing/components/MeStatsSection';
import { ProfileHero } from '../components/ProfileHero';
import { LanguageProvider } from '../../../shared/i18n';
import type { UserProfile } from '../../../shared/types/common';
import type { AppUser } from '../../../core/auth/types';

import { ToastProvider } from '../../../shared/components/Toast';

function renderWithRussian(ui: React.ReactElement) {
  localStorage.setItem('language', 'ru');
  return render(
    <ToastProvider>
      <LanguageProvider>
        {ui}
      </LanguageProvider>
    </ToastProvider>
  );
}

const mockUser: AppUser = {
  uid: 'u1',
  email: 'test@example.com',
  displayName: 'Иван',
  photoURL: null,
  metadata: {
    creationTime: new Date().toISOString(),
    lastSignInTime: null,
  },
};

describe('L-14: Profile streak pluralization and consistent numbers', () => {
  it('MeStatsSection renders correct Russian plural for streak 1, 2, 5', () => {
    // Streak 1: день подряд
    const { unmount: unmount1 } = renderWithRussian(
      <MeStatsSection profile={{ streakDays: 1 }} />
    );
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('день подряд')).toBeInTheDocument();
    unmount1();

    // Streak 2: дня подряд
    const { unmount: unmount2 } = renderWithRussian(
      <MeStatsSection profile={{ streakDays: 2 }} />
    );
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('дня подряд')).toBeInTheDocument();
    unmount2();

    // Streak 5: дней подряд
    const { unmount: unmount5 } = renderWithRussian(
      <MeStatsSection profile={{ streakDays: 5 }} />
    );
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('дней подряд')).toBeInTheDocument();
    unmount5();
  });

  it('ProfileHero renders correct Russian plural for streak 1, 2, 5', () => {
    // Streak 1: 1 день
    const profile1 = { uid: 'u1', email: '', nickname: 'Иван', streakDays: 1 } as UserProfile;
    const { unmount: unmount1 } = renderWithRussian(
      <ProfileHero user={mockUser} profile={profile1} isGuest={false} onStartSession={() => {}} />
    );
    expect(screen.getByText('1 день')).toBeInTheDocument();
    unmount1();

    // Streak 2: 2 дня
    const profile2 = { uid: 'u1', email: '', nickname: 'Иван', streakDays: 2 } as UserProfile;
    const { unmount: unmount2 } = renderWithRussian(
      <ProfileHero user={mockUser} profile={profile2} isGuest={false} onStartSession={() => {}} />
    );
    expect(screen.getByText('2 дня')).toBeInTheDocument();
    unmount2();

    // Streak 5: 5 дней
    const profile5 = { uid: 'u1', email: '', nickname: 'Иван', streakDays: 5 } as UserProfile;
    const { unmount: unmount5 } = renderWithRussian(
      <ProfileHero user={mockUser} profile={profile5} isGuest={false} onStartSession={() => {}} />
    );
    expect(screen.getByText('5 дней')).toBeInTheDocument();
    unmount5();
  });

  it('The two figures on the profile agree for a fresh account', () => {
    // Case A: Fresh account before writing any session (0 days)
    const freshProfile0 = { uid: 'u1', email: '', nickname: 'Иван', streakDays: 0 } as UserProfile;
    const { unmount: u0 } = renderWithRussian(
      <div>
        <ProfileHero user={mockUser} profile={freshProfile0} isGuest={false} onStartSession={() => {}} />
        <MeStatsSection profile={freshProfile0} />
      </div>
    );
    // D-9 (решение владельца 2026-10-18): пустой стрик — отсутствие строки, а не
    // «0 дней» (DESIGN.md:324). Строка «0 дней подряд» ниже — из `MeStatsSection`,
    // мёртвого компонента; его поведение этой правкой не задето.
    expect(screen.queryByText('0 дней')).not.toBeInTheDocument();
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('дней подряд')).toBeInTheDocument();
    u0();

    // Case B: Fresh account on Day 1 after first session (1 day)
    const freshProfile1 = { uid: 'u1', email: '', nickname: 'Иван', streakDays: 1 } as UserProfile;
    const { unmount: u1 } = renderWithRussian(
      <div>
        <ProfileHero user={mockUser} profile={freshProfile1} isGuest={false} onStartSession={() => {}} />
        <MeStatsSection profile={freshProfile1} />
      </div>
    );
    // ProfileHero shows "1 день" and MeStatsSection shows value 1 with label "день подряд"
    expect(screen.getByText('1 день')).toBeInTheDocument();
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('день подряд')).toBeInTheDocument();
    u1();
  });
});
