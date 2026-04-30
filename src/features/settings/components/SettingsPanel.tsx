import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Cloud, LogIn, HardDrive, User as UserIcon } from 'lucide-react';
import { useLanguage } from '../../../core/i18n';
import { useTheme } from '../../../core/theme/ThemeProvider';
import { useWritingSettings } from '../../writing/contexts/WritingSettingsContext';
import { useServiceAction } from '../../writing/hooks/useServiceAction';
import { useToast } from '../../../shared/components/Toast';
import { ProfileService } from '../../profile/services/ProfileService';
import { SyncService } from '../../writing/services/SyncService';
import { useAuthStatus } from '../../auth/hooks/useAuthStatus';
import { useLoginModal } from '../../auth/contexts/LoginModalContext';
import { signOut } from 'firebase/auth';
import { auth } from '../../../core/firebase/auth';
import { cn } from '../../../core/utils/utils';

type Tab = 'editor' | 'app' | 'account';

const THEME_ACCENT: Record<string, string> = {
  modern:    '#1e1e22',
  notion:    '#e8dfc0',
  spotify:   '#1ed760',
  amethyst:  '#7c3aed',
};

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  onRefreshLifeLog?: () => void;
}

export function SettingsPanelContent({ userId, onRefreshLifeLog }: { userId: string; onRefreshLifeLog?: () => void }) {
  const [activeTab, setActiveTab] = useState<Tab>('editor');
  const { t, language, setLanguage } = useLanguage();
  const { themeId, setThemeId, themes } = useTheme();
  const [confirmReset, setConfirmReset] = useState(false);
  const { isAuthenticated, isGuest } = useAuthStatus();
  const { openLoginModal } = useLoginModal();
  const { showToast } = useToast();

  const {
    fontFamily, setFontFamily,
    fontSize, setFontSize,
    editorWidth, setEditorWidth,
    zenModeEnabled, setZenModeEnabled,
    streamMode, toggleStreamMode,
    headerVisibility, toggleVisibility,
    } = useWritingSettings();

  const { execute } = useServiceAction();

  const tabs: { id: Tab; label: string }[] = [
    { id: 'editor',  label: t('settings_tab_editor') },
    { id: 'app',     label: t('settings_tab_app') },
    { id: 'account', label: t('settings_tab_account') },
  ];

  const fonts = ['Inter', 'Playfair Display', 'JetBrains Mono', 'Cormorant Garamond'];

  const handleSyncNow = async () => {
    try {
      const result = await SyncService.syncAllUnlinked(userId);
      if (result.failed > 0) {
        showToast(t('admin_import_failed', { count: result.failed }), 'error');
      } else {
        showToast(t('offline_synced'), 'success');
      }
      onRefreshLifeLog?.();
    } catch {
      showToast(t('error_generic_action'), 'error');
    }
  };

  return (
    <div className="flex flex-col h-full w-full">
      {/* Tabs */}
      <div className="flex items-center gap-1 px-4 pt-3 pb-2 shrink-0">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex-1 py-2 px-3 rounded-xl text-sm font-medium transition-all",
              activeTab === tab.id
                ? "bg-text-main text-surface-base"
                : "text-text-main/50 hover:text-text-main hover:bg-text-main/8"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 pb-28 space-y-4">
        {activeTab === 'editor' && (
          <div className="space-y-5 mt-2">
            <Section title={t('settings_font')}>
              <div className="grid grid-cols-2 gap-2">
                {fonts.map(font => (
                  <button
                    key={font}
                    onClick={() => setFontFamily(font)}
                    className={cn(
                      "px-3 py-3 rounded-xl border text-left transition-all",
                      fontFamily === font
                        ? "border-text-main bg-text-main text-surface-base"
                        : "border-border-subtle text-text-main/60 hover:text-text-main hover:border-text-main/40"
                    )}
                  >
                    <div className="text-sm font-medium" style={{ fontFamily: font }}>
                      {font.split(' ')[0]}
                    </div>
                    <div className="text-xs opacity-50 mt-0.5" style={{ fontFamily: font }}>
                      Аа 123
                    </div>
                  </button>
                ))}
              </div>
            </Section>

            <Section title={t('settings_font_size')}>
              <div className="flex items-center gap-3 px-1">
                <input
                  type="range" min={14} max={24} step={1}
                  value={fontSize}
                  onChange={e => setFontSize(Number(e.target.value))}
                  className="flex-1 accent-text-main"
                />
                <span className="text-sm font-mono text-text-main w-10 text-right">
                  {fontSize}px
                </span>
              </div>
            </Section>

            <Section title={t('settings_editor_width')}>
              <div className="flex items-center gap-3 px-1">
                <input
                  type="range"
                  min={50}
                  max={100}
                  step={1}
                  value={editorWidth}
                  onChange={e => setEditorWidth(Number(e.target.value))}
                  className="flex-1 accent-text-main"
                />
                <span className="text-sm font-mono text-text-main w-16 text-right">
                  {editorWidth}%
                </span>
              </div>
            </Section>

            <Section title={t('settings_zen_mode')}>
              <ToggleRow emoji="🧘" label={t('settings_zen_mode')} hint={t('settings_zen_desc')}    value={zenModeEnabled}  onChange={() => setZenModeEnabled(!zenModeEnabled)} />
              <ToggleRow emoji="🌊" label={t('settings_stream_mode')} hint={t('settings_stream_mode_desc')} value={streamMode}       onChange={toggleStreamMode} />
            </Section>

            <Section title={t('settings_show_in_panel')}>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { key: 'sessionTime',  label: t('header_sessionTime'),  emoji: '⏱' },
                  { key: 'sessionWords', label: t('header_sessionWords'), emoji: '📝' },
                  { key: 'totalWords',   label: t('header_totalWords'),   emoji: '📊' },
                  { key: 'wpm',          label: t('header_wpm'),          emoji: '💨' },
                ] as const).map(item => (
                  <button
                    key={item.key}
                    onClick={() => toggleVisibility(item.key)}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left transition-all",
                      headerVisibility[item.key]
                        ? "border-text-main bg-text-main/10 text-text-main"
                        : "border-border-subtle text-text-main/40 hover:text-text-main/60"
                    )}
                  >
                    <span className="text-base shrink-0">{item.emoji}</span>
                    <span className="text-xs font-medium leading-tight flex-1">{item.label}</span>
                    <span className={cn(
                      "text-xs shrink-0",
                      headerVisibility[item.key] ? "text-text-main" : "text-text-main/40"
                    )}>
                      {headerVisibility[item.key] ? '✓' : '○'}
                    </span>
                  </button>
                ))}
              </div>
            </Section>

          </div>
        )}

        {/* ── TAB 2: APP ── */}
        {activeTab === 'app' && (
          <div className="space-y-4 mt-2">

            {/* Storage */}
            <Section title={t('settings_section_storage')}>
              <div className="text-[11px] text-text-main/40 mb-3 px-1">
                {t('settings_storage_hint')}
              </div>

              {isAuthenticated && (
                <button
                  onClick={handleSyncNow}
                  className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border-subtle text-sm text-text-main/60 hover:text-text-main transition-all"
                >
                  <Cloud size={14} />
                  {t('settings_upload_to_cloud')}
                </button>
              )}

              {isGuest && (
                <button
                  onClick={openLoginModal}
                  className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-border-subtle text-sm text-text-main/40 hover:text-text-main transition-all"
                >
                  <LogIn size={14} />
                  {t('storage_sign_in_for_cloud')}
                </button>
              )}
            </Section>

            {/* Theme */}
            <Section title={t('profile_theme_title')}>
              <div className="grid grid-cols-2 gap-2">
                {Object.values(themes).map(theme => (
                  <button
                    key={theme.id}
                    onClick={() => setThemeId(theme.id)}
                    className={cn(
                      "px-4 py-2.5 rounded-xl border text-sm font-medium transition-all text-left",
                      themeId === theme.id
                        ? "border-text-main bg-text-main text-surface-base"
                        : "border-border-subtle text-text-main/60 hover:text-text-main hover:border-text-main/40"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full shrink-0 border border-black/10"
                        style={{ backgroundColor: THEME_ACCENT[theme.id] }}
                      />
                      <span>{language === 'ru' ? theme.nameRu : theme.nameEn}</span>
                    </div>
                  </button>
                ))}
              </div>
            </Section>

            {/* Language */}
            <Section title={t('settings_language')}>
              <div className="grid grid-cols-2 gap-2">
                {(['ru', 'en'] as const).map(lang => (
                  <button
                    key={lang}
                    onClick={() => setLanguage(lang)}
                    className={cn(
                      "px-4 py-2.5 rounded-xl border text-sm font-medium transition-all",
                      language === lang
                        ? "border-text-main bg-text-main text-surface-base"
                        : "border-border-subtle text-text-main/60 hover:text-text-main"
                    )}
                  >
                    {lang === 'ru' ? '🇷🇺 Русский' : '🇺🇸 English'}
                  </button>
                ))}
              </div>
            </Section>
          </div>
        )}

        {/* ── TAB 3: ACCOUNT ── */}
        {activeTab === 'account' && (
          <div className="space-y-4 mt-2">
            {isAuthenticated ? (
              <Section title={t('me_tab_account')}>
                <div className="flex items-center gap-4 p-4 rounded-xl border border-border-subtle">
                  {auth.currentUser?.photoURL ? (
                    <img
                      src={auth.currentUser.photoURL}
                      alt=""
                      className="w-12 h-12 rounded-full object-cover border border-border-subtle"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-full flex items-center justify-center bg-text-main/10 border border-border-subtle">
                      <UserIcon size={24} className="text-text-main/40" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-text-main truncate">
                      {auth.currentUser?.displayName || auth.currentUser?.email?.split('@')[0] || t('common_untitled')}
                    </div>
                    <div className="text-xs text-text-main/40 truncate">
                      {auth.currentUser?.email}
                    </div>
                  </div>
                </div>
              </Section>
            ) : (
              <Section title={t('me_tab_account')}>
                <div className="flex items-center gap-4 p-4 rounded-xl border border-dashed border-border-subtle">
                  <div className="w-12 h-12 rounded-full flex items-center justify-center bg-text-main/10">
                    <HardDrive size={24} className="text-text-main/40" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-text-main/60">
                      {t('guest_saved_locally')}
                    </div>
                    <div className="text-xs text-text-main/30 mt-0.5">
                      {t('guest_sync_hint')}
                    </div>
                  </div>
                </div>
              </Section>
            )}

            {isAuthenticated ? (
              <button
                onClick={() => execute(
                  () => signOut(auth),
                  { errorMessage: t('error_signout_failed') }
                )}
                className="w-full px-4 py-3 rounded-xl border border-border-subtle text-sm text-text-main/60 hover:text-red-400 hover:border-red-400/30 transition-all text-left"
              >
                {t('me_sign_out')}
              </button>
            ) : (
              <button
                onClick={openLoginModal}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-text-main bg-text-main text-surface-base text-sm font-bold hover:opacity-90 transition-all"
              >
                <LogIn size={16} />
                {t('auth_sign_in')}
              </button>
            )}

            <Section title={t('profile_achievements')}>
              {!confirmReset ? (
                <button
                  onClick={() => setConfirmReset(true)}
                  className="w-full px-4 py-3 rounded-xl border border-red-400/25 text-sm text-red-400/70 hover:text-red-400 hover:border-red-400/40 transition-all text-left"
                >
                  {t('profile_reset_achievements')}
                </button>
              ) : (
                <div className="flex flex-col gap-3 p-4 rounded-xl border border-red-400/20 bg-red-400/5">
                  <span className="text-sm text-text-main/70">{t('reset_achievements_confirm')}</span>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => execute(
                      () => ProfileService.resetAchievements(userId),
                      { successMessage: t('save_success'), errorMessage: t('error_generic_action'), onSuccess: () => setConfirmReset(false) }
                    )}
                      className="px-4 py-2 rounded-xl text-sm font-bold text-red-400 border border-red-400/30 hover:bg-red-400/10 transition-all"
                    >
                      {t('finish_discard')}
                    </button>
                    <button onClick={() => setConfirmReset(false)} className="text-sm text-text-main/40 hover:text-text-main/60 transition-colors">
                      {t('writing_cancel')}
                    </button>
                  </div>
                </div>
              )}
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}

export function SettingsPanel({ isOpen, onClose, userId, onRefreshLifeLog }: SettingsPanelProps) {
  const { t } = useLanguage();

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[60] bg-black/30 backdrop-blur-sm"
          />

          {/* Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed top-0 right-0 bottom-0 w-full max-w-[420px] z-[70] bg-surface-card border-l border-border-subtle flex flex-col shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle shrink-0">
              <h2 className="text-lg font-bold text-text-main">{t('nav_settings')}</h2>
              <button
                onClick={onClose}
                className="p-3 rounded-xl text-text-main/50 hover:text-text-main hover:bg-text-main/8 transition-all"
              >
                <X size={20} />
              </button>
            </div>

            <SettingsPanelContent userId={userId} onRefreshLifeLog={onRefreshLifeLog} />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// Helper components
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-bold uppercase tracking-widest text-text-main/40 px-1">{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function ToggleRow({ emoji, label, hint, value, onChange }: {
  emoji?: string;
  label: string;
  hint?: string;
  value: boolean;
  onChange: () => void;
}) {
  return (
    <button
      onClick={onChange}
      className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border-subtle hover:bg-text-main/5 transition-all w-full"
    >
      {emoji && <span className="text-base shrink-0">{emoji}</span>}
      <div className="flex-1 text-left">
        <span className="text-sm text-text-main/70">{label}</span>
        {hint && <p className="text-[10px] text-text-main/40 mt-0.5">{hint}</p>}
      </div>
      <div className={cn(
        "w-8 h-4 rounded-full relative transition-colors duration-200 shrink-0",
        value ? "bg-text-main" : "bg-text-main/20"
      )}>
        <div className={cn(
          "absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform duration-200",
          value ? "translate-x-4" : "translate-x-0"
        )} />
      </div>
    </button>
  );
}
