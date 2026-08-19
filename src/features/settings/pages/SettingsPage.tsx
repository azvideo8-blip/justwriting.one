import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthStatus } from '../../../app/useAuthStatus';
import { useUserId } from '../../../shared/hooks/useUserId';
import { useLanguage } from '../../../shared/i18n';
import { AccountProfileSection } from '../components/AccountProfileSection';
import { SyncSettingsSection } from '../components/SyncSettingsSection';
import { AccountSecuritySection } from '../components/AccountSecuritySection';
import { AccountExportSection } from '../components/AccountExportSection';
import { AboutSettingsSection } from '../components/AboutSettingsSection';
import { AccountDeleteSection } from '../components/AccountDeleteSection';

export function SettingsPage() {
  const { t } = useLanguage();
  const { user } = useAuthStatus();
  const userId = useUserId(user);
  const location = useLocation();

  useEffect(() => {
    const rawHash = location.hash.replace(/^#/, '') || new URLSearchParams(location.search).get('tab');
    if (!rawHash) return;

    const targetMap: Record<string, string> = {
      account: 'account-section',
      sync: 'sync-section',
      storage: 'sync-section',
      app: 'sync-section',
      security: 'security-section',
      vault: 'security-section',
      encryption: 'security-section',
      ai: 'security-section',
      backup: 'backup-section',
      export: 'backup-section',
      about: 'about-section',
      danger: 'danger-section',
      delete: 'danger-section',
    };

    const targetId = targetMap[rawHash.toLowerCase()] || `${rawHash.toLowerCase()}-section`;
    const el = document.getElementById(targetId);
    if (el) {
      setTimeout(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }, [location.hash, location.search]);

  return (
    <div className="min-h-screen bg-surface-base text-text-main pb-24 md:pb-16">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 md:py-10 space-y-10">
        {/* Page Header */}
        <div className="border-b border-border-subtle pb-4">
          <h1 className="text-2xl font-bold tracking-tight text-text-main">
            {t('settings_title')}
          </h1>
        </div>

        {/* 1. Account */}
        <section id="account-section" aria-labelledby="account-heading" className="scroll-mt-6">
          <AccountProfileSection userId={userId} />
        </section>

        {/* 2. Sync & Storage */}
        <section id="sync-section" aria-labelledby="sync-heading" className="scroll-mt-6">
          <SyncSettingsSection userId={userId} />
        </section>

        {/* 3. Security, Encryption & AI */}
        <section id="security-section" aria-labelledby="security-heading" className="scroll-mt-6">
          <AccountSecuritySection userId={userId} />
        </section>

        {/* 4. Backup, Export & Import */}
        <section id="backup-section" aria-labelledby="backup-heading" className="scroll-mt-6">
          <AccountExportSection userId={userId} />
        </section>

        {/* 5. About, Changelog, Legal, Diagnostics */}
        <section id="about-section" aria-labelledby="about-heading" className="scroll-mt-6">
          <AboutSettingsSection />
        </section>

        {/* 6. Delete Account & Danger Zone (Visually Separated) */}
        <section id="danger-section" aria-labelledby="danger-heading" className="scroll-mt-6">
          <AccountDeleteSection userId={userId} />
        </section>
      </div>
    </div>
  );
}
