import React from 'react';
import { useLanguage } from '../../../core/i18n';
import { useWritingSettings } from '../contexts/WritingSettingsContext';
import { Toggle } from '../../../shared/components/Toggle';
import { getFontStack } from '../utils/fontStack';
import { SettingRow } from './MeScreenHelpers';
import { useSettings } from '../../../core/settings/SettingsContext';
import { Button } from '../../../shared/components/Button';

export function MeWritingSection() {
  const { t } = useLanguage();
  const {
    fontFamily, setFontFamily,
    fontSize, setFontSize,
    zenModeEnabled, setZenModeEnabled,
  } = useWritingSettings();

  const { openSettings } = useSettings();

  const buttonStyle = (id: string) => ({
    borderColor: fontFamily === id
      ? 'oklch(0.72 0.13 155 / 0.5)'
      : 'rgba(255,255,255,0.07)',
    background: fontFamily === id
      ? 'oklch(0.72 0.13 155 / 0.08)'
      : 'rgba(255,255,255,0.03)',
  });

  return (
    <div>
      <div className="text-[10px] text-[rgba(74,81,77,1)] uppercase tracking-[0.08em] font-mono mb-2">
        {t('settings_section_font')}
      </div>

      <div className="grid grid-cols-2 gap-1.5 mb-5">
        {[
          { id: 'Inter',  label: 'Inter',         sample: 'Aa 123' },
          { id: 'Lora',   label: 'Lora',          sample: 'Aa 123' },
          { id: 'JetBrains Mono', label: 'JetBrains Mono', sample: 'Aa 123' },
        ].map(f => (
          <button
            type="button"
            key={f.id}
            onClick={() => setFontFamily(f.id)}
            className="p-3 rounded-xl border cursor-pointer text-left"
            style={buttonStyle(f.id)}
          >
            <div className="text-[15px] text-[rgba(232,236,233,0.9)] mb-0.5" style={{ fontFamily: getFontStack(f.id) }}>
              {f.sample}
            </div>
            <div className="text-[11px] text-[rgba(138,145,141,1)]">
              {f.label}
            </div>
          </button>
        ))}
      </div>

      <SettingRow label={t('settings_font_size')} hint={`${fontSize}px`}>
        <input
          type="range"
          min={14} max={28}
          value={fontSize}
          onChange={e => setFontSize(Number(e.target.value))}
          className="w-[100px]" 
        />
      </SettingRow>

      <SettingRow label={t('settings_zen_mode')}>
        <Toggle checked={zenModeEnabled} onChange={setZenModeEnabled} ariaLabel={t('settings_zen_mode')} />
      </SettingRow>

      <Button
        variant="ghost"
        size="md"
        onClick={() => openSettings('editor')}
        className="mt-5 w-full py-3 rounded-xl border border-white/[0.07] bg-white/[0.03] text-white/80 text-sm font-medium text-center"
      >
        {t('settings_all_editor_settings') || 'Все настройки редактора →'}
      </Button>
    </div>
  );
}
