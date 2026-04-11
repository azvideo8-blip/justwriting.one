import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { useLanguage } from '../../../core/i18n';
import { useTheme } from '../../../core/theme/ThemeProvider';
import { useLocalStorage } from '../../../shared/hooks/useLocalStorage';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';
import { useWritingSettings } from '../../writing/contexts/WritingSettingsContext';
import { ProfileService } from '../../profile/services/ProfileService';
import { signOut } from 'firebase/auth';
import { auth } from '../../../core/firebase/auth';
import { cn } from '../../../core/utils/utils';
import { z } from 'zod';

type Tab = 'editor' | 'app' | 'account';

const THEME_ACCENT: Record<string, string> = {
  modern:  '#1e1e22',
  stripe:  '#7c3aed',
  notion:  '#e8dfc0',
  spotify: '#1ed760',
};

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
}

export function SettingsPanel({ isOpen, onClose, userId }: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('editor');
  const { t, language, setLanguage } = useLanguage();
  const { themeId, setThemeId, themes } = useTheme();
  const { layoutMode, setLayoutMode } = useLayoutMode();
  const [classicNav, setClassicNav] = useLocalStorage('classic-nav', false, z.boolean());
  const [betaMode, setBetaMode] = useLocalStorage('beta-mode', false, z.boolean());
  const [communityMode, setCommunityMode] = useLocalStorage('community-mode', false, z.boolean());
  const [aiMode, setAiMode] = useLocalStorage('ai-mode', false, z.boolean());
  const [confirmReset, setConfirmReset] = useState(false);

  const {
    fontFamily, setFontFamily,
    fontSize, setFontSize,
    textWidth, setTextWidth,
    zenModeEnabled, setZenModeEnabled,
    streamMode, setStreamMode: toggleStreamMode,
    stickyHeader, setStickyHeader,
    stickyPanel, setStickyPanel,
    headerVisibility, toggleVisibility,
  } = useWritingSettings();

  const tabs: { id: Tab; label: string }[] = [
    { id: 'editor',  label: t('settings_tab_editor') },
    { id: 'app',     label: t('settings_tab_app') },
    { id: 'account', label: t('settings_tab_account') },
  ];

  const fonts = ['Inter', 'Playfair Display', 'JetBrains Mono', 'Cormorant Garamond'];

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
                className="p-2 rounded-xl text-text-main/50 hover:text-text-main hover:bg-text-main/8 transition-all"
              >
                <X size={20} />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 px-4 pt-3 pb-0 shrink-0">
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
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

              {/* ── TAB 1: EDITOR ── */}
              {activeTab === 'editor' && (
                <div className="space-y-5">

                  {/* Font — 2x2 grid with preview */}
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
                              : "border-border-subtle text-text-main/60 hover:text-text-main hover:border-text-main/30"
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

                  {/* Font size — slider */}
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

                  {/* Text width */}
                  <Section title={t('settings_text_width')}>
                    <div className="grid grid-cols-2 gap-2">
                      {(['centered', 'full'] as const).map(w => (
                        <button
                          key={w}
                          onClick={() => setTextWidth(w)}
                          className={cn(
                            "px-3 py-2.5 rounded-xl border text-sm transition-all",
                            textWidth === w
                              ? "border-text-main bg-text-main text-surface-base"
                              : "border-border-subtle text-text-main/60 hover:text-text-main"
                          )}
                        >
                          {w === 'centered' ? t('settings_width_centered') : t('settings_width_full')}
                        </button>
                      ))}
                    </div>
                  </Section>

                  {/* Writing modes — with emoji icons */}
                  <Section title={t('settings_writing_modes')}>
                    <ToggleRow emoji="🧘" label={t('settings_zen_mode')}    value={zenModeEnabled}  onChange={() => setZenModeEnabled(!zenModeEnabled)} />
                    <ToggleRow emoji="🌊" label={t('settings_stream_mode')} value={streamMode}       onChange={toggleStreamMode} />
                  </Section>

                  {/* Header */}
                  <Section title={t('settings_header')}>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setStickyHeader(!stickyHeader)}
                        className={cn(
                          "px-3 py-2.5 rounded-xl border text-sm transition-all",
                          stickyHeader
                            ? "border-text-main bg-text-main text-surface-base"
                            : "border-border-subtle text-text-main/60 hover:text-text-main"
                        )}
                      >
                        📌 {t('settings_sticky_header')}
                      </button>
                      <button
                        onClick={() => setStickyPanel(!stickyPanel)}
                        className={cn(
                          "px-3 py-2.5 rounded-xl border text-sm transition-all",
                          stickyPanel
                            ? "border-text-main bg-text-main text-surface-base"
                            : "border-border-subtle text-text-main/60 hover:text-text-main"
                        )}
                      >
                        📊 {t('settings_sticky_panel')}
                      </button>
                    </div>
                  </Section>

                  {/* Header visibility — compact checkbox grid */}
                  <Section title={t('settings_show_in_panel')}>
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        { key: 'currentTime',  label: t('header_currentTime'),  emoji: '🕐' },
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
                            headerVisibility[item.key] ? "text-text-main" : "text-text-main/30"
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
                <div className="space-y-4">

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
                              : "border-border-subtle text-text-main/60 hover:text-text-main hover:border-text-main/30"
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

                  {/* Layout */}
                  <Section title={t('settings_layout')}>
                    <div className="grid grid-cols-2 gap-2">
                      {(['desktop', 'mobile'] as const).map(mode => (
                        <button
                          key={mode}
                          onClick={() => setLayoutMode(mode)}
                          className={cn(
                            "px-4 py-2.5 rounded-xl border text-sm font-medium transition-all",
                            layoutMode === mode
                              ? "border-text-main bg-text-main text-surface-base"
                              : "border-border-subtle text-text-main/60 hover:text-text-main"
                          )}
                        >
                          {mode === 'desktop' ? `🖥 ${t('layout_desktop')}` : `📱 ${t('layout_mobile')}`}
                        </button>
                      ))}
                    </div>
                  </Section>

                  {/* Interface toggles */}
                  <Section title={t('settings_interface')}>
                    <ToggleRow label={t('settings_classic_nav')} value={classicNav} onChange={() => setClassicNav(!classicNav)} />
                    <ToggleRow label={t('profile_settings_beta')} value={betaMode} onChange={() => setBetaMode(!betaMode)} />
                  </Section>
                </div>
              )}

              {/* ── TAB 3: ACCOUNT ── */}
              {activeTab === 'account' && (
                <div className="space-y-4">
                  <Section title={t('settings_features')}>
                    <ToggleRow label={t('profile_settings_community')} value={communityMode} onChange={() => setCommunityMode(!communityMode)} />
                    <ToggleRow label={t('profile_settings_ai')} value={aiMode} onChange={() => setAiMode(!aiMode)} />
                  </Section>

                  <Section title={t('profile_achievements')}>
                    {!confirmReset ? (
                      <button
                        onClick={() => setConfirmReset(true)}
                        className="text-sm text-red-400/70 hover:text-red-400 transition-colors underline underline-offset-2"
                      >
                        {t('profile_reset_achievements')}
                      </button>
                    ) : (
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-sm text-text-main/50">{t('profile_reset_achievements_confirm')}</span>
                        <button
                          onClick={async () => { await ProfileService.resetAchievements(userId); setConfirmReset(false); }}
                          className="text-sm font-bold text-red-400"
                        >
                          {t('finish_discard')}
                        </button>
                        <button onClick={() => setConfirmReset(false)} className="text-sm text-text-main/40">
                          {t('writing_cancel')}
                        </button>
                      </div>
                    )}
                  </Section>

                  <Section title={t('nav_logout')}>
                    <button
                      onClick={() => signOut(auth)}
                      className="w-full px-4 py-3 rounded-xl border border-border-subtle text-sm text-text-main/60 hover:text-red-400 hover:border-red-400/30 transition-all text-left"
                    >
                      {t('nav_logout')}
                    </button>
                  </Section>
                </div>
              )}
            </div>
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
      <p className="text-[10px] font-bold uppercase tracking-widest text-text-main/40 px-1">{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function ToggleRow({ emoji, label, value, onChange }: {
  emoji?: string;
  label: string;
  value: boolean;
  onChange: () => void;
}) {
  return (
    <button
      onClick={onChange}
      className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border-subtle hover:bg-text-main/5 transition-all w-full"
    >
      {emoji && <span className="text-base shrink-0">{emoji}</span>}
      <span className="text-sm text-text-main/70 flex-1 text-left">{label}</span>
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
