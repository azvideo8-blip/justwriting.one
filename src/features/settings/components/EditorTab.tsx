import React from 'react';
import { useLanguage } from '../../../shared/i18n';
import { useTheme } from '../../../core/theme/ThemeProvider';
import { useWritingSettings } from '../../../core/settings/WritingSettingsContext';
import { cn } from '../../../core/utils/utils';
import { Section, ToggleRow } from './SettingsHelpers';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';
import { Button } from '../../../shared/components/Button';
import { Wind, Waves, Keyboard, Focus, MousePointer2, Timer, FileText, BarChart2, Gauge, VolumeX, Quote } from 'lucide-react';

const THEME_ACCENT: Record<string, string> = {
  modern:    '#1e1e22',
  notion:    '#e8dfc0',
  spotify:   '#1ed760',
  amethyst:  '#7c3aed',
  system:    'linear-gradient(135deg, #0E0A18 50%, #FAF8F5 50%)',
};

export function EditorTab() {
  const { t, language, setLanguage } = useLanguage();
  const { themeId, setThemeId, themes } = useTheme();
  const { layoutMode } = useLayoutMode();
  const {
    fontFamily, setFontFamily,
    fontSize, setFontSize,
    lineHeight, setLineHeight,
    editorWidth, setEditorWidth,
    silenceMode, setSilenceMode,
    typographyEnabled, setTypographyEnabled,
    zenModeEnabled, setZenModeEnabled,
    streamMode, toggleStreamMode,
    headerVisibility, toggleVisibility,
    typewriterScrolling, setTypewriterScrolling,
    focusModeEnabled, setFocusModeEnabled,
    autoHideCursor, setAutoHideCursor,
  } = useWritingSettings();

  const fonts = ['Inter', 'Lora', 'Playfair Display', 'EB Garamond'];
  // У выбравших моноширинный он остаётся рабочим (fontStack его понимает), но в
  // списке больше не предлагается. Показываем таким людям выбранным Inter,
  // чтобы в списке не было пустоты вместо отмеченного пункта.

  return (
    <div className="space-y-5 mt-2">

      <Section title={t('settings_font')}>
        <div className="grid grid-cols-2 gap-2">
          {fonts.map(font => (
            <Button
              key={font}
              onClick={() => setFontFamily(font)}
              className={cn(
                "px-3 py-3 rounded-xl border text-left transition-colors",
                fontFamily === font
                  ? "border-text-main bg-text-main text-surface-base"
                  : "border-border-subtle text-text-main/60 hover:text-text-main hover:border-text-main/40"
              )}
              style={{ fontFamily: font }}
            >
              <div className="text-sm font-medium" style={{ fontFamily: font }}>
                {font.split(' ')[0]}
              </div>
              <div className="text-xs opacity-50 mt-0.5" style={{ fontFamily: font }}>
                Аа 123
              </div>
            </Button>
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

      <Section title={t('settings_line_height')}>
        <div className="flex items-center gap-3 px-1">
          <input
            type="range" min={1.2} max={2.2} step={0.1}
            value={lineHeight}
            onChange={e => setLineHeight(Number(e.target.value))}
            className="flex-1 accent-text-main"
          />
          <span className="text-sm font-mono text-text-main w-10 text-right">
            {lineHeight.toFixed(1)}
          </span>
        </div>
      </Section>

      {layoutMode === 'desktop' && (
        <Section title={t('settings_editor_width')}>
          <div className="flex items-center gap-3 px-1">
            <input
              type="range"
              min={40}
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
      )}

      <Section title={t('settings_zen_mode')}>
        <ToggleRow icon={<VolumeX size={16} />} label={t('settings_silence_mode')} hint={t('settings_silence_mode_desc')} value={silenceMode} onChange={() => setSilenceMode(!silenceMode)} />
        <ToggleRow icon={<Wind size={16} />} label={t('settings_zen_mode')} hint={t('settings_zen_desc')}    value={zenModeEnabled}  onChange={() => setZenModeEnabled(!zenModeEnabled)} />
        <ToggleRow icon={<Waves size={16} />} label={t('settings_stream_mode')} hint={t('settings_stream_mode_desc')} value={streamMode}       onChange={toggleStreamMode} />
      </Section>

      <Section title={t('settings_writing_experience')}>
        <ToggleRow icon={<Quote size={16} />} label={t('settings_typography')} hint={t('settings_typography_desc')} value={typographyEnabled} onChange={() => setTypographyEnabled(!typographyEnabled)} />
        <ToggleRow icon={<Keyboard size={16} />} label={t('settings_typewriter')} hint={t('settings_typewriter_desc')} value={typewriterScrolling} onChange={() => setTypewriterScrolling(!typewriterScrolling)} />
        <ToggleRow icon={<Focus size={16} />} label={t('settings_focus_mode')} hint={t('settings_focus_mode_desc')} value={focusModeEnabled} onChange={() => setFocusModeEnabled(!focusModeEnabled)} />
        <ToggleRow icon={<MousePointer2 size={16} />} label={t('settings_auto_hide_cursor')} hint={t('settings_auto_hide_cursor_desc')} value={autoHideCursor} onChange={() => setAutoHideCursor(!autoHideCursor)} />
      </Section>

      <Section title={t('settings_show_in_panel')}>
        <div className="grid grid-cols-2 gap-2">
          {([
            { key: 'sessionTime',  label: t('header_sessionTime'),  icon: <Timer size={16} /> },
            { key: 'sessionWords', label: t('header_sessionWords'), icon: <FileText size={16} /> },
            { key: 'totalWords',   label: t('header_totalWords'),   icon: <BarChart2 size={16} /> },
            { key: 'wpm',          label: t('header_wpm'),          icon: <Gauge size={16} /> },
          ] as const).map(item => (
            <Button
              key={item.key}
              onClick={() => toggleVisibility(item.key)}
              className={cn(
                "flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left transition-colors",
                headerVisibility[item.key]
                  ? "border-text-main bg-text-main/10 text-text-main"
                  : "border-border-subtle text-text-main/60 hover:text-text-main/60"
              )}
            >
              <span className="text-text-main/60 shrink-0">{item.icon}</span>
              <span className="text-xs font-medium leading-tight flex-1">{item.label}</span>
              <span className={cn(
                "text-xs shrink-0",
                headerVisibility[item.key] ? "text-text-main" : "text-text-main/60"
              )}>
                {headerVisibility[item.key] ? '✓' : '○'}
              </span>
            </Button>
          ))}
        </div>
      </Section>
      <Section title={t('profile_theme_title')}>
        <p className="text-xs text-text-muted -mt-1 mb-2">
          {t('profile_theme_hint')}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {Object.values(themes).map(theme => (
            <Button
              key={theme.id}
              onClick={() => setThemeId(theme.id)}
              className={`px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors text-left ${
                themeId === theme.id
                  ? "border-text-main bg-text-main text-surface-base"
                  : "border-border-subtle text-text-main/60 hover:text-text-main hover:border-text-main/40"
              }`}
            >
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full shrink-0 border border-black/10"
                  style={THEME_ACCENT[theme.id] ? { backgroundColor: THEME_ACCENT[theme.id] } : undefined}
                />
                <span>{language === 'ru' ? theme.nameRu : theme.nameEn}</span>
              </div>
            </Button>
          ))}
          <Button
            onClick={() => setThemeId('system')}
            className={`px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors text-left ${
              themeId === 'system'
                ? "border-text-main bg-text-main text-surface-base"
                : "border-border-subtle text-text-main/60 hover:text-text-main hover:border-text-main/40"
            }`}
          >
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full shrink-0 border border-black/10"
                style={{ background: THEME_ACCENT.system }}
              />
              <span>{t('settings_theme_system')}</span>
            </div>
          </Button>
        </div>
      </Section>
      <Section title={t('settings_language')}>
        <div className="grid grid-cols-2 gap-2">
          {(['ru', 'en'] as const).map(lang => (
            <Button
              key={lang}
              onClick={() => setLanguage(lang)}
              className={`px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                language === lang
                  ? "border-text-main bg-text-main text-surface-base"
                  : "border-border-subtle text-text-main/60 hover:text-text-main"
              }`}
            >
              {lang === 'ru' ? '🇷🇺 Русский' : '🇺🇸 English'}
            </Button>
          ))}
        </div>
      </Section>
    </div>
  );
}
