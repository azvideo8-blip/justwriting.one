import React from 'react';
import { useLanguage } from '../../../core/i18n';
import { useWritingSettings } from '../contexts/WritingSettingsContext';
import { Toggle } from '../../../shared/components/Toggle';
import { getFontStack } from '../utils/fontStack';
import { SettingRow } from './MeScreenHelpers';

export function MeWritingSection() {
  const { t } = useLanguage();
  const {
    fontFamily, setFontFamily,
    fontSize, setFontSize,
    zenModeEnabled, setZenModeEnabled,
  } = useWritingSettings();

  return (
    <div>
      <div style={{
        fontSize: 10,
        color: 'rgba(74,81,77,1)',
        textTransform: 'uppercase',
        letterSpacing: '.08em',
        fontFamily: 'JetBrains Mono, monospace',
        marginBottom: 8,
      }}>
        {t('settings_section_font')}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 6,
        marginBottom: 20,
      }}>
        {[
          { id: 'sans',  label: 'Inter',         sample: 'Aa 123' },
          { id: 'serif', label: 'Lora',       sample: 'Aa 123' },
          { id: 'mono',  label: 'JetBrains Mono', sample: 'Aa 123' },
        ].map(f => (
          <button
            key={f.id}
            onClick={() => setFontFamily(f.id)}
            style={{
              padding: '12px 14px',
              borderRadius: 12,
              border: `1px solid ${fontFamily === f.id
                ? 'oklch(0.72 0.13 155 / 0.5)'
                : 'rgba(255,255,255,0.07)'}`,
              background: fontFamily === f.id
                ? 'oklch(0.72 0.13 155 / 0.08)'
                : 'rgba(255,255,255,0.03)',
              cursor: 'pointer',
              textAlign: 'left',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <div style={{
              fontSize: 15,
              fontFamily: getFontStack(f.id),
              color: 'rgba(232,236,233,0.9)',
              marginBottom: 2,
            }}>
              {f.sample}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(138,145,141,1)' }}>
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
          style={{ width: 100 }}
        />
      </SettingRow>

      <SettingRow label={t('settings_zen_mode')}>
        <Toggle checked={zenModeEnabled} onChange={setZenModeEnabled} />
      </SettingRow>
    </div>
  );
}
