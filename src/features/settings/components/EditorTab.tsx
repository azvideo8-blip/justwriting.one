import React from 'react';
import { useLanguage } from '../../../shared/i18n';
import { useWritingSettings } from '../../writing/contexts/WritingSettingsContext';
import { cn } from '../../../core/utils/utils';
import { Section, ToggleRow } from './SettingsHelpers';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';

export function EditorTab() {
  const { t } = useLanguage();
  const { layoutMode } = useLayoutMode();
  const {
    fontFamily, setFontFamily,
    fontSize, setFontSize,
    editorWidth, setEditorWidth,
    zenModeEnabled, setZenModeEnabled,
    streamMode, toggleStreamMode,
    headerVisibility, toggleVisibility,
  } = useWritingSettings();

  const fonts = ['Inter', 'Lora', 'JetBrains Mono'];

  return (
    <div className="space-y-5 mt-2">
      <Section title={t('settings_font')}>
        <div className="grid grid-cols-2 gap-2">
          {fonts.map(font => (
            <button
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
                "flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left transition-colors",
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
  );
}
