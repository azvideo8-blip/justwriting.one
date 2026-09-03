import { AIDerivedDataSyncService } from '../../features/ai/services/AIDerivedDataSyncService';
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthStatus } from '../useAuthStatus';
import { useUserId } from '../../shared/hooks/useUserId';
import { useLanguage } from '../../shared/i18n';
import { RestoreFromCloudModal } from '../modals/RestoreFromCloudModal';
import { AccountProfileSection } from '../../features/settings/components/AccountProfileSection';
import { SyncSettingsSection } from '../../features/settings/components/SyncSettingsSection';
import { AccountSecuritySection } from '../../features/settings/components/AccountSecuritySection';
import { AccountExportSection } from '../../features/settings/components/AccountExportSection';
import { AboutSettingsSection } from '../../features/settings/components/AboutSettingsSection';
import { AccountDeleteSection } from '../../features/settings/components/AccountDeleteSection';

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

  const sections = [
    { id: 'account',  n: 1, title: t('settings_sec_account'),  desc: t('settings_sec_account_desc'),  node: <AccountProfileSection userId={userId} /> },
    { id: 'sync',     n: 2, title: t('settings_sec_sync'),     desc: t('settings_sec_sync_desc'),     node: <SyncSettingsSection userId={userId} onSyncDerivedData={id => AIDerivedDataSyncService.syncAllDerivedData(id)} onFindOrphans={id => AIDerivedDataSyncService.findOrphanedDerivatives(id)} onDeleteOrphans={id => AIDerivedDataSyncService.deleteOrphanedDerivatives(id)} renderRestoreModal={props => <RestoreFromCloudModal {...props} />} /> },
    { id: 'security', n: 3, title: t('settings_sec_security'), desc: t('settings_sec_security_desc'), node: <AccountSecuritySection userId={userId} /> },
    { id: 'backup',   n: 4, title: t('settings_sec_backup'),   desc: t('settings_sec_backup_desc'),   node: <AccountExportSection userId={userId} /> },
    { id: 'about',    n: 5, title: t('settings_sec_about'),    desc: t('settings_sec_about_desc'),    node: <AboutSettingsSection /> },
  ];

  return (
    <div className="min-h-screen bg-surface-base text-text-main pb-24 md:pb-16">
      <div className="mx-auto flex w-full max-w-5xl gap-10 px-4 sm:px-6 py-8 md:py-12">

        {/* Оглавление. Шесть разделов — это много прокрутки, и без указателя
            человек не знает, что впереди. На узком экране прячется: там оно
            заняло бы весь первый экран. */}
        <nav className="hidden lg:block w-48 shrink-0">
          <div className="sticky top-12 space-y-1">
            {sections.map(s => (
              <a
                key={s.id}
                href={`#${s.id}-section`}
                className="block rounded-lg px-3 py-2 text-sm text-text-main/60 hover:bg-text-main/5 hover:text-text-main transition-colors"
              >
                {s.title}
              </a>
            ))}
            <a
              href="#danger-section"
              className="block rounded-lg px-3 py-2 text-sm text-text-main/40 hover:bg-accent-danger/10 hover:text-accent-danger transition-colors"
            >
              {t('settings_sec_danger')}
            </a>
          </div>
        </nav>

        <div className="min-w-0 flex-1 space-y-12">
          <header className="space-y-1">
            <h1 className="text-3xl font-bold tracking-tight text-text-main">{t('settings_title')}</h1>
            <p className="text-sm text-text-main/60">{t('settings_page_subtitle')}</p>
          </header>

          {sections.map(s => (
            <section key={s.id} id={`${s.id}-section`} className="scroll-mt-12 space-y-4">
              {/* Заголовок вне карточки, содержимое внутри: так видно, где
                  кончается один раздел и начинается другой. Раньше всё лежало
                  одним потоком и сливалось. */}
              <div className="space-y-1">
                <div className="flex items-baseline gap-3">
                  <span className="text-xs font-bold tabular-nums text-text-main/30">{String(s.n).padStart(2, '0')}</span>
                  <h2 className="text-lg font-bold tracking-tight text-text-main">{s.title}</h2>
                </div>
                <p className="pl-8 text-sm text-text-main/60 leading-relaxed">{s.desc}</p>
              </div>
              <div className="rounded-2xl border border-border-subtle bg-text-main/[0.02] p-4 sm:p-5">
                {s.node}
              </div>
            </section>
          ))}

          {/* Удаление аккаунта отделено намеренно: это не настройка, и выглядеть
              как настройка оно не должно. */}
          <section id="danger-section" className="scroll-mt-12 space-y-4 pt-4 border-t border-border-subtle">
            <div className="space-y-1">
              <div className="flex items-baseline gap-3">
                <span className="text-xs font-bold tabular-nums text-accent-danger/40">06</span>
                <h2 className="text-lg font-bold tracking-tight text-accent-danger">{t('settings_sec_danger')}</h2>
              </div>
              <p className="pl-8 text-sm text-text-main/60 leading-relaxed">{t('settings_sec_danger_desc')}</p>
            </div>
            <div className="rounded-2xl border border-accent-danger/30 bg-accent-danger/[0.03] p-4 sm:p-5">
              <AccountDeleteSection userId={userId} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
